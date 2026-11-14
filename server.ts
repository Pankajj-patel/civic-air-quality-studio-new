import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ensureDatabaseSchema } from './src/db/index.ts';
import { errorHandler } from './src/server/middleware/errorHandler.ts';
import { authRoutes } from './src/server/routes/authRoutes.ts';
import { briefingRoutes } from './src/server/routes/briefingRoutes.ts';
import { comparisonRoutes } from './src/server/routes/comparisonRoutes.ts';
import { datasetRoutes } from './src/server/routes/datasetRoutes.ts';
import { jobRoutes } from './src/server/routes/jobRoutes.ts';
import { orgRoutes } from './src/server/routes/orgRoutes.ts';

dotenv.config();

export interface CreateAppOptions {
  authRateLimitMax?: number;
}

function buildTrustedOrigins(reqHost?: string): Set<string> {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  if (reqHost) {
    origins.add(`http://${reqHost}`);
    origins.add(`https://${reqHost}`);
  }
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && appUrl !== 'MY_APP_URL') {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // Ignore invalid APP_URL
    }
  }
  const extra = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) || [];
  for (const item of extra) {
    try {
      origins.add(new URL(item).origin);
    } catch {
      origins.add(item);
    }
  }
  return origins;
}

export async function createApp(options: CreateAppOptions = {}) {
  ensureDatabaseSchema();

  const app = express();
  app.set('trust proxy', 1);

  // Security headers compatible with iframe preview & Vite module scripts
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
      hsts: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  // Explicit CORS origin validation & no-store caching on all API endpoints
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    const origin = req.headers.origin;
    if (origin) {
      const trusted = buildTrustedOrigins(req.get('host'));
      if (!trusted.has(origin)) {
        res.status(403).json({
          error: {
            code: 'CORS_ORIGIN_DENIED',
            message: 'Origin is not permitted by CORS policy.',
          },
        });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Organization-Id',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 150,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many API requests. Please wait a minute and try again.',
        },
      });
    },
  });
  app.use('/api', apiLimiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: options.authRateLimitMax ?? (process.env.NODE_ENV === 'test' ? 200 : 15),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many authentication attempts. Please wait 15 minutes before retrying.',
        },
      });
    },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'civic-air-quality-briefing-studio',
      database: 'sqlite',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/orgs', orgRoutes);
  app.use('/api/datasets', datasetRoutes);
  app.use('/api/briefings', briefingRoutes);
  app.use('/api/comparisons', comparisonRoutes);
  app.use('/api/jobs', jobRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not found.',
      },
    });
  });

  app.use(errorHandler);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else if (process.env.NODE_ENV !== 'test') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  return app;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== 'test' && isDirectRun) {
  const PORT = Number(process.env.PORT || 3000);
  createApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Civic Air Quality Briefing Studio server listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}



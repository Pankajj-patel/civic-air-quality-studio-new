import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import { organizationMembers, organizations, users } from '../../db/schema.ts';
import { loginSchema, registerSchema } from '../../shared/schemas/index.ts';
import { AuthUserSummary, AqiStandard, OrgType, UserRole } from '../../shared/types.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { hashPassword, signSessionToken, verifyPassword } from '../utils/crypto.ts';

export const authRoutes = Router();

function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'civic-org'}-${suffix}`;
}

async function buildUserSummary(userId: number): Promise<AuthUserSummary> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  }

  const membershipsRaw = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      slug: organizations.slug,
      orgType: organizations.orgType,
      defaultAqiStandard: organizations.defaultAqiStandard,
      defaultLanguage: organizations.defaultLanguage,
      role: organizationMembers.role,
      assignedLocationsJson: organizationMembers.assignedLocationsJson,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId));

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    memberships: membershipsRaw.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      slug: m.slug,
      orgType: m.orgType as OrgType,
      defaultAqiStandard: m.defaultAqiStandard as AqiStandard,
      defaultLanguage: m.defaultLanguage,
      role: m.role as UserRole,
      assignedLocations: JSON.parse(m.assignedLocationsJson || '[]'),
    })),
  };
}

authRoutes.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const normalizedEmail = body.email.toLowerCase();

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    const passwordHash = hashPassword(body.password);

    const createdUserId = db.transaction((tx) => {
      const insertedUser = tx
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash,
          fullName: body.fullName,
        })
        .returning({ id: users.id })
        .get();

      const orgName = body.organizationName || `${body.fullName}'s Civic Unit`;
      const orgType = body.orgType || 'municipality';
      const insertedOrg = tx
        .insert(organizations)
        .values({
          name: orgName,
          slug: slugifyOrgName(orgName),
          orgType,
          defaultAqiStandard: 'CPCB_NAQI',
          defaultLanguage: 'en',
        })
        .returning({ id: organizations.id })
        .get();

      tx.insert(organizationMembers)
        .values({
          organizationId: insertedOrg.id,
          userId: insertedUser.id,
          role: 'org_admin',
          assignedLocationsJson: '[]',
        })
        .run();

      return { userId: insertedUser.id, organizationId: insertedOrg.id };
    });

    await recordAuditLog({
      organizationId: createdUserId.organizationId,
      actorUserId: createdUserId.userId,
      action: 'USER_REGISTERED',
      resourceType: 'user',
      resourceId: createdUserId.userId,
      metadata: { email: normalizedEmail },
    });

    const token = await signSessionToken({
      userId: createdUserId.userId,
      email: normalizedEmail,
    });
    const summary = await buildUserSummary(createdUserId.userId);

    res.status(201).json({ token, user: summary });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const normalizedEmail = body.email.toLowerCase();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const token = await signSessionToken({ userId: user.id, email: user.email });
    const summary = await buildUserSummary(user.id);

    res.json({ token, user: summary });
  } catch (err) {
    next(err);
  }
});

authRoutes.get('/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const summary = await buildUserSummary(req.auth!.userId);
    res.json({ user: summary });
  } catch (err) {
    next(err);
  }
});

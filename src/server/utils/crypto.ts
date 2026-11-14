import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

let fallbackSecret: Uint8Array | null = null;
let warnedMissingSecret = false;

function getJwtSecret(): Uint8Array {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    if (configured.length < 32 && !warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(
        '[SECURITY] SESSION_SECRET is shorter than 32 characters; configure a 32+ character secret.',
      );
    }
    return new TextEncoder().encode(configured);
  }
  if (!fallbackSecret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      const msg =
        '[SECURITY] SESSION_SECRET is not set (or <16 chars). Using an ephemeral per-process cryptographic key; sessions will reset on restart.';
      if (process.env.NODE_ENV === 'production') {
        console.error(msg);
      } else if (process.env.NODE_ENV !== 'test') {
        console.warn(msg);
      }
    }
    // Never reuse GEMINI_API_KEY or other service credentials for JWT signing
    fallbackSecret = new Uint8Array(crypto.randomBytes(32));
  }
  return fallbackSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hashHex] = storedHash.split(':');
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function sha256Hex(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export interface SessionPayload {
  userId: number;
  email: string;
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(payload.userId))
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret());
  const userId = Number(payload.sub);
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!Number.isInteger(userId) || userId <= 0 || !email) {
    throw new Error('Invalid session token claims');
  }
  return { userId, email };
}

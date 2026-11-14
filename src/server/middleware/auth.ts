import { and, eq } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import { db } from '../../db/index.ts';
import { organizationMembers, organizations, users } from '../../db/schema.ts';
import { AqiStandard, OrgType, UserRole } from '../../shared/types.ts';
import { verifySessionToken } from '../utils/crypto.ts';
import { AppError } from './errorHandler.ts';

export interface AuthContext {
  userId: number;
  email: string;
  fullName: string;
}

export interface OrgContext {
  organizationId: number;
  organizationName: string;
  orgType: OrgType;
  defaultAqiStandard: AqiStandard;
  defaultLanguage: string;
  role: UserRole;
  assignedLocations: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  org?: OrgContext;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication token required.');
    }
    const token = header.slice('Bearer '.length).trim();
    const claims = await verifySessionToken(token);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.id, claims.userId))
      .limit(1);

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'User account no longer exists.');
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
    };
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError(401, 'INVALID_TOKEN', 'Invalid or expired session token.'));
  }
}

export function requireOrgAccess(allowedRoles?: readonly UserRole[]) {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.auth) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
      }

      const rawOrgId = req.params.orgId || req.headers['x-organization-id'];
      const organizationId = Number(rawOrgId);
      if (!Number.isInteger(organizationId) || organizationId <= 0) {
        throw new AppError(400, 'MISSING_ORG_CONTEXT', 'Valid X-Organization-Id header or orgId parameter is required.');
      }

      const rows = await db
        .select({
          organizationId: organizations.id,
          organizationName: organizations.name,
          orgType: organizations.orgType,
          defaultAqiStandard: organizations.defaultAqiStandard,
          defaultLanguage: organizations.defaultLanguage,
          role: organizationMembers.role,
          assignedLocationsJson: organizationMembers.assignedLocationsJson,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, req.auth.userId),
          ),
        )
        .limit(1);

      const membership = rows[0];
      if (!membership) {
        throw new AppError(403, 'FORBIDDEN_ORG', 'You do not have access to this organization.');
      }

      const role = membership.role as UserRole;
      if (allowedRoles && !allowedRoles.includes(role)) {
        throw new AppError(
          403,
          'INSUFFICIENT_ROLE',
          `Action requires one of the following roles: ${allowedRoles.join(', ')}.`,
        );
      }

      let assignedLocations: string[] = [];
      try {
        const parsed = JSON.parse(membership.assignedLocationsJson);
        if (Array.isArray(parsed)) {
          assignedLocations = parsed.map(String);
        }
      } catch {
        assignedLocations = [];
      }

      req.org = {
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
        orgType: membership.orgType as OrgType,
        defaultAqiStandard: membership.defaultAqiStandard as AqiStandard,
        defaultLanguage: membership.defaultLanguage,
        role,
        assignedLocations,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

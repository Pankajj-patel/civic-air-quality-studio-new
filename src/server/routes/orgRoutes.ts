import crypto from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import { auditLogs, organizationMembers, organizations, users } from '../../db/schema.ts';
import {
  createOrgSchema,
  inviteMemberSchema,
  updateOrgSettingsSchema,
} from '../../shared/schemas/index.ts';
import { AuthenticatedRequest, requireAuth, requireOrgAccess } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { hashPassword } from '../utils/crypto.ts';

export const orgRoutes = Router();

orgRoutes.post('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createOrgSchema.parse(req.body);
    const slug = `${body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)}-${Math.random().toString(36).slice(2, 6)}`;

    const org = db.transaction((tx) => {
      const created = tx
        .insert(organizations)
        .values({
          name: body.name,
          slug,
          orgType: body.orgType,
          defaultAqiStandard: body.defaultAqiStandard,
          defaultLanguage: body.defaultLanguage,
        })
        .returning()
        .get();

      tx.insert(organizationMembers)
        .values({
          organizationId: created.id,
          userId: req.auth!.userId,
          role: 'org_admin',
          assignedLocationsJson: '[]',
        })
        .run();

      return created;
    });

    await recordAuditLog({
      organizationId: org.id,
      actorUserId: req.auth!.userId,
      action: 'ORGANIZATION_CREATED',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { name: org.name, orgType: org.orgType },
    });

    res.status(201).json({ organization: org });
  } catch (err) {
    next(err);
  }
});

orgRoutes.patch(
  '/:orgId/settings',
  requireAuth,
  requireOrgAccess(['org_admin']),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = updateOrgSettingsSchema.parse(req.body);
      const orgId = req.org!.organizationId;

      const updated = await db
        .update(organizations)
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.defaultAqiStandard ? { defaultAqiStandard: body.defaultAqiStandard } : {}),
          ...(body.defaultLanguage ? { defaultLanguage: body.defaultLanguage } : {}),
        })
        .where(eq(organizations.id, orgId))
        .returning()
        .get();

      await recordAuditLog({
        organizationId: orgId,
        actorUserId: req.auth!.userId,
        action: 'ORGANIZATION_SETTINGS_UPDATED',
        resourceType: 'organization',
        resourceId: orgId,
        metadata: body,
      });

      res.json({ organization: updated });
    } catch (err) {
      next(err);
    }
  },
);

orgRoutes.get(
  '/:orgId/members',
  requireAuth,
  requireOrgAccess(['org_admin']),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const members = await db
        .select({
          membershipId: organizationMembers.id,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          role: organizationMembers.role,
          assignedLocationsJson: organizationMembers.assignedLocationsJson,
          createdAt: organizationMembers.createdAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.organizationId, orgId));

      res.json({
        members: members.map((m) => ({
          membershipId: m.membershipId,
          userId: m.userId,
          email: m.email,
          fullName: m.fullName,
          role: m.role,
          assignedLocations: JSON.parse(m.assignedLocationsJson || '[]'),
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

orgRoutes.post(
  '/:orgId/members',
  requireAuth,
  requireOrgAccess(['org_admin']),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = inviteMemberSchema.parse(req.body);
      const orgId = req.org!.organizationId;
      const email = body.email.toLowerCase();

      const result = db.transaction((tx) => {
        let existingUser = tx
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
          .get();

        if (!existingUser) {
          if (!body.fullName) {
            throw new AppError(
              400,
              'FULL_NAME_REQUIRED',
              'Provide fullName when provisioning a new user account.',
            );
          }
          // Provision invited account with cryptographically random temporary password
          const tempPass = hashPassword(crypto.randomBytes(24).toString('base64url'));
          existingUser = tx
            .insert(users)
            .values({
              email,
              passwordHash: tempPass,
              fullName: body.fullName,
            })
            .returning()
            .get();
        }

        const membership = tx
          .insert(organizationMembers)
          .values({
            organizationId: orgId,
            userId: existingUser.id,
            role: body.role,
            assignedLocationsJson: JSON.stringify(body.assignedLocations),
          })
          .onConflictDoUpdate({
            target: [organizationMembers.organizationId, organizationMembers.userId],
            set: {
              role: body.role,
              assignedLocationsJson: JSON.stringify(body.assignedLocations),
            },
          })
          .returning()
          .get();

        return { user: existingUser, membership };
      });

      await recordAuditLog({
        organizationId: orgId,
        actorUserId: req.auth!.userId,
        action: 'MEMBER_ROLE_ASSIGNED',
        resourceType: 'organization_member',
        resourceId: result.membership.id,
        metadata: { email, role: body.role },
      });

      res.status(201).json({
        member: {
          membershipId: result.membership.id,
          userId: result.user.id,
          email: result.user.email,
          fullName: result.user.fullName,
          role: result.membership.role,
          assignedLocations: body.assignedLocations,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

orgRoutes.get(
  '/:orgId/audit-logs',
  requireAuth,
  requireOrgAccess(['org_admin']),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const logs = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          metadataJson: auditLogs.metadataJson,
          createdAt: auditLogs.createdAt,
          actorEmail: users.email,
          actorName: users.fullName,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorUserId, users.id))
        .where(eq(auditLogs.organizationId, orgId))
        .orderBy(desc(auditLogs.id))
        .limit(100);

      res.json({
        logs: logs.map((l) => ({
          id: l.id,
          action: l.action,
          resourceType: l.resourceType,
          resourceId: l.resourceId,
          metadata: JSON.parse(l.metadataJson || '{}'),
          createdAt: l.createdAt,
          actorEmail: l.actorEmail,
          actorName: l.actorName,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

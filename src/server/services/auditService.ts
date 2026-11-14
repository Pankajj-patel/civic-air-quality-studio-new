import { db } from '../../db/index.ts';
import { auditLogs } from '../../db/schema.ts';

export async function recordAuditLog(params: {
  organizationId: number;
  actorUserId?: number | null;
  action: string;
  resourceType: string;
  resourceId: string | number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: String(params.resourceId),
    metadataJson: JSON.stringify(params.metadata ?? {}),
  });
}

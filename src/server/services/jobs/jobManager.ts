import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import { backgroundJobs } from '../../../db/schema.ts';

export async function createBackgroundJob(params: {
  organizationId: number;
  jobType: 'normalize_dataset' | 'generate_briefing' | 'translate_advisory';
  payload: Record<string, unknown>;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(backgroundJobs).values({
    id,
    organizationId: params.organizationId,
    jobType: params.jobType,
    status: 'queued',
    progressPct: 0,
    payloadJson: JSON.stringify(params.payload),
  });
  return id;
}

export async function updateBackgroundJob(
  jobId: string,
  patch: {
    status?: 'queued' | 'running' | 'completed' | 'failed';
    progressPct?: number;
    resultRef?: Record<string, unknown>;
    errorMessage?: string;
  },
): Promise<void> {
  await db
    .update(backgroundJobs)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.progressPct !== undefined ? { progressPct: patch.progressPct } : {}),
      ...(patch.resultRef ? { resultRefJson: JSON.stringify(patch.resultRef) } : {}),
      ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(backgroundJobs.id, jobId));
}

export async function getBackgroundJob(organizationId: number, jobId: string) {
  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.organizationId, organizationId)))
    .limit(1);

  if (!job) return null;
  return {
    id: job.id,
    jobType: job.jobType,
    status: job.status,
    progressPct: job.progressPct,
    resultRef: job.resultRefJson ? JSON.parse(job.resultRefJson) : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

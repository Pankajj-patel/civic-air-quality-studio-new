import { Router } from 'express';
import { AuthenticatedRequest, requireAuth, requireOrgAccess } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { getBackgroundJob } from '../services/jobs/jobManager.ts';

export const jobRoutes = Router();

jobRoutes.get(
  '/:jobId',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const job = await getBackgroundJob(
        req.org!.organizationId,
        String(req.params.jobId),
      );
      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Background job not found.');
      }
      res.json({ job });
    } catch (err) {
      next(err);
    }
  },
);

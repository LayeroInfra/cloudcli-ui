import express from 'express';
import type { Request, Response } from 'express';

import { workspaceBuildsService } from '@/modules/workspace-builds/services/workspace-builds.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { username?: unknown } };

/** The session's username; the owner every build call is scoped to. Never read from the request body or query. */
function readUsername(request: Request): string {
  const username = (request as AuthenticatedRequest).user?.username;
  if (typeof username !== 'string' || !username.trim()) {
    throw new AppError('Authenticated user is required.', { code: 'USER_REQUIRED', statusCode: 401 });
  }
  return username.trim();
}

function readPositiveInt(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${field} must be a positive integer.`, { code: 'INVALID_REQUEST', statusCode: 400 });
  }
  return parsed;
}

/** Used by the app entry point, which mounts it at /api/workspace/builds behind authentication. */
export function createWorkspaceBuildsRouter(service = workspaceBuildsService) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse({ builds: await service.listBuilds(readUsername(req)) }));
  }));

  router.get('/:number', asyncHandler(async (req: Request, res: Response) => {
    const number = readPositiveInt(req.params.number, 'number');
    const stepId = req.query.step === undefined ? undefined : readPositiveInt(req.query.step, 'step');
    res.json(createApiSuccessResponse(await service.getBuild(readUsername(req), number, stepId)));
  }));

  router.post('/', asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(createApiSuccessResponse(await service.triggerBuild(readUsername(req))));
  }));

  return router;
}

export default createWorkspaceBuildsRouter();

import path from 'node:path';

import express from 'express';
import type { Request, Response } from 'express';

import { agentMemoryService } from '@/modules/agent-memory/services/agent-memory.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/**
 * Used by the app entry point, which mounts it at /api/workspace/memory behind
 * authentication. Every signed-in user sees the same memory: the workspace runs
 * as one OS user with one `~/.claude`.
 */
export function createAgentMemoryRouter(service = agentMemoryService) {
  const router = express.Router();

  router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await service.readMap()));
  }));

  router.get('/instructions', asyncHandler(async (req: Request, res: Response) => {
    const projectPath = typeof req.query.projectPath === 'string' && path.isAbsolute(req.query.projectPath)
      ? path.resolve(req.query.projectPath)
      : null;
    res.json(createApiSuccessResponse({
      ...(await service.readInstructions()),
      projectFiles: projectPath ? await service.projectInstructionFiles(projectPath) : [],
    }));
  }));

  router.put('/instructions', asyncHandler(async (req: Request, res: Response) => {
    const { content, baseUpdatedAt } = (req.body ?? {}) as { content?: unknown; baseUpdatedAt?: unknown };
    if (typeof content !== 'string') {
      throw new AppError('content must be a string.', { code: 'INVALID_REQUEST', statusCode: 400 });
    }
    if (baseUpdatedAt !== null && typeof baseUpdatedAt !== 'string') {
      throw new AppError('baseUpdatedAt must be a string or null.', { code: 'INVALID_REQUEST', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(await service.writeInstructions(content, baseUpdatedAt)));
  }));

  return router;
}

export default createAgentMemoryRouter();

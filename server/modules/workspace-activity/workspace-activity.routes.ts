import express from 'express';
import type { Request, Response } from 'express';

import { readWorkspaceActivity } from '@/modules/workspace-activity/services/workspace-activity.service.js';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'];

/**
 * True for a request made on this machine straight to the server — the
 * release promoter's curl — and false for anything that came through the
 * HTTPS gateway: Caddy also connects from 127.0.0.1, but always adds
 * X-Forwarded-For, which a client cannot strip.
 */
function isDirectLocalRequest(request: Request): boolean {
  const address = request.socket.remoteAddress ?? '';
  if (!LOOPBACK_ADDRESSES.has(address)) return false;
  return PROXY_HEADERS.every((header) => request.headers[header] === undefined);
}

/**
 * Used by the app entry point, which mounts it at /internal/workspace without
 * authentication: the deploy on the VM has no user token. It answers only
 * direct local requests and returns counts and session ids, nothing more.
 */
export function createWorkspaceActivityRouter(read = readWorkspaceActivity) {
  const router = express.Router();
  router.get('/activity', (req: Request, res: Response) => {
    if (!isDirectLocalRequest(req)) {
      res.status(404).end();
      return;
    }
    res.json(read());
  });
  return router;
}

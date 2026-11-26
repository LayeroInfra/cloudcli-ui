// agentMemoryRoutes: mounted by the app entry point at /api/workspace/memory,
// behind authentication, so the workspace UI can show Claude's auto-memory and
// edit the global CLAUDE.md every session loads.
export { default as agentMemoryRoutes } from './agent-memory.routes.js';

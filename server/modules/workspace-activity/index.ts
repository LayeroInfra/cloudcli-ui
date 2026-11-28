// createWorkspaceActivityRouter: mounted by the app entry point at
// /internal/workspace, so workspace-promote-release can ask whether an agent
// is mid-turn before it restarts the server (roadmap A7).
export { createWorkspaceActivityRouter } from './workspace-activity.routes.js';

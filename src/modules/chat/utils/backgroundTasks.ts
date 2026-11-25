import type { TFunction } from 'i18next';

import { parseToolInput } from '@/modules/chat/utils/toolGrouping';

import type { BackgroundTaskStatus, BackgroundTaskSummary, ChatMessage, SessionBackgroundTask, WorkflowAgentProgress } from '@/shared/types';

/**
 * Settles one background task's status from its two sources.
 *
 * The backend's word comes from the history load and settles the task for
 * good once it says anything but `running`: a notification it folded, or a
 * launch whose process is gone. Short of that the live stream is fresher — a
 * `task_notification` lands there before the next history refresh — and the
 * backend's `running` is only what stands when no live event has arrived.
 * Reading the live word first instead let a task the backend knew was
 * orphaned keep spinning on a stale `running` from a run that had ended.
 */
export function resolveBackgroundTaskStatus(
  serverStatus: BackgroundTaskStatus | undefined,
  liveStatus: BackgroundTaskStatus | undefined,
): BackgroundTaskStatus | undefined {
  if (serverStatus && serverStatus !== 'running') {
    return serverStatus;
  }
  return liveStatus ?? serverStatus;
}

/**
 * The status of the background task a transcript row launched, for rows that
 * launched one: a workflow (via `workflow`), an agent (via `subagent`) or any
 * call the live stream reported on (via `taskStatus`). Undefined for a row
 * that launched nothing.
 */
export function readBackgroundTaskStatus(message: ChatMessage): BackgroundTaskStatus | undefined {
  return resolveBackgroundTaskStatus(message.workflow?.status ?? message.subagent?.status, message.taskStatus?.status);
}

/**
 * The id a row's background task can be addressed by: what the live stream
 * named it, else what the launch acknowledgement reported — `taskId` for an
 * agent or workflow, the shell's `backgroundTaskId` for a backgrounded
 * command. Undefined when neither has named it.
 */
export function readBackgroundTaskId(message: ChatMessage): string | undefined {
  if (message.taskStatus?.taskId) {
    return message.taskStatus.taskId;
  }
  // A workflow's acknowledgement names its task; a backgrounded command's
  // names it `backgroundTaskId`; a background agent's carries only `agentId`,
  // which is the same id the SDK's task events use for it.
  const acknowledgement = message.toolResult?.toolUseResult as { taskId?: unknown; backgroundTaskId?: unknown; agentId?: unknown } | undefined;
  const acknowledged = acknowledgement?.taskId ?? acknowledgement?.backgroundTaskId ?? acknowledgement?.agentId;
  return typeof acknowledged === 'string' && acknowledged ? acknowledged : undefined;
}

/** A tool call that launched a background task; its id is what the task's events are keyed by. */
type BackgroundLaunchRow = ChatMessage & { toolId: string };

/** The tool calls in a transcript whose background task is still running, in transcript order. */
export function listRunningBackgroundLaunches(messages: ChatMessage[]): BackgroundLaunchRow[] {
  return messages.filter(
    (message): message is BackgroundLaunchRow =>
      Boolean(message.isToolUse && message.toolId) && readBackgroundTaskStatus(message) === 'running',
  );
}

/** The SDK's task type for what a tool launched, when no live event has said. */
const TASK_TYPE_BY_TOOL: Record<string, string> = { Workflow: 'local_workflow', Bash: 'local_bash' };

/**
 * The background tasks a transcript still has running, in the shape the
 * activity map holds them: what a session shows as background work once its
 * turn ends, until the running-sessions poll reports on it. The rows are the
 * ones the strip lists, minus any whose task nothing has named — those the
 * poll alone can report, and nothing here could stop.
 */
export function collectRunningBackgroundTasks(messages: ChatMessage[]): BackgroundTaskSummary[] {
  const tasks: BackgroundTaskSummary[] = [];
  for (const message of listRunningBackgroundLaunches(messages)) {
    const taskId = readBackgroundTaskId(message);
    if (!taskId) {
      continue;
    }
    const live = message.taskStatus;
    const workflowName = live?.workflowName ?? message.workflow?.name;
    tasks.push({
      taskId,
      toolUseId: message.toolId,
      taskType: live?.taskType ?? TASK_TYPE_BY_TOOL[message.toolName ?? ''] ?? 'local_agent',
      description: live?.description ?? message.subagent?.description ?? '',
      ...(workflowName ? { workflowName } : {}),
      // The call is the launch: the SDK's start event follows it within the
      // same second.
      startedAt: new Date(message.timestamp).getTime(),
    });
  }
  return tasks;
}

/** `1m 5s`, the way the CLI prints a task's elapsed time. */
export function formatTaskDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * The agent a running workflow is on: the running one it spawned last, by
 * the SDK's start time. Undefined between agents and before the first.
 */
export function findCurrentWorkflowAgent(agents: WorkflowAgentProgress[] | undefined): WorkflowAgentProgress | undefined {
  let current: WorkflowAgentProgress | undefined;
  for (const agent of agents ?? []) {
    if (agent.state === 'running' && (!current || (agent.startedAt ?? 0) >= (current.startedAt ?? 0))) {
      current = agent;
    }
  }
  return current;
}

/**
 * What to call a workflow agent: the label the script gave it, else the head
 * of its prompt, else its id — and for a queued slot with none of those, its
 * place in the run.
 */
export function describeWorkflowAgent(agent: Pick<WorkflowAgentProgress, 'index' | 'label' | 'agentId' | 'promptPreview'>): string {
  if (agent.label) {
    return agent.label;
  }
  const promptHead = agent.promptPreview?.split('\n', 1)[0]?.trim();
  if (promptHead) {
    return promptHead.length > 80 ? `${promptHead.slice(0, 79)}…` : promptHead;
  }
  return agent.agentId ?? `#${agent.index + 1}`;
}

/**
 * The tasks a session runs for itself. A workflow agent's own backgrounded
 * commands are listed too (so they can be stopped), but they are that agent's
 * business; the session's work is the workflow. Only when nothing but nested
 * tasks remain are they what is running.
 */
export function ownBackgroundTasks(allTasks: BackgroundTaskSummary[]): BackgroundTaskSummary[] {
  const own = allTasks.filter((task) => !task.nested);
  return own.length > 0 ? own : allTasks;
}

/** One background task by kind and name: "Workflow audit", "Agent Survey the repo", "Command npm test". */
export function describeBackgroundTask(task: BackgroundTaskSummary, t: TFunction): string {
  switch (task.taskType) {
    case 'local_workflow':
      return t('claudeStatus.backgroundTask.workflow', { name: task.workflowName ?? task.description, defaultValue: 'Workflow {{name}}' });
    case 'local_bash':
      return t('claudeStatus.backgroundTask.command', { description: task.description, defaultValue: 'Command {{description}}' });
    default:
      return t('claudeStatus.backgroundTask.agent', { description: task.description, defaultValue: 'Agent {{description}}' });
  }
}

/** The text of a tool result, whether the provider sent a string or content blocks. */
function readResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Whether a tool call launched work that outlives it, rather than running in the turn. */
function isBackgroundLaunch(message: ChatMessage): boolean {
  if (message.workflow || message.taskStatus) return true;
  const input = (parseToolInput(message.toolInput) ?? {}) as { run_in_background?: unknown };
  if (input.run_in_background === true) return true;
  const ack = message.toolResult?.toolUseResult as { backgroundTaskId?: unknown; status?: unknown; isAsync?: unknown } | undefined;
  return Boolean(ack && (typeof ack.backgroundTaskId === 'string' || ack.status === 'async_launched' || ack.isAsync === true));
}

/**
 * Used by chat's ChatInterface to hand the workspace's background-tasks drawer
 * every background task of the open session, newest first: backgrounded
 * commands, background agents and workflow runs, running or finished, each
 * with what it reported. A command has no backend status of its own, so one
 * whose result is still the launch acknowledgement counts as running.
 */
export function listSessionBackgroundTasks(messages: ChatMessage[]): SessionBackgroundTask[] {
  const tasks: SessionBackgroundTask[] = [];
  for (const message of messages) {
    if (!message.isToolUse || !message.toolId || !isBackgroundLaunch(message)) continue;
    const parsed = parseToolInput(message.toolInput);
    const input = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    const resultText = readResultText(message.toolResult?.content).trim();
    const kind: SessionBackgroundTask['kind'] = message.workflow || message.toolName === 'Workflow'
      ? 'workflow'
      : message.toolName === 'Bash' ? 'command' : 'agent';
    const command = typeof input.command === 'string' ? input.command : '';
    const inputDescription = typeof input.description === 'string' ? input.description : '';
    const title = kind === 'workflow'
      ? message.workflow?.name || message.taskStatus?.workflowName || inputDescription || 'Workflow'
      : kind === 'command'
        ? inputDescription || command || 'Command'
        : message.subagent?.description || message.taskStatus?.description || inputDescription || 'Agent';
    const detail = kind === 'command'
      ? (inputDescription ? command : undefined)
      : kind === 'workflow' && message.workflow
        ? `${message.workflow.agentCounts.completed}/${message.workflow.agentCounts.total} agents`
        : message.subagent?.type || (typeof input.subagent_type === 'string' ? input.subagent_type : undefined);
    const acknowledged = /running in background/i.test(resultText);
    const status = readBackgroundTaskStatus(message)
      ?? (message.toolResult?.isError ? 'failed' : acknowledged || !message.toolResult ? 'running' : 'completed');
    tasks.push({
      toolId: message.toolId,
      taskId: readBackgroundTaskId(message),
      kind,
      title,
      ...(detail ? { detail } : {}),
      status,
      startedAt: new Date(message.timestamp).getTime(),
      ...(resultText ? { result: resultText } : message.taskStatus?.summary ? { result: message.taskStatus.summary } : {}),
      ...(message.toolResult?.isError ? { isError: true } : {}),
    });
  }
  return tasks.reverse();
}

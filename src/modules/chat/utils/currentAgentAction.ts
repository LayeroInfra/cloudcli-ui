import type { ChatMessage, CurrentAgentAction } from '@/shared/types';
import { formatToolDisplayName } from '@/modules/chat/tools/configs/toolConfigs';
import { parseToolInput } from '@/modules/chat/utils/toolGrouping';

const MAX_TARGET = 80;

const basename = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return '';
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
};

const oneLine = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const line = value.trim().split('\n')[0] ?? '';
  return line.length > MAX_TARGET ? `${line.slice(0, MAX_TARGET - 1)}…` : line;
};

const host = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).host;
  } catch {
    return oneLine(value);
  }
};

function describeTool(name: string, rawInput: unknown): CurrentAgentAction {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
  switch (name) {
    case 'Bash':
    case 'BashOutput':
      return { verb: 'running', defaultVerb: 'Running', target: oneLine(input.description) || oneLine(input.command) };
    case 'Read':
    case 'NotebookRead':
      return { verb: 'reading', defaultVerb: 'Reading', target: basename(input.file_path ?? input.notebook_path) };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { verb: 'editing', defaultVerb: 'Editing', target: basename(input.file_path ?? input.notebook_path) };
    case 'Write':
      return { verb: 'writing', defaultVerb: 'Writing', target: basename(input.file_path) };
    case 'Grep':
    case 'Glob':
      return { verb: 'searching', defaultVerb: 'Searching', target: oneLine(input.pattern) };
    case 'WebSearch':
      return { verb: 'searching', defaultVerb: 'Searching', target: oneLine(input.query) };
    case 'WebFetch':
      return { verb: 'fetching', defaultVerb: 'Fetching', target: host(input.url) };
    case 'Task':
    case 'Agent':
      return { verb: 'agent', defaultVerb: 'Agent', target: oneLine(input.description) };
    case 'TodoWrite':
      return { verb: 'planning', defaultVerb: 'Updating checklist', target: '' };
    default:
      return { verb: 'tool', defaultVerb: 'Using', target: formatToolDisplayName(name) };
  }
}

/**
 * Used by chat's ChatInterface to tell the composer's status line what the
 * running turn is doing: the newest tool call of the turn that has no result
 * yet, else a reply or thinking still streaming. Scans back only to the
 * turn's own user message, so an earlier turn's unfinished call never shows.
 */
export function getCurrentAgentAction(messages: readonly ChatMessage[]): CurrentAgentAction | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === 'user') return null;
    if (message.isToolUse && message.toolName && !message.toolResult) {
      return describeTool(message.toolName, parseToolInput(message.toolInput));
    }
    if (message.isStreaming) {
      return message.isThinking
        ? { verb: 'thinking', defaultVerb: 'Thinking', target: '' }
        : { verb: 'replying', defaultVerb: 'Writing a reply', target: '' };
    }
  }
  return null;
}

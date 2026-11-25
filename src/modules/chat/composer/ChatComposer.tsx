import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { PaperclipIcon, PencilIcon } from 'lucide-react';

import { MCP_ELICITATION_TOOL_NAME } from '@/shared/constants';
import type { AttachmentRejection, CurrentAgentAction, BackgroundSendChoice, BackgroundSendPrompt, PendingSteer, QueuedDraft, ScheduledMessage, SlashCommand,SessionActivity,PendingPermissionRequest,PermissionMode,ProviderModelOption } from '@/shared/types';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputButton,
  PromptInputSubmit,
} from '@/modules/chat/composer/PromptInput';
import CommandMenu from '@/modules/chat/composer/CommandMenu';
import ActivityIndicator from '@/modules/chat/composer/ActivityIndicator';
import ComposerAttachment from '@/modules/chat/composer/ComposerAttachment';
import AttachmentRejectionNotice from '@/modules/chat/composer/AttachmentRejectionNotice';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import QueuedMessageCard from '@/modules/chat/composer/QueuedMessageCard';
import SteeredMessageCard from '@/modules/chat/composer/SteeredMessageCard';
import BackgroundSendDialog from '@/modules/chat/composer/BackgroundSendDialog';
import { ScheduledMessageList } from '@/modules/chat/composer/ScheduledMessageList';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import ComposerPermissionMenu from '@/modules/chat/composer/ComposerPermissionMenu';
import ComposerSendMenu from '@/modules/chat/composer/ComposerSendMenu';
import ComposerContextMeter from '@/modules/chat/composer/ComposerContextMeter';

type MentionableFile = {
  name: string;
  path: string;
};

// A stable empty default, so a composer with no steered messages (every
// caller but the chat tab) does not get a new array each render.
const NO_PENDING_STEERS: PendingSteer[] = [];

type ChatComposerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  /** The session whose context window the meter shows; null before the first send. */
  contextSessionId?: string | null;
  /** Changes when the turn starts or settles, so the context meter refetches. */
  contextRefreshKey?: unknown;
  /** What the running turn is doing now, for the status line; null when unknown. */
  currentAction?: CurrentAgentAction | null;
  isLoading: boolean;
  onAbortSession: () => void;
  /** Whether the viewed session can currently be interrupted; threaded to the send menu's Stop row, which otherwise looks actionable while `onAbortSession` already no-ops. Defaults to true so existing callers and tests, which never had a non-interruptible turn, keep working. */
  canAbortSession?: boolean;
  permissionMode: PermissionMode;
  availablePermissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  providerLabel: string;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  backgroundSendPrompt: BackgroundSendPrompt | null;
  onResolveBackgroundSendPrompt: (choice: BackgroundSendChoice) => void;
  /** Set while the composer is replacing an already-sent message. */
  isEditingSentMessage: boolean;
  onCancelEditMessage: () => void;
  /** Messages already waiting to be sent to this session later; listed so they can be cancelled. */
  scheduledMessages: ScheduledMessage[];
  onCancelScheduledMessage: (id: string) => void;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  /** Handle send menu choices (queue, steer, side question, send). */
  onSendMenuChoice?: (choice: 'queue' | 'steer' | 'sideQuestion' | 'send') => void;
  /** False until the capability matrix has loaded, or for a provider it does not list; passed through to the send menu and the background-send dialog so neither offers a side question that would be refused. */
  supportsSideQuestions?: boolean;
  /** Whether the provider can take a message into a running turn; gates the send menu's Steer row the same way `supportsSideQuestions` gates its row. */
  supportsSteering?: boolean;
  /** Messages sent into the running turn that the agent has not read yet, each shown as a card above the composer until its echo lands in the transcript. */
  pendingSteers?: PendingSteer[];
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  /** Files the latest attach attempt refused (too large, or past the count limit), listed in a notice above the chips. */
  attachmentRejections: AttachmentRejection[];
  onDismissAttachmentRejections: () => void;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openAttachmentPicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
};

/**
 * Rendered by chat's ChatInterface as the whole input area: the textarea, the
 * attached files, queued and scheduled messages, the permission banner, and
 * the permission/model menus and send/stop button that drive the next turn.
 */
export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  currentAction = null,
  contextSessionId = null,
  contextRefreshKey,
  isLoading,
  onAbortSession,
  canAbortSession = true,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  providerLabel,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  onSubmit,
  isDragActive,
  queuedDraft,
  backgroundSendPrompt,
  onResolveBackgroundSendPrompt,
  isEditingSentMessage,
  onCancelEditMessage,
  scheduledMessages,
  onCancelScheduledMessage,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  onSendMenuChoice,
  supportsSideQuestions,
  supportsSteering = false,
  pendingSteers = NO_PENDING_STEERS,
  attachedFiles,
  onRemoveAttachment,
  attachmentRejections,
  onDismissAttachmentRejections,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openAttachmentPicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const fileDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  useEffect(() => {
    const dropdown = fileDropdownRef.current;
    const selectedFile = selectedFileRef.current;
    if (!showFileDropdown || !dropdown || !selectedFile) {
      return;
    }

    const itemTop = selectedFile.offsetTop;
    const itemBottom = itemTop + selectedFile.offsetHeight;
    const visibleTop = dropdown.scrollTop;
    const visibleBottom = visibleTop + dropdown.clientHeight;

    if (itemTop < visibleTop) {
      dropdown.scrollTop = itemTop;
    } else if (itemBottom > visibleBottom) {
      dropdown.scrollTop = itemBottom - dropdown.clientHeight;
    }
  }, [selectedFileIndex, showFileDropdown]);

  // Detect if an interactive panel that takes the person's answer is active:
  // a question from the agent, or an MCP server's request for input.
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion' || r.toolName === MCP_ELICITATION_TOOL_NAME
  );

  // Hide the status line while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;

  const hasAnyInput = Boolean(input.trim() || attachedFiles.length > 0);
  // With an empty composer during a turn the button is the one-tap Stop,
  // so it says so to screen readers as it did before the send menu existed.
  const submitAriaLabel = isLoading && !hasAnyInput ? t('input.stop') : t('input.send');

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-3">
      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 chat-content-width">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            providerLabel={providerLabel}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      <ScheduledMessageList
        scheduledMessages={scheduledMessages}
        onCancel={onCancelScheduledMessage}
      />

      {isEditingSentMessage && (
        <div className="mx-auto mb-2 flex chat-content-width items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <PencilIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1">
            {t('composer.editing.title')}
            {' — '}
            <span className="text-muted-foreground">{t('composer.editing.filesNotReverted')}</span>
          </span>
          <button
            type="button"
            onClick={onCancelEditMessage}
            className="shrink-0 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('composer.editing.cancel')}
          </button>
        </div>
      )}

      <BackgroundSendDialog
        prompt={backgroundSendPrompt}
        supportsSideQuestions={supportsSideQuestions}
        hasText={Boolean(input.trim())}
        onResolve={onResolveBackgroundSendPrompt}
      />

      {pendingSteers.map((steer) => (
        <SteeredMessageCard key={steer.messageId} steer={steer} providerLabel={providerLabel} />
      ))}

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          attachmentCount={
            queuedDraft.uploadedAttachments?.length ?? queuedDraft.attachments.length
          }
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
        />
      )}

      {!hasQuestionPanel && <div className="relative mx-auto chat-content-width">
        {showFileDropdown && filteredFiles.length > 0 && (
          <div
            ref={fileDropdownRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md"
          >
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                ref={index === selectedFileIndex ? selectedFileRef : undefined}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={isTextareaExpanded ? 'chat-input-expanded' : undefined}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop files here</p>
              </div>
            </div>
          )}

          {(attachmentRejections.length > 0 || attachedFiles.length > 0) && (
            <PromptInputHeader className="flex flex-col gap-2">
              <AttachmentRejectionNotice
                rejections={attachmentRejections}
                onDismiss={onDismissAttachmentRejections}
              />
              {attachedFiles.length > 0 && (
                <div className="rounded-xl bg-muted/40 p-2">
                  <div className="flex flex-wrap gap-2">
                    {attachedFiles.map((file, index) => (
                      <ComposerAttachment
                        key={`${file.name}-${file.lastModified}-${index}`}
                        file={file}
                        onRemove={() => onRemoveAttachment(index)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />

          {/* What the agent is doing now, inside the card rather than as a tab
              above it; hidden while a permission request asks for a decision. */}
          {!hasPendingPermissions && <ActivityIndicator activity={activity} action={currentAction} />}

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        {/* One quiet row, as in Claude and ChatGPT: attach and the context meter on the left; the
            permission mode, the model and send/stop on the right. Slash
            commands, /clear and /cost stay available by typing. */}
        <PromptInputFooter>
          <PromptInputButton
            tooltip={{ content: t('input.attachFiles') }}
            onClick={openAttachmentPicker}
            aria-label={t('input.attachFiles')}
            className="text-muted-foreground hover:text-foreground"
          >
            <PaperclipIcon />
          </PromptInputButton>

          <ComposerContextMeter sessionId={contextSessionId} refreshKey={contextRefreshKey} />

          <div className="ml-auto flex min-w-0 items-center gap-0.5">
            <ComposerPermissionMenu
              permissionMode={permissionMode}
              permissionModes={availablePermissionModes}
              onSelectPermissionMode={onSelectPermissionMode}
              providerLabel={providerLabel}
            />

            <ComposerModelMenu
              effort={effort}
              effortOptions={availableEffortOptions}
              onSelectEffort={onSelectEffort}
              model={model}
              modelOptions={availableModelOptions}
              onSelectModel={onSelectModel}
              modelsLoading={modelsLoading}
            />

            {(isLoading || activity?.background) && hasAnyInput ? (
              // The caret-trigger menu only replaces the plain button when there is
              // something to send: an empty composer during a turn keeps the
              // one-tap ■ Stop below, and an empty composer during background
              // work keeps the plain disabled ↑.
              <ComposerSendMenu
                state={isLoading ? 'responding' : 'background'}
                hasInput={hasAnyInput}
                hasText={Boolean(input.trim())}
                canAbortSession={canAbortSession}
                supportsSideQuestions={supportsSideQuestions}
                supportsSteering={supportsSteering}
                sendByCtrlEnter={sendByCtrlEnter}
                onSelect={(choice) => {
                  if (choice === 'stop') {
                    onAbortSession();
                    return;
                  }
                  onSendMenuChoice?.(choice);
                }}
              />
            ) : (
              <PromptInputSubmit
                onClick={isLoading ? onAbortSession : undefined}
                // With an empty composer during a turn this button is the
                // one-tap Stop, so it disables on `canAbortSession` exactly
                // like the send menu's Stop row does.
                disabled={isLoading ? !canAbortSession : !hasAnyInput}
                aria-label={submitAriaLabel}
                title={submitAriaLabel}
                className="ml-1"
              />
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}

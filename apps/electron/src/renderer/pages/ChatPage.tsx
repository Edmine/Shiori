/**
 * ChatPage
 *
 * Displays a single session's chat with a consistent PanelHeader.
 * Extracted from MainContentPanel for consistency with other pages.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, FolderOpen, GitBranch, X } from 'lucide-react'
import type { FileLinkClick } from '@craft-agent/ui'
import type { GitStatusSummary } from '@craft-agent/shared/protocol'
import { ChatDisplay, type ChatDisplayHandle } from '@/components/app-shell/ChatDisplay'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ChatHeader } from '@/components/app-shell/chat-header/ChatHeader'
import { SessionFilesSection } from '@/components/right-sidebar/SessionFilesSection'
import { GitDiffDrawer } from '@/components/right-sidebar/GitDiffDrawer'
import { SHIORI_TOGGLE_RIGHT_PANEL_EVENT } from '@/components/app-shell/ShioriCommandPalette'
import { appendFileMentionToDraft } from '@/components/app-shell/command-palette-helpers'
import { dispatchFocusInputEvent } from '@/components/app-shell/input/focus-input-events'
import { useAction } from '@/actions'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { rendererPerf } from '@/lib/perf'
import { isAbsolutePath } from '@/lib/drafts'
import { coerceInputText } from '@/lib/input-text'
import { deriveSessionMessagesLoadState, formatSessionLoadFailure } from '@/lib/session-load'
import { ensureSessionMessagesLoadedAtom, forceSessionMessagesReloadAtom, loadedSessionsAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import { usePrWatch } from '@/hooks/usePrWatch'
// Model resolution: connection.defaultModel (no hardcoded defaults)
import { resolveEffectiveConnectionSlug, isSessionConnectionUnavailable } from '@config/llm-connections'

export interface ChatPageProps {
  sessionId: string
}

const ChatPage = React.memo(function ChatPage({ sessionId }: ChatPageProps) {
  const { t } = useTranslation()
  // Diagnostic: mark when component runs
  React.useLayoutEffect(() => {
    rendererPerf.markSessionSwitch(sessionId, 'panel.mounted')
  }, [sessionId])

  const {
    activeWorkspaceId,
    llmConnections,
    workspaceDefaultLlmConnection,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    workspaces,
    onRespondToPermission,
    onRespondToCredential,
    onSetActiveViewingSession,
    getDraft,
    hydrateDraftAttachments,
    onInputChange,
    onAttachmentsChange,
    enabledSources,
    skills,
    chatStarters,
    labels,
    onSessionLabelsChange,
    enabledModes,
    onSessionSourcesChange,
    rightSidebarButton,
    leadingAction,
    isCompactMode,
    sessionListSearchQuery,
    isSearchModeActive,
    chatDisplayRef,
    onChatMatchInfoChange,
    isFocusedPanel,
  } = useAppShellContext()

  // Use the unified session options hook for clean access
  const {
    options: sessionOpts,
    setOption,
    setPermissionMode,
  } = useSessionOptionsFor(sessionId)

  // Use per-session atom for isolated updates
  const session = useSessionData(sessionId)

  // Track if messages are loaded for this session (for lazy loading)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const messagesLoaded = loadedSessions.has(sessionId)

  // Check if session exists in metadata (for loading state detection)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = sessionMetaMap.get(sessionId)

  // Fallback: ensure messages are loaded when session is viewed
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const forceMessagesReload = useSetAtom(forceSessionMessagesReloadAtom)
  const [messagesLoadError, setMessagesLoadError] = React.useState<string | null>(null)
  const [messagesRetrying, setMessagesRetrying] = React.useState(false)
  const autoForcedReloadSessionRef = React.useRef<string | null>(null)
  const shouldForceInitialMessagesReload = React.useMemo(() => {
    const expectedMessageCount = session?.messageCount ?? sessionMeta?.messageCount ?? 0
    return messagesLoaded
      && !!session
      && (session.messages?.length ?? 0) === 0
      && (expectedMessageCount > 0 || !!session.lastFinalMessageId || !!sessionMeta?.lastFinalMessageId)
  }, [messagesLoaded, session, sessionMeta])

  React.useEffect(() => {
    let cancelled = false
    setMessagesLoadError(null)
    setMessagesRetrying(false)

    if (shouldForceInitialMessagesReload && autoForcedReloadSessionRef.current === sessionId) {
      setMessagesLoadError('Session messages are not available')
      return () => {
        cancelled = true
      }
    }

    const useForceReload = shouldForceInitialMessagesReload
    if (useForceReload) {
      autoForcedReloadSessionRef.current = sessionId
    }

    const loadPromise = useForceReload
      ? forceMessagesReload(sessionId)
      : ensureMessagesLoaded(sessionId)

    loadPromise
      .then((loadedSession) => {
        if (!cancelled && !loadedSession) {
          setMessagesLoadError('Session messages are not available')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessagesLoadError(formatSessionLoadFailure(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, ensureMessagesLoaded, forceMessagesReload, shouldForceInitialMessagesReload])

  const handleRetryMessagesLoad = React.useCallback(async () => {
    setMessagesLoadError(null)
    setMessagesRetrying(true)

    try {
      const loadedSession = await forceMessagesReload(sessionId)
      if (!loadedSession) {
        setMessagesLoadError('Session messages are not available')
      }
    } catch (error) {
      setMessagesLoadError(formatSessionLoadFailure(error))
    } finally {
      setMessagesRetrying(false)
    }
  }, [forceMessagesReload, sessionId])

  const messageLoadState = React.useMemo(() => deriveSessionMessagesLoadState({
    session,
    sessionMeta,
    messagesLoaded,
    loadError: messagesLoadError,
  }), [session, sessionMeta, messagesLoaded, messagesLoadError])

  // Perf: Mark when session data is available
  const sessionLoadedMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (session && sessionLoadedMarkedRef.current !== sessionId) {
      sessionLoadedMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'session.loaded')
    }
  }, [sessionId, session])

  // Track window focus state for marking session as read when app regains focus
  const [isWindowFocused, setIsWindowFocused] = React.useState(true)
  React.useEffect(() => {
    window.electronAPI.getWindowFocusState().then(setIsWindowFocused)
    const cleanup = window.electronAPI.onWindowFocusChange(setIsWindowFocused)
    return cleanup
  }, [])

  // Track which session user is viewing (for unread state machine).
  // This tells main process user is looking at this session, so:
  // 1. If not processing → clear hasUnread immediately
  // 2. If processing → when it completes, main process will clear hasUnread
  // The main process handles all the logic; we just report viewing state.
  React.useEffect(() => {
    if (session && isWindowFocused && isFocusedPanel !== false) {
      onSetActiveViewingSession(session.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, isWindowFocused, isFocusedPanel, onSetActiveViewingSession])

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(sessionId)
  const pendingCredential = usePendingCredential(sessionId)

  // Track draft value for this session
  const [inputValue, setInputValue] = React.useState(() => coerceInputText(getDraft(sessionId)))
  const inputValueRef = React.useRef(inputValue)
  inputValueRef.current = inputValue

  // Re-sync from parent when session changes
  React.useEffect(() => {
    setInputValue(coerceInputText(getDraft(sessionId)))
  }, [getDraft, sessionId])

  // Sync when draft is set externally (e.g., from notifications or shortcuts)
  // PERFORMANCE NOTE: This bounded polling (max 10 attempts × 50ms = 500ms)
  // handles external draft injection. Drafts use a ref for typing performance,
  // so they're not directly reactive. This polling only runs on session switch,
  // not continuously. Alternative: Add a Jotai atom for draft changes.
  React.useEffect(() => {
    let attempts = 0
    const maxAttempts = 10
    const interval = setInterval(() => {
      const currentDraft = coerceInputText(getDraft(sessionId))
      if (currentDraft !== inputValueRef.current && currentDraft !== '') {
        setInputValue(currentDraft)
        clearInterval(interval)
      }
      attempts++
      if (attempts >= maxAttempts) {
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [sessionId, getDraft])

  // Listen for restore-input events (queued messages restored to input on abort)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId: targetId, text } = (e as CustomEvent).detail ?? {}
      if (targetId === sessionId) {
        const nextText = coerceInputText(text)
        setInputValue(nextText)
        inputValueRef.current = nextText
      }
    }
    window.addEventListener('craft:restore-input', handler)
    return () => window.removeEventListener('craft:restore-input', handler)
  }, [sessionId])

  const handleInputChange = React.useCallback((value: string) => {
    const nextText = coerceInputText(value)
    setInputValue(nextText)
    inputValueRef.current = nextText
    onInputChange(sessionId, nextText)
  }, [sessionId, onInputChange])

  // Attachments draft state — hydrated async from persisted refs on session switch.
  // `[]` is the safe default while hydration is in flight; FreeFormInput seeds its
  // local state from this prop and swaps in the restored list when ready.
  const [attachmentsValue, setAttachmentsValue] = React.useState<import('../../shared/types').FileAttachment[]>([])

  React.useEffect(() => {
    let cancelled = false
    setAttachmentsValue([])
    hydrateDraftAttachments(sessionId).then((atts) => {
      if (!cancelled) setAttachmentsValue(atts)
    })
    return () => { cancelled = true }
  }, [sessionId, hydrateDraftAttachments])

  const handleAttachmentsChange = React.useCallback((attachments: import('../../shared/types').FileAttachment[]) => {
    setAttachmentsValue(attachments)
    onAttachmentsChange(sessionId, attachments)
  }, [sessionId, onAttachmentsChange])

  // Session model change handler - persists per-session model and connection
  const handleModelChange = React.useCallback((model: string, connection?: string) => {
    if (activeWorkspaceId) {
      window.electronAPI.setSessionModel(sessionId, activeWorkspaceId, model, connection)
    }
  }, [sessionId, activeWorkspaceId])

  // Session connection change handler - can only change before first message
  const handleConnectionChange = React.useCallback(async (connectionSlug: string) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setConnection', connectionSlug })
    } catch (error) {
      // Connection change may fail if session already started or connection is invalid
      console.error('Failed to change connection:', error)
    }
  }, [sessionId])

  // Check if session's locked connection has been removed
  const connectionUnavailable = React.useMemo(() =>
    isSessionConnectionUnavailable(session?.llmConnection, llmConnections),
    [session?.llmConnection, llmConnections]
  )

  // Effective model for this session (session-specific or global fallback)
  const effectiveModel = React.useMemo(() => {
    if (session?.model) return session.model

    // When connection is unavailable, don't resolve through a different connection
    if (connectionUnavailable) return session?.model ?? ''

    const connectionSlug = resolveEffectiveConnectionSlug(
      session?.llmConnection, workspaceDefaultLlmConnection, llmConnections
    )
    const connection = connectionSlug ? llmConnections.find(c => c.slug === connectionSlug) : null

    return connection?.defaultModel ?? ''
  }, [session?.id, session?.model, session?.llmConnection, workspaceDefaultLlmConnection, llmConnections, connectionUnavailable])

  // Working directory for this session
  const workingDirectory = session?.workingDirectory
  // Coding mode's header PR chip: desktop only, with a folder. The chip itself renders only once that
  // folder is a git repo whose branch has a PR (see ChatHeaderPrChip).
  const prWatch = usePrWatch(sessionId, !!sessionOpts.codingMode && !!workingDirectory && !isCompactMode, workingDirectory)
  const activeWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId]
  )
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (!session) return
    await window.electronAPI.sessionCommand(session.id, { type: 'updateWorkingDirectory', dir: path })
  }, [session])

  // Keeps the link click (`click`) on every path, so the file-link menu opens next to the link.
  const handleOpenFile = React.useCallback(
    async (path: string, click?: FileLinkClick) => {
      // Resolve bare relative paths against session working directory,
      // or workspace root as a fallback when workingDirectory is not set.
      const resolved = (() => {
        // Absolute paths (POSIX `/…`, Windows `C:\…`) and `~/…` are used as-is.
        // Using a cross-platform check here fixes Windows preview failures where a
        // `C:\…` path was wrongly treated as relative and re-prefixed with the
        // workspace root, producing a doubled, non-existent path (#922/#875).
        if (isAbsolutePath(path) || path.startsWith('~/')) return path

        const baseDir = workingDirectory || activeWorkspace?.rootPath
        if (!baseDir) return path

        const cleanedBase = baseDir.replace(/\/+$/, '')
        const cleanedPath = path.replace(/^\.\//, '')
        return `${cleanedBase}/${cleanedPath}`
      })()

      // Smart fallback for missing files in AI output:
      // if the exact path doesn't exist, search nearby for same basename
      // (e.g. markdown/linkify.test.ts -> markdown/__tests__/linkify.test.ts).
      if (isAbsolutePath(resolved)) {
        // Backslash-aware so the fallback also runs for `C:\…` paths (#922)
        const lastSlash = Math.max(resolved.lastIndexOf('/'), resolved.lastIndexOf('\\'))
        if (lastSlash > 0 && lastSlash < resolved.length - 1) {
          const parentDir = resolved.slice(0, lastSlash)
          const fileName = resolved.slice(lastSlash + 1)
          try {
            const matches = await window.electronAPI.searchFiles(parentDir, fileName)
            const files = matches.filter((m) => m.type === 'file' && m.name === fileName)
            const exact = files.find((m) => m.path === resolved)
            if (exact) {
              onOpenFile(exact.path, click)
              return
            }

            if (files.length === 1) {
              onOpenFile(files[0].path, click)
              toast.info(t('chat.openedClosestMatch', { path: files[0].relativePath }))
              return
            }
          } catch {
            // Search fallback is best-effort; proceed with original resolved path.
          }
        }
      }

      onOpenFile(resolved, click)
    },
    [onOpenFile, workingDirectory, activeWorkspace?.rootPath, t]
  )

  const handleOpenUrl = React.useCallback(
    (url: string) => {
      onOpenUrl(url)
    },
    [onOpenUrl]
  )

  // Perf: Mark when data is ready
  const dataReadyMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (messageLoadState.messagesReady && session && dataReadyMarkedRef.current !== sessionId) {
      dataReadyMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'data.ready')
    }
  }, [sessionId, messageLoadState.messagesReady, session])

  // Perf: Mark render complete after paint
  React.useEffect(() => {
    if (session) {
      const rafId = requestAnimationFrame(() => {
        rendererPerf.endSessionSwitch(sessionId)
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [sessionId, session])

  // Get display title for header - use getSessionTitle for consistent fallback logic with SessionList
  // Priority: name > first user message > preview > "New chat"
  const displayTitle = session ? getSessionTitle(session) : (sessionMeta ? getSessionTitle(sessionMeta) : t('chat.session'))
  const sharedUrl = session?.sharedUrl || sessionMeta?.sharedUrl || null
  // Use isAsyncOperationOngoing for shimmer effect (sharing, updating share, revoking, title regeneration)
  const isAsyncOperationOngoing = session?.isAsyncOperationOngoing || sessionMeta?.isAsyncOperationOngoing || false

  // On-demand collapsible right review drawer ('diff' | 'files' | null; closed by default)
  const [rightPanelTab, setRightPanelTab] = React.useState<'diff' | 'files' | null>(null)
  const [diffDrawerWidth, setDiffDrawerWidth] = React.useState<number>(() => {
    try {
      const stored = window.localStorage.getItem('shiori:diff-drawer-width')
      const parsed = stored ? Number(stored) : NaN
      if (Number.isFinite(parsed) && parsed >= 340 && parsed <= 760) return parsed
    } catch {
      // ignore storage errors
    }
    return 468
  })
  const [isResizingDrawer, setIsResizingDrawer] = React.useState(false)
  const handleToggleFilesPanel = React.useCallback(() => {
    setRightPanelTab((prev) => (prev === 'files' ? null : 'files'))
  }, [])
  const handleToggleDiffPanel = React.useCallback(() => {
    setRightPanelTab((prev) => (prev === 'diff' ? null : 'diff'))
  }, [])

  useAction('view.toggleDiffDrawer', handleToggleDiffPanel, {
    enabled: () => isFocusedPanel !== false && !isCompactMode,
  })

  React.useEffect(() => {
    const handler = (event: Event) => {
      if (isFocusedPanel === false || isCompactMode) return
      const detail = (event as CustomEvent<{ tab?: 'diff' | 'files' }>).detail
      if (detail?.tab === 'diff') {
        setRightPanelTab((prev) => (prev === 'diff' ? null : 'diff'))
      } else if (detail?.tab === 'files') {
        setRightPanelTab((prev) => (prev === 'files' ? null : 'files'))
      }
    }
    window.addEventListener(SHIORI_TOGGLE_RIGHT_PANEL_EVENT, handler)
    return () => window.removeEventListener(SHIORI_TOGGLE_RIGHT_PANEL_EVENT, handler)
  }, [isFocusedPanel, isCompactMode])

  const handleMentionDiffFile = React.useCallback(
    (relativePath: string) => {
      const nextText = appendFileMentionToDraft(inputValueRef.current, relativePath)
      handleInputChange(nextText)
      dispatchFocusInputEvent({ sessionId })
    },
    [handleInputChange, sessionId],
  )

  const handleStartDrawerResize = React.useCallback(
    (startEvent: React.MouseEvent<HTMLDivElement>) => {
      if (rightPanelTab !== 'diff') return
      startEvent.preventDefault()
      const startX = startEvent.clientX
      const startWidth = diffDrawerWidth
      setIsResizingDrawer(true)

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX
        const maxWidth = Math.min(760, Math.max(360, Math.floor(window.innerWidth * 0.56)))
        const nextWidth = Math.min(maxWidth, Math.max(340, startWidth + delta))
        setDiffDrawerWidth(nextWidth)
      }

      const handleMouseUp = () => {
        setIsResizingDrawer(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [rightPanelTab, diffDrawerWidth],
  )

  React.useEffect(() => {
    if (isResizingDrawer) return
    try {
      window.localStorage.setItem('shiori:diff-drawer-width', String(diffDrawerWidth))
    } catch {
      // ignore storage errors
    }
  }, [diffDrawerWidth, isResizingDrawer])

  // Live Git status tracking for the active session's working directory
  const effectiveGitDir = workingDirectory || activeWorkspace?.rootPath
  const [gitStatus, setGitStatus] = React.useState<GitStatusSummary | null>(null)
  const [gitStatusLoading, setGitStatusLoading] = React.useState(false)

  const refreshGitStatus = React.useCallback(() => {
    if (!effectiveGitDir || isCompactMode) {
      setGitStatus(null)
      return
    }
    setGitStatusLoading(true)
    window.electronAPI
      .getGitStatus(effectiveGitDir)
      .then((summary) => {
        setGitStatus(summary)
      })
      .catch(() => {
        setGitStatus(null)
      })
      .finally(() => {
        setGitStatusLoading(false)
      })
  }, [effectiveGitDir, isCompactMode])

  // Fetch on directory / session mount
  React.useEffect(() => {
    refreshGitStatus()
  }, [refreshGitStatus, sessionId])

  // Refresh automatically whenever an agent turn completes (isProcessing: true -> false)
  const wasProcessingRef = React.useRef<boolean>(false)
  const isCurrentlyProcessing = Boolean(session?.isProcessing ?? sessionMeta?.isProcessing)
  React.useEffect(() => {
    if (wasProcessingRef.current && !isCurrentlyProcessing) {
      refreshGitStatus()
    }
    wasProcessingRef.current = isCurrentlyProcessing
  }, [isCurrentlyProcessing, refreshGitStatus])

  // Refresh when the user opens the Diff tab
  React.useEffect(() => {
    if (rightPanelTab === 'diff') {
      refreshGitStatus()
    }
  }, [rightPanelTab, refreshGitStatus])

  // Handle missing session - loading or deleted
  if (!session) {
    if (sessionMeta) {
      // Session exists in metadata but not loaded yet - show loading state
      const skeletonSession = {
        id: sessionMeta.id,
        workspaceId: sessionMeta.workspaceId,
        workspaceName: '',
        name: sessionMeta.name,
        preview: sessionMeta.preview,
        lastMessageAt: sessionMeta.lastMessageAt || 0,
        messages: [],
        isProcessing: sessionMeta.isProcessing || false,
        isFlagged: sessionMeta.isFlagged,
        workingDirectory: sessionMeta.workingDirectory,
        enabledSourceSlugs: sessionMeta.enabledSourceSlugs,
      }

      return (
        <div className="h-full flex flex-col">
          <ChatHeader
            sessionId={sessionId}
            item={sessionMeta}
            title={displayTitle}
            isRegeneratingTitle={isAsyncOperationOngoing}
            sharedUrl={sharedUrl}
            workingDirectory={sessionMeta.workingDirectory}
          />
          <div className="flex-1 flex flex-col min-h-0">
            <ChatDisplay
              ref={chatDisplayRef}
              session={skeletonSession}
              onSendMessage={() => {}}
              onOpenFile={handleOpenFile}
              onOpenUrl={handleOpenUrl}
              currentModel={effectiveModel}
              onModelChange={handleModelChange}
              onConnectionChange={handleConnectionChange}
              pendingPermission={undefined}
              onRespondToPermission={onRespondToPermission}
              pendingCredential={undefined}
              onRespondToCredential={onRespondToCredential}
              thinkingLevel={sessionOpts.thinkingLevel}
              onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
              codingMode={sessionOpts.codingMode}
              onCodingModeChange={(enabled) => setOption('codingMode', enabled)}
              permissionMode={sessionOpts.permissionMode}
              previousPermissionMode={sessionOpts.previousPermissionMode}
              onPermissionModeChange={setPermissionMode}
              enabledModes={enabledModes}
              inputValue={inputValue}
              onInputChange={handleInputChange}
              attachmentsValue={attachmentsValue}
              onAttachmentsChange={handleAttachmentsChange}
              sources={enabledSources}
              skills={skills}
              chatStarters={chatStarters}
              workspaceId={activeWorkspaceId || undefined}
              onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
              workingDirectory={sessionMeta.workingDirectory}
              onWorkingDirectoryChange={handleWorkingDirectoryChange}
              messagesLoading={messageLoadState.messagesLoading || (messagesRetrying && !messageLoadState.messagesReady)}
              messagesLoadError={messageLoadState.error}
              messagesRetrying={messagesRetrying}
              onRetryMessagesLoad={handleRetryMessagesLoad}
              searchQuery={sessionListSearchQuery}
              isSearchModeActive={isSearchModeActive}
              onMatchInfoChange={onChatMatchInfoChange}
              connectionUnavailable={connectionUnavailable}
              compactMode={!!isCompactMode}
              enableCompactModelPicker={!!isCompactMode}
            />
          </div>
        </div>
      )
    }

    // Session truly doesn't exist
    return (
      <div className="h-full flex flex-col">
        <PanelHeader  title={t('chat.session')} leadingAction={leadingAction} rightSidebarButton={rightSidebarButton} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">{t('chat.sessionNoLongerExists')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <ChatHeader
        sessionId={sessionId}
        item={sessionMeta}
        title={displayTitle}
        isRegeneratingTitle={isAsyncOperationOngoing}
        sharedUrl={sharedUrl}
        workingDirectory={workingDirectory}
        sessionFolderPath={session?.sessionFolderPath}
        prWatch={prWatch.state}
        prWatchNav={prWatch.nav}
        prWatchActiveOrigin={prWatch.activeOrigin}
        onRefreshPrWatch={prWatch.refresh}
        onUnbindPr={prWatch.unbind}
        onSetPrAutoMerge={prWatch.setAutoMerge}
        prWatchAutoFix={prWatch.autoFix}
        onSetPrAutoFix={prWatch.setAutoFix}
        onPrCardOpenChange={prWatch.onCardOpenChange}
        isFilesPanelOpen={rightPanelTab === 'files'}
        onToggleFilesPanel={handleToggleFilesPanel}
        gitStatus={gitStatus}
        isDiffPanelOpen={rightPanelTab === 'diff'}
        onToggleDiffPanel={handleToggleDiffPanel}
      />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ChatDisplay
          ref={chatDisplayRef}
          session={session}
          onSendMessage={(message, attachments, skillSlugs) => {
            if (session) {
              onSendMessage(session.id, message, attachments, skillSlugs)
            }
          }}
          onOpenFile={handleOpenFile}
          onOpenUrl={handleOpenUrl}
          currentModel={effectiveModel}
          onModelChange={handleModelChange}
          onConnectionChange={handleConnectionChange}
          pendingPermission={pendingPermission}
          onRespondToPermission={onRespondToPermission}
          pendingCredential={pendingCredential}
          onRespondToCredential={onRespondToCredential}
          thinkingLevel={sessionOpts.thinkingLevel}
          onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
          codingMode={sessionOpts.codingMode}
          onCodingModeChange={(enabled) => setOption('codingMode', enabled)}
          permissionMode={sessionOpts.permissionMode}
          previousPermissionMode={sessionOpts.previousPermissionMode}
          onPermissionModeChange={setPermissionMode}
          enabledModes={enabledModes}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          attachmentsValue={attachmentsValue}
          onAttachmentsChange={handleAttachmentsChange}
          sources={enabledSources}
          skills={skills}
          chatStarters={chatStarters}
          labels={labels}
          onLabelsChange={(newLabels) => onSessionLabelsChange?.(sessionId, newLabels)}
          workspaceId={activeWorkspaceId || undefined}
          onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
          workingDirectory={workingDirectory}
          onWorkingDirectoryChange={handleWorkingDirectoryChange}
          sessionFolderPath={session?.sessionFolderPath}
          messagesLoading={messageLoadState.messagesLoading || (messagesRetrying && !messageLoadState.messagesReady)}
          messagesLoadError={messageLoadState.error}
          messagesRetrying={messagesRetrying}
          onRetryMessagesLoad={handleRetryMessagesLoad}
          searchQuery={sessionListSearchQuery}
          isSearchModeActive={isSearchModeActive}
          onMatchInfoChange={onChatMatchInfoChange}
          connectionUnavailable={connectionUnavailable}
          compactMode={!!isCompactMode}
          enableCompactModelPicker={!!isCompactMode}
        />
        </div>
        {!isCompactMode && rightPanelTab !== null && (
          <aside
            aria-label={
              rightPanelTab === 'diff'
                ? t('gitDiff.drawerTitle', { defaultValue: '代码改动' })
                : t('chat.sessionFiles')
            }
            style={rightPanelTab === 'diff' ? { width: diffDrawerWidth } : undefined}
            className={cn(
              'relative shrink-0 border-l border-subtle bg-surface-sunken/50 flex flex-col min-h-0 max-w-[56vw]',
              rightPanelTab === 'files' && 'w-[292px]',
              isResizingDrawer && 'select-none',
            )}
          >
            {rightPanelTab === 'diff' && (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={handleStartDrawerResize}
                className={cn(
                  'absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize transition-colors',
                  isResizingDrawer ? 'bg-accent/40' : 'hover:bg-accent/25',
                )}
              />
            )}
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-subtle px-3">
              <div className="flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setRightPanelTab('diff')}
                  aria-pressed={rightPanelTab === 'diff'}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-label-sm transition-colors duration-micro cursor-pointer',
                    rightPanelTab === 'diff'
                      ? 'bg-accent-tint font-medium text-accent'
                      : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                  )}
                >
                  <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('gitDiff.drawerTitle', { defaultValue: '代码改动' })}</span>
                  {gitStatus?.isRepo && gitStatus.files.length > 0 && (
                    <span className="rounded-full bg-black/[0.06] dark:bg-white/[0.1] px-1.5 py-px text-[10.5px] font-mono tabular-nums">
                      {gitStatus.files.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setRightPanelTab('files')}
                  aria-pressed={rightPanelTab === 'files'}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-label-sm transition-colors duration-micro cursor-pointer',
                    rightPanelTab === 'files'
                      ? 'bg-accent-tint font-medium text-accent'
                      : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                  )}
                >
                  <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('chat.sessionFiles')}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRightPanelTab(null)}
                aria-label={t('common.close')}
                className="inline-grid place-items-center size-6 rounded-md text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {rightPanelTab === 'diff' ? (
              <GitDiffDrawer
                dirPath={effectiveGitDir}
                gitStatus={gitStatus}
                isLoading={gitStatusLoading}
                onRefresh={refreshGitStatus}
                onOpenFile={(absPath) => handleOpenFile(absPath)}
                onMentionFile={handleMentionDiffFile}
              />
            ) : (
              <>
                <SessionFilesSection
                  sessionId={sessionId}
                  sessionFolderPath={session?.sessionFolderPath}
                  hideHeader
                  className="flex-1 min-h-0"
                />
                {workingDirectory && (
                  <div className="shrink-0 border-t border-subtle px-3 py-2">
                    <button
                      type="button"
                      onClick={() => window.electronAPI.showInFolder(workingDirectory)}
                      title={workingDirectory}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-caption text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
                    >
                      <FolderOpen className="size-3 shrink-0" />
                      <span className="truncate font-mono">{workingDirectory}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  )
})

export default ChatPage

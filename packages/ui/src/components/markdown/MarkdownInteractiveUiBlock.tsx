/**
 * MarkdownInteractiveUiBlock - Renders ```shiori-ui (and ```interactive-ui) code blocks
 * as sandboxed interactive widgets with live theme sync, auto-resize, and a safe two-way
 * action bridge (`window.shiori.send` / `sendAction` / `data-shiori-send`) back to the chat.
 *
 * Security:
 * - iframe uses `sandbox="allow-scripts allow-forms"` WITHOUT `allow-same-origin`,
 *   so widget scripts run in an opaque origin with zero access to Electron APIs or parent DOM.
 * - Strict CSP blocks all external network requests (`default-src 'none'; connect-src 'none'`).
 * - postMessage events validate both `event.source === iframe.contentWindow` and a unique
 *   per-mount `instanceId`, with rate-limiting to prevent runaway scripts from flooding turns.
 */

import * as React from 'react'
import { Check, Code2, Download, Eye, Maximize2, RotateCcw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'
import { CodeBlock } from './CodeBlock'
import { PreviewOverlay } from '../overlay/PreviewOverlay'
import { CopyButton } from '../overlay/CopyButton'
import {
  PreviewBlockAction,
  PreviewBlockError,
  PreviewBlockFrame,
  PreviewBlockHeader,
  PreviewBlockLoading,
} from './PreviewBlockChrome'
import { useInteractiveUi } from './InteractiveUiContext'
import {
  INTERACTIVE_UI_DEFAULT_HEIGHT,
  buildInteractiveUiDocument,
  buildStandaloneExportHtml,
  buildThemePostMessage,
  parseInteractiveUiBridgeMessage,
  parseInteractiveUiSpec,
  readHostThemeSnapshot,
  toExportHtmlFilename,
  type InteractiveUiThemeSnapshot,
} from './interactive-ui-helpers'

const ACTION_COOLDOWN_MS = 400

class InteractiveUiErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownInteractiveUiBlock] Render failed, falling back to CodeBlock:', error)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

export interface MarkdownInteractiveUiBlockProps {
  code: string
  className?: string
}

export function MarkdownInteractiveUiBlock({ code, className }: MarkdownInteractiveUiBlockProps) {
  const { t } = useTranslation()
  const { onReadFile, onCopyToClipboard } = usePlatform()
  const interactiveUi = useInteractiveUi()
  const isStreaming = Boolean(interactiveUi?.isStreaming)

  const spec = React.useMemo(() => parseInteractiveUiSpec(code), [code])

  const [loadedHtml, setLoadedHtml] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showSource, setShowSource] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [reloadNonce, setReloadNonce] = React.useState(0)
  const [frameHeight, setFrameHeight] = React.useState<number>(
    spec?.height ?? INTERACTIVE_UI_DEFAULT_HEIGHT,
  )
  const [feedbackBadge, setFeedbackBadge] = React.useState<string | null>(null)

  const inlineIframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const overlayIframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const lastActionAtRef = React.useRef(0)
  const feedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const baseId = React.useId()
  const inlineInstanceId = `${baseId}-inline-${reloadNonce}`
  const overlayInstanceId = `${baseId}-overlay-${reloadNonce}`

  // Capture initial theme snapshot once per reload; subsequent theme switches are synced via postMessage
  const initialThemeRef = React.useRef<InteractiveUiThemeSnapshot>(readHostThemeSnapshot())
  const [themeMode, setThemeMode] = React.useState<'light' | 'dark'>(initialThemeRef.current.mode)

  React.useEffect(() => {
    if (spec?.height) {
      setFrameHeight(spec.height)
    }
  }, [spec?.height])

  // Load file-backed HTML when spec uses `src`
  React.useEffect(() => {
    if (!spec?.src || !onReadFile || isStreaming) return
    let cancelled = false
    setLoading(true)
    setError(null)
    onReadFile(spec.src)
      .then((content) => {
        if (!cancelled) setLoadedHtml(content)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to read interactive UI file')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [spec?.src, onReadFile, isStreaming])

  const rawHtml = spec?.html ?? loadedHtml ?? ''
  const widgetTitle = spec?.title || t('preview.interactiveUi', '交互视图')

  const inlineSrcDoc = React.useMemo(() => {
    if (!rawHtml || isStreaming) return ''
    return buildInteractiveUiDocument(rawHtml, {
      instanceId: inlineInstanceId,
      theme: initialThemeRef.current,
    })
  }, [rawHtml, isStreaming, inlineInstanceId])

  const overlaySrcDoc = React.useMemo(() => {
    if (!rawHtml || !isFullscreen || isStreaming) return ''
    return buildInteractiveUiDocument(rawHtml, {
      instanceId: overlayInstanceId,
      theme: readHostThemeSnapshot(),
    })
  }, [rawHtml, isFullscreen, isStreaming, overlayInstanceId])

  // Watch root theme changes and live-push CSS variables into mounted iframes
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const syncTheme = () => {
      const snapshot = readHostThemeSnapshot()
      initialThemeRef.current = snapshot
      setThemeMode(snapshot.mode)
      if (inlineIframeRef.current?.contentWindow) {
        inlineIframeRef.current.contentWindow.postMessage(
          buildThemePostMessage(inlineInstanceId, snapshot),
          '*',
        )
      }
      if (overlayIframeRef.current?.contentWindow) {
        overlayIframeRef.current.contentWindow.postMessage(
          buildThemePostMessage(overlayInstanceId, snapshot),
          '*',
        )
      }
    }
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })
    return () => observer.disconnect()
  }, [inlineInstanceId, overlayInstanceId])

  const flashFeedback = React.useCallback((text: string) => {
    setFeedbackBadge(text)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedbackBadge(null), 2400)
  }, [])

  React.useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  // Handle sandboxed iframe postMessage events (auto-resize + two-way session actions + clipboard)
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const isInlineSource = Boolean(
        inlineIframeRef.current?.contentWindow &&
          event.source === inlineIframeRef.current.contentWindow,
      )
      const isOverlaySource = Boolean(
        overlayIframeRef.current?.contentWindow &&
          event.source === overlayIframeRef.current.contentWindow,
      )
      if (!isInlineSource && !isOverlaySource) return

      const expectedId = isInlineSource ? inlineInstanceId : overlayInstanceId
      const parsed = parseInteractiveUiBridgeMessage(event.data, expectedId)
      if (!parsed) return

      if (parsed.type === 'resize') {
        if (isInlineSource && !spec?.height) {
          setFrameHeight(parsed.height)
        }
        return
      }

      if (parsed.type === 'copy') {
        if (onCopyToClipboard) {
          void onCopyToClipboard(parsed.text)
        } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(parsed.text)
        }
        flashFeedback(t('preview.interactiveUiCopied', '已复制'))
        return
      }

      if (parsed.type === 'action') {
        if (isStreaming || !interactiveUi?.onAction) return
        const now = Date.now()
        if (now - lastActionAtRef.current < ACTION_COOLDOWN_MS) return
        lastActionAtRef.current = now

        interactiveUi.onAction({
          message: parsed.message,
          label: parsed.label,
          data: parsed.data,
          widgetTitle,
        })
        flashFeedback(t('preview.interactiveUiSent', '已发送到会话'))
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [
    inlineInstanceId,
    overlayInstanceId,
    spec?.height,
    onCopyToClipboard,
    flashFeedback,
    isStreaming,
    interactiveUi,
    widgetTitle,
    t,
  ])

  const handleReload = React.useCallback(() => {
    initialThemeRef.current = readHostThemeSnapshot()
    setReloadNonce((n) => n + 1)
  }, [])

  const handleExportHtml = React.useCallback(() => {
    if (!rawHtml) return
    const standalone = buildStandaloneExportHtml(rawHtml, {
      title: widgetTitle,
      theme: readHostThemeSnapshot(),
    })
    const blob = new Blob([standalone], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = toExportHtmlFilename(widgetTitle)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    flashFeedback(t('preview.interactiveUiExported', '已导出 HTML'))
  }, [rawHtml, widgetTitle, flashFeedback, t])

  const fallback = <CodeBlock code={code} language="html" mode="full" className={className} />

  if (!spec) {
    return fallback
  }

  return (
    <InteractiveUiErrorBoundary fallback={fallback}>
      <PreviewBlockFrame className={className}>
        <PreviewBlockHeader icon={<Sparkles />} title={widgetTitle}>
          {feedbackBadge && (
            <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-[11px] font-medium text-accent-text">
              <Check className="size-3" />
              {feedbackBadge}
            </span>
          )}
          {!isStreaming && rawHtml && (
            <>
              <PreviewBlockAction
                aria-label={t('preview.reloadWidget', '重置视图')}
                icon={<RotateCcw />}
                onClick={handleReload}
              />
              <PreviewBlockAction
                aria-label={t('preview.exportHtml', '导出 HTML')}
                icon={<Download />}
                onClick={handleExportHtml}
              />
              <PreviewBlockAction
                aria-label={showSource ? t('preview.viewPreview', '查看预览') : t('preview.viewSource', '查看源码')}
                icon={showSource ? <Eye /> : <Code2 />}
                onClick={() => setShowSource((v) => !v)}
              />
              <PreviewBlockAction
                aria-label={t('common.viewFullscreen')}
                icon={<Maximize2 />}
                onClick={() => setIsFullscreen(true)}
              />
            </>
          )}
        </PreviewBlockHeader>

        {isStreaming ? (
          <PreviewBlockLoading className="min-h-[140px]">
            {t('preview.interactiveUiStreaming', '正在生成交互界面…')}
          </PreviewBlockLoading>
        ) : showSource ? (
          <div className="max-h-[420px] overflow-auto">
            <CodeBlock code={rawHtml || code} language="html" mode="minimal" className="border-0 rounded-none" />
          </div>
        ) : loading ? (
          <PreviewBlockLoading className="h-[240px]">
            {t('common.loading')}
          </PreviewBlockLoading>
        ) : error ? (
          <PreviewBlockError>{error}</PreviewBlockError>
        ) : inlineSrcDoc ? (
          <div className="relative w-full bg-paper">
            <iframe
              key={inlineInstanceId}
              ref={inlineIframeRef}
              sandbox="allow-scripts allow-forms"
              srcDoc={inlineSrcDoc}
              title={widgetTitle}
              className="block w-full border-0 bg-paper"
              style={{ height: `${frameHeight}px` }}
            />
          </div>
        ) : (
          <PreviewBlockLoading className="h-[180px]">
            {t('common.loading')}
          </PreviewBlockLoading>
        )}
      </PreviewBlockFrame>

      <PreviewOverlay
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        theme={themeMode}
        typeBadge={{
          icon: Sparkles,
          label: t('preview.interactiveUi', '交互视图'),
          variant: 'purple',
        }}
        title={widgetTitle}
        headerActions={
          <div className="flex items-center gap-1.5">
            <PreviewBlockAction
              aria-label={t('preview.exportHtml', '导出 HTML')}
              icon={<Download />}
              onClick={handleExportHtml}
            />
            <CopyButton content={rawHtml || code} />
          </div>
        }
      >
        <div className="h-full w-full bg-paper">
          {overlaySrcDoc && (
            <iframe
              key={overlayInstanceId}
              ref={overlayIframeRef}
              sandbox="allow-scripts allow-forms"
              srcDoc={overlaySrcDoc}
              title={widgetTitle}
              className="block h-full w-full border-0 bg-paper"
            />
          )}
        </div>
      </PreviewOverlay>
    </InteractiveUiErrorBoundary>
  )
}

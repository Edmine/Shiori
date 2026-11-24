/**
 * PanelSlot
 *
 * Renders a single content panel within the PanelStackContainer.
 *
 * When a panel is the only one (isOnly), it flex-grows to fill available space.
 * When multiple panels exist, each uses flex-grow with its proportion as the weight,
 * combined with min-width to prevent shrinking below PANEL_MIN_WIDTH.
 *
 * Each PanelSlot overrides AppShellContext to inject a per-panel close button
 * into PanelHeader's rightSidebarButton slot. All panels are equal — closing
 * any panel removes it from the stack. A reactive effect handles window close
 * when the stack becomes empty.
 *
 * Material (design spec §7.1): the paper card is its own absolutely-positioned layer under the
 * content, so a FLIP can scale the card while the content only translates (PanelStackContainer).
 * The first panel joins the list into one card (`isJoinedToNavigator`: square inner corners, the
 * list's hairline is the divider).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { X, ChevronLeft } from 'lucide-react'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { closePanelAtom, focusedPanelIdAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { getCompactParentRoute } from '@/lib/nav-helpers'
import { navigate, routes } from '@/lib/navigate'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'
import { PANEL_GAP, PANEL_MIN_WIDTH, RADIUS_EDGE, RADIUS_INNER } from './panel-constants'

/** The elements PanelStackContainer animates when the layout around this panel changes. */
export interface PanelSlotElements {
  /** Outer slot (translates) */
  panel: HTMLDivElement | null
  /** Card material layer (scales) */
  material: HTMLDivElement | null
}

interface PanelSlotProps {
  entry: PanelStackEntry
  isOnly: boolean
  /** Whether this panel is the focused panel in a multi-panel layout */
  isFocusedPanel: boolean
  isSidebarAndNavigatorHidden: boolean
  /** Whether this panel's left corners touch the window edge (no sidebar/navigator before it) */
  isAtLeftEdge: boolean
  /** Whether this panel's right corners touch the window edge (no right sidebar after it) */
  isAtRightEdge: boolean
  /** The list sits directly to the left: the two read as one paper card */
  isJoinedToNavigator?: boolean
  /** Flex-grow weight for proportional sizing */
  proportion: number
  /** Optional sash element rendered before this panel */
  sash?: React.ReactNode
  /** Compact (mobile) mode — shows back button in panel header */
  isCompact?: boolean
  /** Reports this panel's animatable elements (desktop FLIP); null on unmount */
  onElements?: (id: string, elements: PanelSlotElements | null) => void
}

export function PanelSlot({
  entry,
  isOnly,
  isFocusedPanel,
  isSidebarAndNavigatorHidden,
  isAtLeftEdge,
  isAtRightEdge,
  isJoinedToNavigator = false,
  proportion,
  sash,
  isCompact,
  onElements,
}: PanelSlotProps) {
  const { t } = useTranslation()
  const closePanel = useSetAtom(closePanelAtom)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const parentContext = useAppShellContext()
  const navState = parseRouteToNavigationState(entry.route)
  const panelRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!onElements) return
    onElements(entry.id, { panel: panelRef.current, material: materialRef.current })
    return () => onElements(entry.id, null)
  }, [onElements, entry.id])

  const handleClose = useCallback(() => {
    closePanel(entry.id)
  }, [closePanel, entry.id])

  const handleCompactBack = useCallback(() => {
    const parentRoute = getCompactParentRoute(navState)
    if (parentRoute) {
      navigate(parentRoute, { skipAutoSelect: true })
      return
    }
    navigate(routes.view.allSessions(), { skipAutoSelect: true })
  }, [navState])

  // Build close button for PanelHeader (via context override)
  // Single-panel desktop sessions and compact mobile views do not show a redundant close X.
  const closeButton = useMemo(() => {
    if (isOnly || isCompact) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<X className="h-4 w-4" />}
        onClick={handleClose}
        tooltip={t("common.close")}
      />
    )
  }, [handleClose, isOnly, isCompact, t])

  // Build back button for compact mode — navigates one level up within the current navigator
  // (e.g. settings/appearance → settings, session detail → sessions list) while keeping the
  // panel mounted so the slide-out transition plays smoothly.
  // Same PanelHeaderCenterButton style as X and share, just on the left side.
  const backButton = useMemo(() => {
    if (!isCompact) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={handleCompactBack}
        tooltip={t("common.backToList")}
        // Compact: the chevron's ink (not its box) sits on the 16px gutter (index.css .panel-header-back)
        className="panel-header-back"
      />
    )
  }, [isCompact, handleCompactBack, t])

  // Override AppShellContext so ChatPage/PanelHeader gets our per-panel close button,
  // back button (compact mode), isFocusedPanel for input field appearance, and the panel's id
  const contextOverride = useMemo(() => ({
    ...parentContext,
    rightSidebarButton: closeButton,
    leadingAction: isCompact ? backButton : (isAtLeftEdge ? parentContext.leadingAction : undefined),
    isFocusedPanel,
    isAtRightEdge,
    panelId: entry.id,
  }), [parentContext, closeButton, backButton, isCompact, isAtLeftEdge, isAtRightEdge, isFocusedPanel, entry.id])

  const handlePointerDown = useCallback(() => {
    if (!isFocusedPanel) {
      setFocusedPanel(entry.id)
    }
  }, [isFocusedPanel, setFocusedPanel, entry.id])

  // Full-bleed crisp edges on both desktop and compact mobile panels (no floating card lip).
  const radii: React.CSSProperties = {
    borderRadius: 0,
  }
  // In a split view the focused panel is lifted; the others stay flat.
  const isLifted = !isOnly && isFocusedPanel

  return (
    <>
      {sash}
      <div
        ref={panelRef}
        onPointerDown={handlePointerDown}
        data-panel-role="content"
        data-compact={isCompact || undefined}
        className={cn('h-full relative isolate @container/panel', isLifted ? 'z-[1]' : 'z-0')}
        style={{
          // In multi-panel, unfocused panels override --background so all
          // bg-background children render at the elevated (dimmed) background.
          ...(!isFocusedPanel && !isOnly
            ? {
                '--background': 'var(--background-elevated)',
                '--shadow-minimal': 'var(--shadow-minimal-flat)',
                '--user-message-bubble': 'var(--user-message-bubble-dimmed)',
              } as React.CSSProperties
            : {}
          ),
          // Joined to the list: pull left over the flex gap so the two cards meet.
          ...(isJoinedToNavigator ? { marginLeft: -PANEL_GAP } : {}),
          ...(isOnly
            ? { flexGrow: 1, minWidth: 0 }
            : { flexGrow: proportion, flexShrink: 1, flexBasis: 0, minWidth: PANEL_MIN_WIDTH }
          ),
        }}
      >
        {/* Card material — scales during layout FLIPs; content never does */}
        <div
          ref={materialRef}
          aria-hidden="true"
          className={cn(
            'shell-card absolute inset-0 -z-10 pointer-events-none bg-paper',
            isCompact
              ? 'shadow-elev-0'
              : [
                  !isOnly && !isAtLeftEdge && 'border-l border-subtle',
                  isLifted && 'shadow-elev-2',
                ],
          )}
          style={radii}
        />
        <div className="h-full flex flex-col overflow-hidden" style={radii}>
          <AppShellProvider value={contextOverride}>
            <MainContentPanel
              navStateOverride={navState}
              isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
            />
          </AppShellProvider>
        </div>
      </div>
    </>
  )
}

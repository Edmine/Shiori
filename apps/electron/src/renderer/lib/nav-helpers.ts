/**
 * Navigation helpers
 *
 * Small pure helpers over `NavigationState`. Keep these stateless and free of
 * React/Jotai imports — they're consumed both inside hooks (PanelStackContainer)
 * and in synchronous callbacks (CompactBackButton).
 */

import type { NavigationState } from '../../shared/types'
import { buildRouteFromNavigationState } from '../../shared/route-parser'
import { routes, type Route } from './navigate'

/**
 * Returns true when the focused panel's nav state is in "detail" mode —
 * i.e. the user has drilled past the navigator into a specific item.
 *
 * Used by compact-mode logic to flip the layout from navigator-only to
 * content-only with a back-button overlay.
 *
 * Per-navigator semantics:
 * - sessions: a session is selected
 * - settings: a subpage is selected (bare `settings` route → false)
 * - sources / skills / automations: a detail item is selected
 * - pages: always — both the library grid and a page render in the content
 *   panel (pages has no navigator list to fall back to)
 */
export function isDetailNavState(navState: NavigationState | null): boolean {
  if (!navState) return false
  switch (navState.navigator) {
    case 'sessions':
      return navState.details !== null
    case 'settings':
      return navState.subpage !== null
    case 'sources':
    case 'skills':
    case 'automations':
    case 'projects':
      return navState.details !== null
    case 'pages':
      return true
  }
}

/**
 * Returns the parent list route to navigate to when tapping Back (`<`) in
 * compact/mobile detail mode. Always moves one level up within the current
 * navigator instead of closing the panel stack (which would fall back to the
 * main Sessions list).
 */
export function getCompactParentRoute(navState: NavigationState | null): Route | null {
  if (!navState) return null
  switch (navState.navigator) {
    case 'sessions':
      if (!navState.details) return null
      return buildRouteFromNavigationState({ ...navState, details: null }) as Route
    case 'settings':
      if (!navState.subpage) return null
      return routes.view.settings()
    case 'sources':
      if (!navState.details) return null
      return buildRouteFromNavigationState({ ...navState, details: null }) as Route
    case 'skills':
      if (!navState.details) return null
      return routes.view.skills()
    case 'automations':
      if (!navState.details) return null
      return buildRouteFromNavigationState({ ...navState, details: null }) as Route
    case 'projects':
      if (!navState.details) return null
      return routes.view.projects()
    case 'pages':
      return navState.details ? routes.view.pages() : routes.view.allSessions()
  }
}

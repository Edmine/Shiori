import { describe, it, expect } from 'bun:test'
import { getCompactParentRoute, isDetailNavState } from '../nav-helpers'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { buildMobileMenuPages } from '../../components/app-menu/mobile-menu-pages'

describe('getCompactParentRoute', () => {
  it('returns settings list from any settings subpage instead of main sessions', () => {
    const appearance = parseRouteToNavigationState('settings/appearance')
    expect(isDetailNavState(appearance)).toBe(true)
    expect(getCompactParentRoute(appearance)).toBe('settings')

    const preferences = parseRouteToNavigationState('settings/preferences')
    expect(isDetailNavState(preferences)).toBe(true)
    expect(getCompactParentRoute(preferences)).toBe('settings')
  })

  it('returns null for bare settings navigator', () => {
    const bareSettings = parseRouteToNavigationState('settings')
    expect(isDetailNavState(bareSettings)).toBe(false)
    expect(getCompactParentRoute(bareSettings)).toBeNull()
  })

  it('returns parent list route for sessions, sources, skills, and automations details', () => {
    expect(getCompactParentRoute(parseRouteToNavigationState('allSessions/session/abc'))).toBe('allSessions')
    expect(getCompactParentRoute(parseRouteToNavigationState('flagged/session/abc'))).toBe('flagged')
    expect(getCompactParentRoute(parseRouteToNavigationState('sources/source/github'))).toBe('sources')
    expect(getCompactParentRoute(parseRouteToNavigationState('skills/skill/deploy'))).toBe('skills')
    expect(getCompactParentRoute(parseRouteToNavigationState('automations/automation/a1'))).toBe('automations')
  })
})

describe('buildMobileMenuPages', () => {
  it('opens Settings directly from root without nesting a duplicate Settings entry', () => {
    const pages = buildMobileMenuPages({ hasNewWindow: false, isDebugMode: false })
    const root = pages.find((page) => page.id === 'root')
    const settingsRow = root?.rows.find((row) => row.id === 'settings')
    expect(settingsRow?.action).toEqual({ kind: 'callback', key: 'openSettings' })

    const settingsPage = pages.find((page) => page.id === 'settings')
    expect(settingsPage?.rows.some((row) => row.id === 'settings-overview')).toBe(false)
  })
})

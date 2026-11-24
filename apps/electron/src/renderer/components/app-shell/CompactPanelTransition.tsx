/**
 * CompactPanelTransition
 *
 * iOS-style slide between navigator and detail in compact mode.
 *
 * Why a small wrapper instead of inlining motion config in PanelStackContainer:
 * - PanelStackContainer already juggles sidebar/navigator/content layouts;
 *   keeping the spring + reduced-motion plumbing here keeps that file readable.
 * - Two slots (navigator and detail) need symmetric variants — easier to keep
 *   them aligned in one place.
 *
 * Animation rules:
 * - GPU-only properties: transform + opacity (per apps/electron/CLAUDE.md).
 * - Forward (navigator → detail): navigator parallaxes left to -30%; detail
 *   slides in from 100%, on the `panel` spring (spec §6.2: sidebar and panels).
 * - Back (detail → navigator): symmetric reverse.
 * - Reduced motion: MotionConfig (MotionPreferenceProvider) turns the slide into an instant swap.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { SPRING } from '@craft-agent/ui/motion'

export type CompactPanelRole = 'navigator' | 'detail'

interface CompactPanelTransitionProps {
  role: CompactPanelRole
  /** True when the detail panel should be the active foreground. */
  isDetailActive: boolean
  /** Fired after the transition finishes settling */
  onTransitionComplete?: () => void
  children: React.ReactNode
}

/**
 * Wraps a slot in absolute-positioned + transform-animated motion.div.
 *
 * Both navigator and detail slots stay mounted; they just slide in/out.
 * Off-screen slots get pointer-events: none + aria-hidden so they don't
 * trap taps or screen-reader focus.
 */
export function CompactPanelTransition({
  role,
  isDetailActive,
  onTransitionComplete,
  children,
}: CompactPanelTransitionProps) {
  const isOffscreen = role === 'navigator' ? isDetailActive : !isDetailActive
  // Navigator parallaxes (-30%) to feel layered behind the incoming detail panel.
  // Detail slides fully off (100%) so it never bleeds in over the navigator.
  const offscreenX = role === 'navigator' ? '-30%' : '100%'

  return (
    <motion.div
      className="absolute inset-0"
      style={{
        // Detail layers above navigator during the transition.
        zIndex: role === 'detail' ? 10 : 0,
        // Hint the compositor; cheap on GPU and prevents jank on first frame.
        willChange: 'transform',
        // Off-screen slot must not capture taps or accept focus.
        pointerEvents: isOffscreen ? 'none' : 'auto',
      }}
      aria-hidden={isOffscreen || undefined}
      initial={role === 'detail' && isDetailActive ? { x: '100%' } : false}
      animate={{ x: isOffscreen ? offscreenX : '0%' }}
      transition={SPRING.panel}
      onAnimationComplete={onTransitionComplete}
    >
      {children}
    </motion.div>
  )
}

// Hover cards (UI-13): details of an author, commit, branch or stash shown after resting the
// mouse on it. One card at a time, drawn by <HoverLayer>; it never takes the mouse.
import type React from 'react'
import { create } from 'zustand'
import { useSettings } from './settings'

export interface HoverCard {
  id: number
  /** Where the hovered element is, to place the card beside it */
  anchor: DOMRect
  render: () => React.ReactNode
}

export const useHover = create<{ card: HoverCard | null }>(() => ({ card: null }))

const DELAY = 450
// Once a card is showing, moving to the next element swaps it quickly
const SWAP_DELAY = 90

let timer: ReturnType<typeof setTimeout> | undefined
let lastId = 0

export function hideHover(): void {
  clearTimeout(timer)
  if (useHover.getState().card) useHover.setState({ card: null })
}

/** Mouse handlers that show `render()` in a card after the mouse rests on the element. */
export function hoverCard(render: () => React.ReactNode): {
  onMouseEnter(e: React.MouseEvent): void
  onMouseLeave(): void
} {
  return {
    onMouseEnter(e) {
      if (!useSettings.getState().hoverCards || e.buttons) return
      const target = e.currentTarget as HTMLElement
      clearTimeout(timer)
      timer = setTimeout(
        () => {
          if (target.isConnected)
            useHover.setState({
              card: { id: ++lastId, anchor: target.getBoundingClientRect(), render }
            })
        },
        useHover.getState().card ? SWAP_DELAY : DELAY
      )
    },
    onMouseLeave() {
      clearTimeout(timer)
      // Kept a moment, so moving to the next element swaps the card instead of blinking
      timer = setTimeout(() => useHover.setState({ card: null }), SWAP_DELAY + 30)
    }
  }
}

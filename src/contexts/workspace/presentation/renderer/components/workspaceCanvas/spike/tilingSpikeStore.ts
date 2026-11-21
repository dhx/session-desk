import { create } from 'zustand'

/**
 * SPIKE (tiling remount feasibility, never merged): which window, if any, is shown as one
 * full-screen tile instead of on the canvas. Driven from tests through `window.__opencoveTilingSpike`.
 */
interface TilingSpikeState {
  tiledNodeId: string | null
  switches: { at: number; to: 'tile' | 'canvas'; nodeId: string }[]
}

export const useTilingSpikeStore = create<TilingSpikeState>(() => ({
  tiledNodeId: null,
  switches: [],
}))

declare global {
  interface Window {
    __opencoveTilingSpike?: {
      tile: (nodeId: string) => void
      untile: () => void
      state: () => TilingSpikeState
    }
  }
}

if (typeof window !== 'undefined') {
  window.__opencoveTilingSpike = {
    tile: nodeId =>
      useTilingSpikeStore.setState(state => ({
        tiledNodeId: nodeId,
        switches: [...state.switches, { at: performance.now(), to: 'tile', nodeId }],
      })),
    untile: () =>
      useTilingSpikeStore.setState(state => ({
        tiledNodeId: null,
        switches: state.tiledNodeId
          ? [...state.switches, { at: performance.now(), to: 'canvas', nodeId: state.tiledNodeId }]
          : state.switches,
      })),
    state: () => useTilingSpikeStore.getState(),
  }
}

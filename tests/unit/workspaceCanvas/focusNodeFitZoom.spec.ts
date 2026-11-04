import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  focusNodeInViewport,
  resolveNodeFitZoom,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

const HEADER_HEIGHT = 40
const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 700

function createReactFlow(): ReactFlowInstance<Node<TerminalNodeData>> {
  return {
    setViewport: vi.fn(async () => true),
    setCenter: vi.fn(async () => true),
  } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
}

function createNode(
  width: number,
  height: number,
): Pick<Node<TerminalNodeData>, 'position' | 'data'> {
  return {
    position: { x: 100, y: 200 },
    data: { width, height } as TerminalNodeData,
  }
}

function setRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  element.getBoundingClientRect = () => rect as DOMRect
}

describe('resolveNodeFitZoom', () => {
  it('keeps the target zoom when the node fits with its padding', () => {
    expect(resolveNodeFitZoom(1.5, { width: 400, height: 300 }, { width: 1000, height: 700 })).toBe(
      1.5,
    )
  })

  it('lowers the zoom to the tighter axis, keeping the padding on every side', () => {
    const zoom = resolveNodeFitZoom(2, { width: 800, height: 900 }, { width: 1000, height: 700 })

    expect(zoom).toBeCloseTo((700 - 48) / 900, 5)
    expect(800 * zoom).toBeLessThanOrEqual(1000 - 48)
    expect(900 * zoom).toBeLessThanOrEqual(700 - 48)
  })

  it('never raises the zoom above the target', () => {
    expect(resolveNodeFitZoom(0.5, { width: 100, height: 100 }, { width: 1000, height: 700 })).toBe(
      0.5,
    )
  })

  it('stops at the canvas minimum for a node too large to fit', () => {
    expect(
      resolveNodeFitZoom(1, { width: 100_000, height: 100 }, { width: 1000, height: 700 }),
    ).toBe(0.1)
  })

  it('keeps the target when there is no usable size to fit into', () => {
    expect(resolveNodeFitZoom(1.2, { width: 400, height: 300 }, { width: 40, height: 700 })).toBe(
      1.2,
    )
    expect(resolveNodeFitZoom(1.2, { width: 0, height: 300 }, { width: 1000, height: 700 })).toBe(
      1.2,
    )
  })
})

describe('focusNodeInViewport', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', CANVAS_WIDTH)
    vi.stubGlobal('innerHeight', CANVAS_HEIGHT + HEADER_HEIGHT)

    const header = document.createElement('div')
    header.className = 'app-header'
    setRect(header, { left: 0, top: 0, width: CANVAS_WIDTH, height: HEADER_HEIGHT })

    const canvas = document.createElement('div')
    canvas.className = 'workspace-canvas'
    const flow = document.createElement('div')
    flow.className = 'react-flow'
    setRect(flow, { left: 0, top: HEADER_HEIGHT, width: CANVAS_WIDTH, height: CANVAS_HEIGHT })
    canvas.append(flow)

    document.body.append(header, canvas)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('centers a tall node at the zoom that keeps all of it in view', () => {
    const reactFlow = createReactFlow()

    focusNodeInViewport(reactFlow, createNode(600, 1304), { zoom: 1 })

    const viewport = vi.mocked(reactFlow.setViewport).mock.calls[0]![0]
    expect(viewport.zoom).toBeCloseTo(0.5, 5)

    const top = viewport.y + 200 * viewport.zoom
    const bottom = top + 1304 * viewport.zoom
    expect(top).toBeCloseTo(24, 5)
    expect(bottom).toBeCloseTo(CANVAS_HEIGHT - 24, 5)
  })

  it('leaves the target zoom alone for a node that fits', () => {
    const reactFlow = createReactFlow()

    focusNodeInViewport(reactFlow, createNode(460, 300), { zoom: 1.37 })

    expect(vi.mocked(reactFlow.setViewport).mock.calls[0]![0].zoom).toBe(1.37)
  })

  it('keeps the current zoom for callers that only pan', () => {
    const reactFlow = createReactFlow()

    focusNodeInViewport(reactFlow, createNode(600, 1304), { zoom: 1, fitNodeInViewport: false })

    expect(vi.mocked(reactFlow.setViewport).mock.calls[0]![0].zoom).toBe(1)
  })
})

import React, { useEffect, useState, type ComponentType } from 'react'
import type { Node, NodeTypes } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'

/**
 * SPIKE (tiling remount feasibility, never merged): renders one window's node component as a
 * full-screen tile, outside React Flow's node wrapper, sized to the viewport.
 */
export function TilingSpikeLayer({
  node,
  nodeTypes,
}: {
  node: Node<TerminalNodeData>
  nodeTypes: NodeTypes
}): React.JSX.Element | null {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const Component = (node.type ? nodeTypes[node.type] : undefined) as
    | ComponentType<Record<string, unknown>>
    | undefined
  if (!Component) {
    return null
  }
  return (
    <div
      data-testid="tiling-spike-layer"
      className="react-flow__node"
      style={{ position: 'fixed', inset: 0, zIndex: 10_000, background: 'var(--cove-bg, #000)' }}
    >
      <Component
        id={node.id}
        type={node.type}
        data={{ ...node.data, width: size.width, height: size.height }}
        selected={false}
        dragging={false}
        draggable={false}
        selectable={false}
        deletable={false}
        isConnectable={false}
        zIndex={0}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        width={size.width}
        height={size.height}
      />
    </div>
  )
}

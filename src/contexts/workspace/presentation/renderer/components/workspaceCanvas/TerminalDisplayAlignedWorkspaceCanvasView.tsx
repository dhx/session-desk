import { useMemo, type ComponentProps, type ReactNode } from 'react'
import type { TerminalBackgroundMode } from '@contexts/settings/domain/terminalBackgroundSettings'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import { useTerminalTransparentBackground } from '../terminalNode/useTerminalTransparentBackground'
import { TerminalDisplayAlignmentProvider } from './TerminalDisplayAlignmentContext'
import { WorkspaceCanvasView } from './WorkspaceCanvasView'
import { useCollapsedCanvasProjection } from './collapse/useCollapsedCanvasProjection'

export function TerminalDisplayAlignedWorkspaceCanvasView({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
  terminalBackground,
  spikeOverlay,
  ...viewProps
}: ComponentProps<typeof WorkspaceCanvasView> & {
  /** SPIKE (never merged): rendered inside the alignment provider, beside the canvas. */
  spikeOverlay?: ReactNode
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  terminalBackground: TerminalBackgroundMode
}) {
  const projected = useCollapsedCanvasProjection(viewProps)
  const terminalTransparentBackground = useTerminalTransparentBackground(terminalBackground)
  const value = useMemo(
    () => ({
      terminalFontSize,
      terminalFontFamily,
      terminalDisplayCalibration,
      terminalTransparentBackground,
    }),
    [
      terminalDisplayCalibration,
      terminalFontFamily,
      terminalFontSize,
      terminalTransparentBackground,
    ],
  )
  return (
    <TerminalDisplayAlignmentProvider value={value}>
      <WorkspaceCanvasView {...viewProps} {...projected} />
      {spikeOverlay}
    </TerminalDisplayAlignmentProvider>
  )
}

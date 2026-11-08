import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import { PluginNodeHeaderActions } from './PluginNodeHeaderActions'
import { resetPluginNodeHeaderPollers } from './pluginNodeHeaderStore'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  plugins: [] as PluginManifest[],
  state: { activeWorkspaceId: 'project-1', agentSettings: {} } as Record<string, unknown>,
}))
vi.mock('./usePluginRegistry', () => ({
  usePluginRegistry: () => ({ plugins: mocks.plugins }),
  getPluginManifest: (id: string) => mocks.plugins.find(plugin => plugin.id === id),
}))
vi.mock('./PluginIcon', () => ({ PluginIcon: () => <span /> }))
vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { title?: string }) => `${key}:${params?.title ?? ''}`,
  }),
}))
vi.mock('@app/renderer/shell/store/useAppStore', () => ({
  useAppStore: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
}))

const button = () => screen.getByTestId('terminal-node-plugin-link-board-card')

beforeEach(() => {
  resetPluginNodeHeaderPollers()
  mocks.invoke.mockReset()
  mocks.state = { activeWorkspaceId: 'project-1', agentSettings: {} }
  window.opencoveApi = { controlSurface: { invoke: mocks.invoke } } as never
  mocks.plugins = [
    {
      id: 'board',
      displayName: 'Board',
      version: '1.0.0',
      description: 'Test',
      revision: 'r',
      runtimeGeneration: 1,
      status: 'ready',
      enabled: true,
      nodeKinds: [],
      actionBar: false,
      contextMenu: false,
      nodeHeader: [{ id: 'card', title: 'Open card', stateCommand: 'header-state' }],
    },
  ]
})
afterEach(() => {
  resetPluginNodeHeaderPollers()
  vi.restoreAllMocks()
})

it('stays disabled until the plugin knows a link for this window, then opens it in the browser', async () => {
  mocks.invoke.mockResolvedValue({ nodes: { other: { url: 'https://board.example/#o' } } })
  render(<PluginNodeHeaderActions nodeId="node-1" />)
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce())
  expect(mocks.invoke.mock.calls[0][0]).toEqual({
    kind: 'query',
    id: 'plugin.nodeHeader.state',
    payload: {
      pluginId: 'board',
      buttonId: 'card',
      projectId: 'project-1',
      expectedRevision: 'r',
      expectedRuntimeGeneration: 1,
    },
  })
  expect(button()).toHaveProperty('disabled', true)
  expect(button().getAttribute('aria-label')).toBe(
    'terminalNodeHeader.pluginLinkUnavailable:Open card',
  )
})

it('enables the button from the shared answer and opens the link with noopener', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  mocks.invoke.mockResolvedValue({
    nodes: { 'node-1': { url: 'https://board.example/#item=card_1', title: 'Open card 1' } },
  })
  render(
    <>
      <PluginNodeHeaderActions nodeId="node-1" />
      <PluginNodeHeaderActions nodeId="node-2" />
    </>,
  )
  await waitFor(() => expect(screen.getAllByRole('button')[0]).toHaveProperty('disabled', false))
  // Both windows share one poller: a single request for the project.
  expect(mocks.invoke).toHaveBeenCalledOnce()
  const [first, second] = screen.getAllByRole('button')
  expect(second).toHaveProperty('disabled', true)
  expect(first.getAttribute('aria-label')).toBe('Open card 1')
  await act(async () => fireEvent.click(first))
  expect(open).toHaveBeenCalledWith(
    'https://board.example/#item=card_1',
    '_blank',
    'noopener,noreferrer',
  )
})

it('shows nothing when the contribution is switched off or the plugin is not ready', () => {
  mocks.state = {
    activeWorkspaceId: 'project-1',
    agentSettings: { pluginContributions: { board: { nodeHeader: false } } },
  }
  const { rerender } = render(<PluginNodeHeaderActions nodeId="node-1" />)
  expect(screen.queryByRole('button')).toBeNull()
  mocks.state = { activeWorkspaceId: 'project-1', agentSettings: {} }
  mocks.plugins[0].status = 'error'
  rerender(<PluginNodeHeaderActions nodeId="node-1" />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(mocks.invoke).not.toHaveBeenCalled()
})

it('keeps the button disabled when the plugin fails', async () => {
  mocks.invoke.mockRejectedValue(new Error('board unreachable'))
  render(<PluginNodeHeaderActions nodeId="node-1" />)
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce())
  expect(button()).toHaveProperty('disabled', true)
})

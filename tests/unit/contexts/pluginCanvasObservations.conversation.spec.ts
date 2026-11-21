import { describe, expect, it } from 'vitest'
import { createPluginCanvasObservationSnapshot } from '../../../src/app/main/controlSurface/handlers/pluginCanvasObservations'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

// Session Desk: after /clear the Worker rebinds a Claude window to the new conversation while PTY
// and launch arguments stay the same. events.poll must still see the window change, or a plugin
// that refreshes on change keeps showing the old conversation.
describe('plugin session observations', () => {
  it('change when a running Claude window is rebound to another conversation', async () => {
    const state = createMinimalState('/tmp/p', 'p', 's')
    Object.assign(state.workspaces[0], {
      nodes: [
        {
          id: 'agent',
          kind: 'agent',
          title: 'Claude',
          position: { x: 0, y: 0 },
          width: 400,
          height: 300,
          sessionId: 'pty-1',
          agent: { provider: 'claude-code' },
        },
      ],
    })
    let conversation = 'before-clear'
    let status = 'running'
    const snapshot = createPluginCanvasObservationSnapshot({
      getPersistenceStore: async () =>
        ({
          readAppState: async () => state,
          observeManagedClaudeNode: (nodeId: string) => ({
            nodeId,
            retired: false,
            context: null,
            binding: {
              nodeId,
              activationId: 'activation',
              runtimeSessionId: 'pty-1',
              tuple: { resumeSessionId: conversation, resumeSessionIdVerified: true },
              nodeSeen: true,
              bindingRevision: 1,
              observedRevision: 1,
            },
          }),
        }) as never,
      ptyStreamHub: {
        listSessions: () => ({
          sessions: [{ sessionId: 'pty-1', status, args: ['--session-id', 'before-clear'] }],
        }),
        observeAgentState: () => null,
      } as never,
      plugins: {} as never,
    })
    const authority = { pluginId: 'plugin', assertActive: () => {} } as never
    const hash = async () =>
      (await snapshot(authority, 'p', ['session'])).get('session')?.get('agent')

    const before = await hash()
    expect(await hash()).toBe(before)
    conversation = 'after-clear'
    const afterClear = await hash()
    expect(afterClear).not.toBe(before)
    status = 'exited'
    expect(await hash()).not.toBe(afterClear)
  })
})

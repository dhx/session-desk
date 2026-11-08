// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerPluginNodeHeaderHandlers } from '../../../src/app/main/controlSurface/handlers/pluginNodeHeaderHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PluginInstallationManager } from '../../../src/contexts/plugins/application/PluginInstallationManager'
import type { PluginManifest } from '../../../src/contexts/plugins/domain/pluginTypes'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const context: ControlSurfaceContext = {
  now: () => new Date('2026-10-11T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 0,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: false, cookieSession: false },
    },
  },
}
const selection = {
  pluginId: 'header-contract',
  buttonId: 'card',
  projectId: 'selected-project',
  expectedRevision: 'revision-a',
  expectedRuntimeGeneration: 4,
}

async function fixture() {
  const state = createMinimalState('/fixture/project', selection.projectId, 'space')
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(state)
  let manifest: PluginManifest = {
    id: selection.pluginId,
    version: '1.0.0',
    displayName: 'Header contract',
    description: 'Contract fixture',
    nodeKinds: [],
    actionBar: false,
    contextMenu: false,
    enabled: true,
    status: 'ready',
    revision: selection.expectedRevision,
    runtimeGeneration: selection.expectedRuntimeGeneration,
    nodeHeader: [{ id: selection.buttonId, title: 'Open card', stateCommand: 'header-state' }],
    commands: [{ id: 'header-state', title: 'State', description: 'Links', target: 'plugin' }],
  }
  const list = vi.fn(async () => [manifest])
  const runCommand = vi.fn(
    async (): Promise<unknown> => ({
      nodes: {
        'node-1': { url: 'https://board.example/#item=card_1' },
        'node-2': { url: 'javascript:alert(1)' },
      },
    }),
  )
  const control = createControlSurface()
  registerPluginNodeHeaderHandlers(control, {
    plugins: { list, runCommand } as unknown as PluginInstallationManager,
    getPersistenceStore: async () => store,
  })
  const call = (payload: unknown = selection) =>
    control.invoke(context, { kind: 'query', id: 'plugin.nodeHeader.state', payload })
  return {
    call,
    runCommand,
    manifest: () => manifest,
    changeManifest: (change: Partial<PluginManifest>) => {
      manifest = { ...manifest, ...change }
    },
  }
}

describe('plugin window header control surface', () => {
  it('asks the declared state command for the selected project and keeps only safe links', async () => {
    const subject = await fixture()
    const admitted = subject.manifest()
    expect(await subject.call()).toMatchObject({
      ok: true,
      value: { nodes: { 'node-1': { url: 'https://board.example/#item=card_1' } } },
    })
    expect(subject.runCommand).toHaveBeenCalledExactlyOnceWith(
      selection.pluginId,
      'header-state',
      { projectId: selection.projectId },
      { context: { surface: 'canvas', projectId: selection.projectId } },
      admitted,
    )
  })

  it.each([
    ['absent project', { projectId: 'deleted-project' }, 'project is no longer available'],
    ['stale revision', { expectedRevision: 'revision-old' }, 'Plugin changed'],
    ['stale generation', { expectedRuntimeGeneration: 3 }, 'Plugin changed'],
    ['undeclared button', { buttonId: 'other' }, 'button is not declared'],
  ])('rejects %s before invoking the backend', async (_name, patch, reason) => {
    const subject = await fixture()
    expect(await subject.call({ ...selection, ...(patch as object) })).toMatchObject({
      ok: false,
      error: { code: 'plugin.operation_failed', debugMessage: expect.stringContaining(reason) },
    })
    expect(subject.runCommand).not.toHaveBeenCalled()
  })

  it.each([{ commandId: 'arbitrary-command' }, { expectedRuntimeGeneration: '4' }])(
    'rejects malformed or authority-expanding input (%j)',
    async patch => {
      const subject = await fixture()
      expect((await subject.call({ ...selection, ...patch })).ok).toBe(false)
      expect(subject.runCommand).not.toHaveBeenCalled()
    },
  )

  it('does not run a disabled plugin', async () => {
    const subject = await fixture()
    subject.changeManifest({ enabled: false })
    expect((await subject.call()).ok).toBe(false)
    expect(subject.runCommand).not.toHaveBeenCalled()
  })
})

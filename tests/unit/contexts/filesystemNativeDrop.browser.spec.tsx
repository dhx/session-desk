import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEvent } from 'react'
import {
  useFilesystemNodes,
  type FilesystemNodesParams,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodes'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'

vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<object>()),
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y: y / 2 }),
  }),
}))

function browserDrop(
  entries: Array<{ file: File; isDirectory?: boolean }>,
  client = { x: 800, y: 600 },
): DragEvent<HTMLDivElement> {
  return {
    target: document.createElement('div'),
    clientX: client.x,
    clientY: client.y,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: ['Files'],
      files: entries.map(entry => entry.file),
      items: entries.map(({ file, isDirectory }) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
        webkitGetAsEntry: () => ({ isDirectory: isDirectory === true, isFile: !isDirectory }),
      })),
      getData: () => '',
    },
  } as unknown as DragEvent<HTMLDivElement>
}

function setup() {
  const createDocumentNode = vi.fn<FilesystemNodesParams['nodeStore']['createDocumentNode']>(
    () => null,
  )
  const onShowMessage = vi.fn()
  createCanvasDocumentHarness({
    workspaceId: 'one',
    spaces: [
      {
        id: 'feature-space',
        name: 'Feature',
        nodeIds: [],
        directoryPath: '/project/.opencove/worktrees/feature',
        rect: { x: 0, y: 0, width: 300, height: 300 },
        targetMountId: null,
      },
    ],
  })
  const params: Omit<FilesystemNodesParams, 'workspaceId'> = {
    workspacePath: '/project',
    nodeStore: {
      setNodes: vi.fn(),
      updateCanvasDocument: vi.fn(),
      createDocumentNode,
      createFolderNode: vi.fn(() => null),
    },
    onShowMessage,
  }
  const hook = renderInCanvasDocument(() => useFilesystemNodes({ ...params, workspaceId: 'one' }), {
    workspaceId: 'one',
  })
  return { ...hook, createDocumentNode, onShowMessage }
}

describe('files dropped onto the canvas in the Web UI', () => {
  const resolveDroppedFile = vi.fn()
  const stat = vi.fn()
  beforeEach(() => {
    stat.mockReset().mockImplementation(({ uri }) => ({ uri, kind: 'file' }))
    resolveDroppedFile
      .mockReset()
      .mockImplementation(async (file: File, options: { targetDirectoryPath: string }) => ({
        uri: `file://${options.targetDirectoryPath}/dropped/${file.name}`,
        kind: 'file',
      }))
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        meta: { runtime: 'browser' },
        filesystem: { getPathForFile: () => '', resolveDroppedFile, stat },
      },
    })
    useCanvasCollapseStore.setState({ workspaces: {} })
  })
  afterEach(cleanup)

  it('are uploaded into the project root and placed as compact file references', async () => {
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const view = setup()
    const event = browserDrop([{ file: notes }])
    await act(async () => {
      view.result.current.handleNativeDrop(event)
    })
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(resolveDroppedFile).toHaveBeenCalledWith(notes, { targetDirectoryPath: '/project' })
    expect(view.createDocumentNode).toHaveBeenCalledWith(
      expect.any(Object),
      { uri: 'file:///project/dropped/notes.txt' },
      expect.any(Object),
      { endpointId: 'local', mountId: null },
      { workspaceId: 'one', collapsed: true },
    )
  })

  it('go to the folder of the space they land in', async () => {
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const view = setup()
    await act(async () => {
      view.result.current.handleNativeDrop(browserDrop([{ file: notes }], { x: 200, y: 200 }))
    })
    expect(resolveDroppedFile).toHaveBeenCalledWith(notes, {
      targetDirectoryPath: '/project/.opencove/worktrees/feature',
    })
  })

  it('refuse folders with a message and upload nothing', async () => {
    const view = setup()
    const event = browserDrop([{ file: new File([], 'docs'), isDirectory: true }])
    await act(async () => {
      view.result.current.handleNativeDrop(event)
    })
    expect(view.onShowMessage).toHaveBeenCalledWith(
      "Folders can't be dropped from a browser — add the folder as a project instead.",
      'warning',
    )
    expect(resolveDroppedFile).not.toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('leave images to the canvas image importer', async () => {
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const shot = new File(['png'], 'shot.png', { type: 'image/png' })
    const view = setup()
    const event = browserDrop([{ file: notes }, { file: shot }])
    await act(async () => {
      view.result.current.handleNativeDrop(event)
    })
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(resolveDroppedFile).toHaveBeenCalledOnce()
    expect(resolveDroppedFile).toHaveBeenCalledWith(notes, expect.any(Object))
  })
})

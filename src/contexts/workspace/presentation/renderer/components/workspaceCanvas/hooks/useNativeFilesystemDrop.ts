import { useCallback, useLayoutEffect, useRef, type DragEvent, type DragEventHandler } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { CANVAS_IMAGE_MIME_TYPES, type FileSystemStat } from '@shared/contracts/dto'
import type { Point } from '../../../types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { getCollapsedNodeSize } from '../../../utils/canvasCollapse'
import {
  hasFilesystemEntryDragData,
  isFilesystemCanvasDropTarget,
  type FilesystemEntryDragData,
} from '../filesystemDrag'
import {
  hasNativeFileTransfer,
  readNativeDroppedFiles,
  toNativeFilesystemEntry,
} from '../nativeFilesystemDrop'
import {
  isBrowserCanvasRuntime,
  readBrowserDroppedFiles,
  resolveBrowserDropDirectory,
} from '../browserCanvasFileDrop'
import { toErrorMessage } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { findContainingSpaceByAnchor } from './useInteractions.spaceAssignment'

export interface FilesystemMaterializeOptions {
  collapsed?: boolean
  /** undefined resolves by anchor; null preserves a drop onto the root canvas. */
  targetSpaceId?: string | null
}

export function useNativeFilesystemDrop({
  workspaceId,
  workspacePath,
  materialize,
  onShowMessage,
}: {
  workspaceId: string
  /** The project root; in the Web UI, dropped files are uploaded into it (or the space's folder). */
  workspacePath?: string
  materialize: (
    entry: FilesystemEntryDragData,
    anchor: Point,
    isSourceCurrent?: () => boolean,
    options?: FilesystemMaterializeOptions,
  ) => Promise<void>
  onShowMessage?: ShowWorkspaceCanvasMessage
}) {
  const { t } = useTranslation()
  const reactFlow = useReactFlow()
  const readDocument = useReadCanvasDocument()
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => {
      lifetime.current = null
    }
  }, [workspaceId])

  const handleNativeDragOver = useCallback<DragEventHandler<HTMLDivElement>>(event => {
    if (isFilesystemCanvasDropTarget(event.target) && hasNativeFileTransfer(event.dataTransfer)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const placeDroppedFiles = useCallback(
    (
      files: File[],
      clientPoint: { x: number; y: number },
      resolveDroppedFile: (
        file: File,
        targetSpaceId: string | null,
      ) => Promise<FileSystemStat | null>,
    ) => {
      const anchor = reactFlow.screenToFlowPosition(clientPoint)
      const targetSpaceId = findContainingSpaceByAnchor(readDocument().spaces, anchor)?.id ?? null
      const epoch = lifetime.current
      const isCurrent = () =>
        epoch !== null &&
        lifetime.current === epoch &&
        (targetSpaceId === null || readDocument().spaces.some(space => space.id === targetSpaceId))
      void (async () => {
        for (const [index, file] of files.entries()) {
          if (!isCurrent()) {
            return
          }
          try {
            // Stop authorizing remaining entries as soon as this canvas is no longer current.
            // eslint-disable-next-line no-await-in-loop
            const entry = toNativeFilesystemEntry(await resolveDroppedFile(file, targetSpaceId))
            if (!isCurrent()) {
              return
            }
            if (entry) {
              const size = getCollapsedNodeSize()
              // Each placement must see the preceding node's published collision geometry.
              await materialize(
                entry,
                {
                  x: anchor.x + (index % 4) * (size.width + 20),
                  y: anchor.y + Math.floor(index / 4) * (size.height + 20),
                },
                isCurrent,
                { collapsed: true, targetSpaceId },
              )
            }
          } catch (error) {
            if (isCurrent()) {
              onShowMessage?.(
                t('spaceExplorer.openFailed', { message: toErrorMessage(error) }),
                'error',
              )
            }
          }
        }
      })()
    },
    [materialize, onShowMessage, reactFlow, readDocument, t],
  )

  /** Web UI: upload into the project, then reference the new file (images stay image nodes). */
  const handleBrowserDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const { files, images, folderCount } = readBrowserDroppedFiles(event.dataTransfer)
      if (folderCount > 0) {
        onShowMessage?.(t('spaceExplorer.browserFolderDropUnsupported'), 'warning')
      }
      event.preventDefault()
      // The canvas image importer, further up, still takes the images.
      if (images.length === 0) {
        event.stopPropagation()
      }
      const resolveDroppedFile = window.opencoveApi?.filesystem?.resolveDroppedFile
      if (files.length === 0 || !resolveDroppedFile) {
        return
      }
      if (!resolveBrowserDropDirectory(null, workspacePath)) {
        onShowMessage?.(t('spaceExplorer.browserDropNoProject'), 'warning')
        return
      }
      placeDroppedFiles(files, { x: event.clientX, y: event.clientY }, (file, targetSpaceId) =>
        resolveDroppedFile(file, {
          targetDirectoryPath: resolveBrowserDropDirectory(
            readDocument().spaces.find(space => space.id === targetSpaceId) ?? null,
            workspacePath,
          ),
        }),
      )
    },
    [onShowMessage, placeDroppedFiles, readDocument, t, workspacePath],
  )

  const handleNativeDrop = useCallback<DragEventHandler<HTMLDivElement>>(
    event => {
      const transfer = event.dataTransfer
      if (
        !isFilesystemCanvasDropTarget(event.target) ||
        hasFilesystemEntryDragData(transfer) ||
        !hasNativeFileTransfer(transfer)
      ) {
        return
      }
      if (isBrowserCanvasRuntime()) {
        handleBrowserDrop(event)
        return
      }
      const files = readNativeDroppedFiles(transfer)
      if (!files.length) {
        const imageFiles = Array.from(transfer.files ?? []).filter(file =>
          (CANVAS_IMAGE_MIME_TYPES as readonly string[]).includes(file.type),
        )
        if (imageFiles.length < transfer.files.length) {
          onShowMessage?.(t('spaceExplorer.nativeDropUnavailable'), 'warning')
        }
        // The existing image importer still owns clipboard/web-created images.
        if (!imageFiles.length) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const resolveDroppedFile = window.opencoveApi.filesystem.resolveDroppedFile!
      placeDroppedFiles(files, { x: event.clientX, y: event.clientY }, file =>
        resolveDroppedFile(file),
      )
    },
    [handleBrowserDrop, onShowMessage, placeDroppedFiles, t],
  )

  return { handleNativeDragOver, handleNativeDrop }
}

import { useEffect, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  canUploadDroppedFiles,
  getDroppedFileFilesystem,
  type DroppedFileFilesystem,
} from '../../utils/fileDropApi'

function quoteShellPath(path: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(path) ? path : "'" + path.replace(/'/g, "'\\''") + "'"
}

/**
 * The paths of dropped or pasted files, for the terminal. The desktop app knows each file's own
 * path; in the Web UI a file has none, so it is uploaded to the worker, which answers where it put
 * it. Files without either are left out.
 */
export async function resolveDroppedFilePaths(
  files: File[],
  filesystem: DroppedFileFilesystem,
): Promise<string[]> {
  const paths = await Promise.all(
    files.map(async file => {
      const local = filesystem.getPathForFile?.(file) ?? ''
      if (local.length > 0) {
        return local
      }
      return filesystem.uploadDroppedFile ? await filesystem.uploadDroppedFile(file) : ''
    }),
  )
  return paths.filter(path => path.length > 0)
}

export function useTerminalFileDropPaste({
  containerRef,
  terminalRef,
}: {
  containerRef: RefObject<HTMLElement | null>
  terminalRef: RefObject<Terminal | null>
}): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }

    const pasteFiles = (files: File[]): void => {
      void resolveDroppedFilePaths(files, getDroppedFileFilesystem())
        .then(paths => {
          if (paths.length > 0) {
            terminalRef.current?.paste(paths.map(quoteShellPath).join(' '))
          }
        })
        .catch(error => {
          // eslint-disable-next-line no-console
          console.warn('[opencove] a dropped file could not be passed to the terminal', error)
        })
    }

    const handleDragOver = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    const handleDrop = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      const files = event.dataTransfer?.files
      if (!files || files.length === 0) {
        return
      }
      pasteFiles(Array.from(files))
    }

    // A pasted screenshot arrives as a file without a path. Only the Web UI can do something with
    // it (upload it); text pastes and the desktop app's own paste handling stay as they are.
    const handlePaste = (event: ClipboardEvent): void => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0 || !canUploadDroppedFiles()) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      pasteFiles(files)
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)
    container.addEventListener('paste', handlePaste, true)
    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
      container.removeEventListener('paste', handlePaste, true)
    }
  }, [containerRef, terminalRef])
}

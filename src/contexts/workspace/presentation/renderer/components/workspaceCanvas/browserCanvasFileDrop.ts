import { CANVAS_IMAGE_MIME_TYPES } from '@shared/contracts/dto'
import type { WorkspaceSpaceState } from '../../types'
import { isBrowserRuntime } from '../../utils/fileDropApi'

/**
 * Files dropped onto the canvas in the Web UI. A browser does not tell the page where a file
 * lives, so a dropped file is uploaded into the project (`<dir>/dropped/`) and referenced there.
 * Images keep going to the canvas image importer; folders cannot be uploaded.
 */

export function isBrowserCanvasRuntime(): boolean {
  return isBrowserRuntime()
}

export interface BrowserDroppedFiles {
  /** Files to upload into the project. */
  files: File[]
  /** Images, which become image nodes through the canvas image importer. */
  images: File[]
  folderCount: number
}

function isCanvasImage(file: File): boolean {
  return (CANVAS_IMAGE_MIME_TYPES as readonly string[]).includes(file.type.trim())
}

/** Must run during the drop event: the browser empties the transfer afterwards. */
export function readBrowserDroppedFiles(transfer: DataTransfer): BrowserDroppedFiles {
  const items = Array.from(transfer.items ?? []).filter(item => item.kind === 'file')
  const entries =
    items.length > 0
      ? items.map(item => ({
          file: item.getAsFile(),
          isDirectory: item.webkitGetAsEntry?.()?.isDirectory === true,
        }))
      : Array.from(transfer.files ?? []).map(file => ({ file, isDirectory: false }))
  const result: BrowserDroppedFiles = { files: [], images: [], folderCount: 0 }
  for (const { file, isDirectory } of entries) {
    if (isDirectory) {
      result.folderCount += 1
    } else if (file && isCanvasImage(file)) {
      result.images.push(file)
    } else if (file) {
      result.files.push(file)
    }
  }
  return result
}

/** The space's own folder when the drop landed in one on this worker, else the project root. */
export function resolveBrowserDropDirectory(
  space: WorkspaceSpaceState | null,
  workspacePath: string | undefined,
): string | null {
  const spaceDirectory = space && !space.targetMountId ? (space.directoryPath?.trim() ?? '') : ''
  return spaceDirectory || workspacePath?.trim() || null
}

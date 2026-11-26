/**
 * Transport adapter for dropped and pasted files: the only place the canvas and terminal drop
 * handlers reach `window.opencoveApi`. The desktop app gives each file its own path; the Web UI
 * (runtime `browser`) uploads it to the worker instead.
 */

export type DroppedFileFilesystem = Pick<
  Window['opencoveApi']['filesystem'],
  'getPathForFile' | 'uploadDroppedFile'
>

export type DroppedFileResolver = NonNullable<
  Window['opencoveApi']['filesystem']['resolveDroppedFile']
>

export function isBrowserRuntime(): boolean {
  return window.opencoveApi?.meta?.runtime === 'browser'
}

export function getDroppedFileFilesystem(): DroppedFileFilesystem {
  return window.opencoveApi.filesystem
}

export function canUploadDroppedFiles(): boolean {
  return Boolean(window.opencoveApi.filesystem.uploadDroppedFile)
}

export function getDroppedFileResolver(): DroppedFileResolver | null {
  return window.opencoveApi?.filesystem?.resolveDroppedFile ?? null
}

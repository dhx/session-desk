import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  dispatchFileTransfer,
  fileUri,
  openAuthedCanvas,
  readSharedState,
  readTextFile,
  writeAppState,
} from './helpers'

const PANE = '.workspace-canvas .react-flow__pane'

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

test.describe('Worker web canvas file drop', () => {
  test('a dropped file is kept in <project>/dropped/ and opens in the document editor', async ({
    page,
  }) => {
    const workspacePath = await createWorkspaceDir('canvas-file-drop')
    await writeAppState(page.request, buildAppState({ workspacePath, spaces: [] }))
    await openAuthedCanvas(page)
    await expect(page.locator(PANE)).toBeVisible()

    await dispatchFileTransfer(page, PANE, 'drop', [
      { kind: 'file', name: 'notes.md', type: 'text/markdown', base64: base64('# dropped\n') },
    ])

    const droppedPath = path.join(workspacePath, 'dropped', 'notes.md')
    await expect
      .poll(async () => await readTextFile(droppedPath).catch(() => null))
      .toBe('# dropped\n')

    const card = page.locator('.cove-collapsed-window').filter({ hasText: 'notes.md' })
    await expect(card).toBeVisible()
    await expect
      .poll(async () => {
        const { state } = await readSharedState(page.request)
        return (state?.workspaces[0]?.nodes ?? [])
          .filter(node => node.kind === 'document')
          .map(node => (node.task as { uri?: string } | null)?.uri)
      })
      .toEqual([fileUri(droppedPath)])

    await card.getByTestId('node-expand').click()
    const documentNode = page.locator('.document-node').filter({ hasText: 'notes.md' })
    const editor = documentNode.locator('.monaco-editor')
    await expect(editor).toContainText('# dropped')

    // Append rather than select all: WebKit can drop the select-all chord right after the click.
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\nedited in the Web UI\n')

    // The editor saves on its own 650 ms after the last change. Clicking Save would race that:
    // on a slow runner the auto-save runs first and the button is disabled again before the click.
    await expect
      .poll(async () => await readTextFile(droppedPath))
      .toMatch(/^# dropped[\s\S]*edited in the Web UI\n/)
    await expect(documentNode.getByRole('button', { name: 'Save' }).first()).toBeDisabled()
  })

  test('a dropped folder is refused with a message and nothing is uploaded', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('canvas-folder-drop')
    await writeAppState(page.request, buildAppState({ workspacePath, spaces: [] }))
    await openAuthedCanvas(page)
    await expect(page.locator(PANE)).toBeVisible()

    await dispatchFileTransfer(page, PANE, 'drop', [{ kind: 'directory', name: 'docs' }])

    await expect(page.getByTestId('app-message')).toContainText(
      "Folders can't be dropped from a browser — add the folder as a project instead.",
    )
    await expect(page.locator('.cove-collapsed-window')).toHaveCount(0)
    expect(await readdir(workspacePath)).not.toContain('dropped')
  })
})

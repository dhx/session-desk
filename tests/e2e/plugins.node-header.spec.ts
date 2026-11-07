import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'
import { pluginCli } from './plugins.commands.helpers'
import { capturePlugins } from './plugins.local.helpers'

const id = 'node-header-fixture'
const link = 'https://board.example/#item=card_1'

test('a plugin window-header link stays disabled until the plugin links the window, then opens in the browser', async ({
  browserName: _,
}, info) => {
  test.setTimeout(120_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-node-header-'))
  const userDataDir = await createTestUserDataDir()
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Card links',
      description: 'Window header fixture',
      main: 'main.mjs',
      contributes: {
        nodeHeader: [{ id: 'card', title: 'Open card', stateCommand: 'header-state' }],
        commands: [
          { id: 'header-state', title: 'State', description: 'Links', target: 'plugin', menus: [] },
          { id: 'link', title: 'Link', description: 'Link a window', target: 'plugin', menus: [] },
        ],
      },
    }),
  )
  await writeFile(
    join(source, 'main.mjs'),
    `export function activate() { let linked = null; return { runCommand(id, params) {
    if (id === 'link') { linked = params.node; return { ok: true }; }
    return { nodes: linked ? { [linked]: { url: ${JSON.stringify(link)} } } : {} };
  } }; }`,
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await page.setViewportSize({ width: 1280, height: 850 })
    await clearAndSeedWorkspace(
      page,
      [
        {
          id: 'linked',
          title: 'linked-shell',
          position: { x: 80, y: 80 },
          width: 520,
          height: 300,
        },
        { id: 'other', title: 'other-shell', position: { x: 640, y: 80 }, width: 520, height: 300 },
      ],
      { settings: { language: 'en' } },
    )
    await page.evaluate(() => {
      const opened: unknown[][] = []
      ;(window as unknown as { __opened: unknown[][] }).__opened = opened
      window.open = (...args: unknown[]) => {
        opened.push(args)
        return null
      }
    })
    await pluginCli(userDataDir, ['install', source])
    const linked = page
      .locator('.terminal-node', { hasText: 'linked-shell' })
      .getByTestId(`terminal-node-plugin-link-${id}-card`)
    const other = page
      .locator('.terminal-node', { hasText: 'other-shell' })
      .getByTestId(`terminal-node-plugin-link-${id}-card`)
    await expect(linked).toBeVisible()
    await expect(linked).toBeDisabled()
    await expect(other).toBeDisabled()
    await capturePlugins(page, info, 'plugin-node-header-disabled')

    await pluginCli(userDataDir, [
      'run',
      id,
      'link',
      '--params',
      JSON.stringify({ node: 'linked' }),
    ])
    await expect(linked).toBeEnabled({ timeout: 20_000 })
    await expect(other).toBeDisabled()
    await capturePlugins(page, info, 'plugin-node-header-enabled')
    await linked.click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened))
      .toEqual([[link, '_blank', 'noopener,noreferrer']])
  } finally {
    await electronApp.close()
    await removePathWithRetry(userDataDir)
    await removePathWithRetry(source)
  }
})

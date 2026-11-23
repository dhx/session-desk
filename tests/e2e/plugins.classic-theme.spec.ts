import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  type SeedNode,
} from './workspace-canvas.helpers'
import { pluginCli } from './plugins.commands.helpers'
import { capturePlugins } from './plugins.local.helpers'

const source = resolve(__dirname, '../../plugins/classic-theme')
const nodes: SeedNode[] = [
  { id: 'shell', title: 'build shell', position: { x: 60, y: 60 }, width: 460, height: 280 },
  {
    id: 'note',
    title: 'release notes',
    kind: 'note',
    position: { x: 560, y: 60 },
    width: 320,
    height: 220,
    task: { text: 'Ship the Classic theme.\nCheck dark and light.' },
  },
  {
    id: 'task',
    title: 'review',
    kind: 'task',
    position: { x: 560, y: 320 },
    width: 320,
    height: 220,
    task: { requirement: 'Review the theme', status: 'todo', linkedAgentNodeId: null },
  },
]

for (const appearance of ['dark', 'light'] as const) {
  test(`Classic ${appearance} draws line icons and plain frames in place of the pixel look`, async ({
    browserName: _,
  }, info) => {
    test.setTimeout(150_000)
    const userDataDir = await createTestUserDataDir()
    const { electronApp, window: page } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
    })
    try {
      await page.setViewportSize({ width: 1280, height: 850 })
      await clearAndSeedWorkspace(page, nodes, {
        settings: { language: 'en', uiTheme: appearance },
      })
      const root = page.locator('html')
      await expect(root).toHaveAttribute('data-cove-icons', 'pixel')
      await expect(page.locator('svg[data-cove-icon-set="line"]')).toHaveCount(0)
      await page.getByTestId('app-header-control-center').click()
      const panel = page.locator('.control-center[data-cove-frame="standalone"]')
      await expect(panel).toBeVisible()
      expect(await panel.evaluate(element => getComputedStyle(element).clipPath)).not.toBe('none')
      await capturePlugins(page, info, `cove-${appearance}`)
      await page.keyboard.press('Escape')

      await pluginCli(userDataDir, ['install', source])
      await clearAndSeedWorkspace(page, nodes, {
        settings: { language: 'en', uiTheme: `plugin:session-desk-classic:${appearance}` },
      })
      await expect(root).toHaveAttribute(
        'data-cove-theme-id',
        `plugin:session-desk-classic:${appearance}`,
      )
      await expect(root).toHaveAttribute('data-cove-icons', 'line')
      await expect(root).toHaveAttribute('data-cove-theme', appearance)
      // Every app icon on screen is a line icon now; none is left as pixel art.
      await expect(page.locator('svg[data-cove-icon-set="line"]').first()).toBeVisible()
      await expect(
        page.locator('svg[data-cove-pixel-icon]:not([data-cove-icon-set="line"])'),
      ).toHaveCount(0)
      await expect(
        page.locator('svg[data-cove-pixel-glyph]:not([data-cove-icon-set="line"])'),
      ).toHaveCount(0)
      await capturePlugins(page, info, `classic-${appearance}-canvas`)

      await page.getByTestId('app-header-control-center').click()
      await expect(panel).toBeVisible()
      const frame = await panel.evaluate(element => {
        const style = getComputedStyle(element)
        return {
          clipPath: style.clipPath,
          radius: style.borderTopLeftRadius,
          ring: getComputedStyle(element, '::before').display,
        }
      })
      expect(frame).toEqual({ clipPath: 'none', radius: '10px', ring: 'none' })
      await capturePlugins(page, info, `classic-${appearance}`)
    } finally {
      await electronApp.close()
      await removePathWithRetry(userDataDir)
    }
  })
}

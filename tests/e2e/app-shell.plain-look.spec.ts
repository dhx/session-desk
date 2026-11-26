import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, type SeedNode } from './workspace-canvas.helpers'
import { capturePlugins } from './plugins.local.helpers'

// This fork's one look (docs/dhx/RELEASES.md): line icons, plain frames, no pixel effects.
const nodes: SeedNode[] = [
  { id: 'shell', title: 'build shell', position: { x: 60, y: 60 }, width: 460, height: 280 },
  {
    id: 'note',
    title: 'release notes',
    kind: 'note',
    position: { x: 560, y: 60 },
    width: 320,
    height: 220,
    task: { text: 'One look.\nDark and light.' },
  },
  {
    id: 'task',
    title: 'review',
    kind: 'task',
    position: { x: 560, y: 320 },
    width: 320,
    height: 220,
    task: { requirement: 'Review the look', status: 'todo', linkedAgentNodeId: null },
  },
]

for (const appearance of ['dark', 'light'] as const) {
  test(`the built-in ${appearance} theme is the plain look: line icons, plain frames, no pixel effects`, async ({
    browserName: _,
  }, info) => {
    test.setTimeout(120_000)
    const { electronApp, window: page } = await launchApp()
    try {
      await page.setViewportSize({ width: 1280, height: 850 })
      // A profile that had the pixel look switched on, and one that had the Classic plugin selected.
      await clearAndSeedWorkspace(page, nodes, {
        settings: {
          language: 'en',
          uiTheme: appearance === 'dark' ? 'plugin:session-desk-classic:dark' : 'pixel-light',
          canvasBackgroundStyle: 'pixel',
          nodeCreationPixelEffectEnabled: true,
          agentWorkingPixelEffectEnabled: true,
        },
      })
      const root = page.locator('html')
      await expect(root).toHaveAttribute('data-cove-theme-id', appearance)
      await expect(root).toHaveAttribute('data-cove-theme', appearance)

      // Every app icon and kind glyph on screen is a line icon.
      await expect(page.locator('svg[data-cove-icon-set="line"]').first()).toBeVisible()
      await expect(
        page.locator('svg[data-cove-pixel-icon]:not([data-cove-icon-set="line"])'),
      ).toHaveCount(0)
      await expect(
        page.locator('svg[data-cove-pixel-glyph]:not([data-cove-icon-set="line"])'),
      ).toHaveCount(0)
      await expect(page.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(0)
      await capturePlugins(page, info, `plain-${appearance}-canvas`)

      // The Control Center is a plain rounded panel.
      await page.getByTestId('app-header-control-center').click()
      const panel = page.locator('.control-center[data-cove-frame="standalone"]')
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
      await capturePlugins(page, info, `plain-${appearance}`)
      await page.keyboard.press('Escape')

      // Settings → Appearance offers no pixel effects.
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-appearance').click()
      await expect(page.getByTestId('settings-ui-theme')).toBeVisible()
      await expect(page.getByTestId('settings-node-creation-pixel-effect')).toHaveCount(0)
      await expect(page.getByTestId('settings-canvas-background-style')).toHaveCount(0)
      await capturePlugins(page, info, `plain-${appearance}-settings`)
    } finally {
      await electronApp.close()
    }
  })
}

import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const linuxOnly = process.platform !== 'linux'
const READY_ENV_KEY = 'OPENCOVE_OSC52_READY_TOKEN'
const COPY_ENV_KEY = 'OPENCOVE_OSC52_COPY_TOKEN'

// Stands in for Claude Code / Codex: captures the mouse (SGR mouse mode) and, on the first mouse
// report, copies through OSC 52 the way those TUIs do when the person selects text in them.
const MOUSE_CAPTURING_COPIER = [
  `const ready=process.env.${READY_ENV_KEY};`,
  `const copy=process.env.${COPY_ENV_KEY};`,
  `process.stdin.setRawMode(true);`,
  `process.stdout.write('\\x1b[?1000h\\x1b[?1006h'+ready+'\\r\\n');`,
  `process.stdin.on('data',d=>{if(String(d).includes('\\x1b[<')){`,
  `process.stdout.write('\\x1b]52;c;'+Buffer.from(copy).toString('base64')+'\\x07');`,
  `process.stdout.write('\\x1b[?1000l\\x1b[?1006l');process.exit(0)}});`,
].join('')

test.describe('Workspace Canvas - Terminal OSC 52 copy', () => {
  test.skip(linuxOnly, 'Linux only')

  test('a mouse-capturing program copies to the clipboard through OSC 52', async () => {
    const readyToken = `OPENCOVE_OSC52_READY_${Date.now()}`
    const copyToken = `OPENCOVE_OSC52_COPIED_${Date.now()} ✓`
    const { electronApp, window } = await launchApp({
      env: {
        [READY_ENV_KEY]: readyToken,
        [COPY_ENV_KEY]: copyToken,
      },
    })

    try {
      await electronApp.evaluate(async ({ clipboard }) => {
        clipboard.clear()
      })

      await clearAndSeedWorkspace(window, [
        {
          id: 'node-osc52-copy',
          title: 'terminal-osc52-copy',
          position: { x: 120, y: 120 },
          width: 520,
          height: 320,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      await window.keyboard.type(`node -e "${MOUSE_CAPTURING_COPIER}"`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(readyToken)

      await xterm.click({ position: { x: 60, y: 60 } })

      await expect
        .poll(
          async () =>
            await electronApp.evaluate(async ({ clipboard }) => {
              return clipboard.readText()
            }),
        )
        .toBe(copyToken)
    } finally {
      await electronApp.close()
    }
  })
})

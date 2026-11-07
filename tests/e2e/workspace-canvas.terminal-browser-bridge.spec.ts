import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const linuxOnly = process.platform !== 'linux'
const isWebTarget = process.env['OPENCOVE_E2E_TARGET']?.trim().toLowerCase() === 'web'
const READY_ENV_KEY = 'OPENCOVE_BROWSER_BRIDGE_READY_TOKEN'
const URL_ENV_KEY = 'OPENCOVE_BROWSER_BRIDGE_URL'

type LinkCaptureGlobal = typeof globalThis & { __opencoveLinkOpenCalls?: string[] }

// Stands in for Codex: captures the mouse and, when a link in its window is clicked, starts
// BROWSER with its stdio detached. On a headless worker (the Web target) BROWSER is the bridge
// script; the desktop app has a display and no bridge, so the program writes OSC 7777 itself.
const MOUSE_CAPTURING_OPENER = [
  `const ready=process.env.${READY_ENV_KEY};`,
  `const url=process.env.${URL_ENV_KEY};`,
  `const browser=process.env.BROWSER;`,
  `process.stdin.setRawMode(true);`,
  `process.stdout.write('\\x1b[?1000h\\x1b[?1006h'+(browser?'BRIDGED\\r\\n':'')+ready+'\\r\\n');`,
  `process.stdin.on('data',d=>{if(String(d).includes('\\x1b[<')){`,
  `process.stdout.write('\\x1b[?1000l\\x1b[?1006l');`,
  `if(browser){require('child_process').spawn(browser,[url],{stdio:'ignore'}).on('exit',()=>process.exit(0))}`,
  `else{process.stdout.write('\\x1b]7777;open;'+url+'\\x07');process.exit(0)}}});`,
].join('')

test.describe('Workspace Canvas - Terminal browser bridge', () => {
  test.skip(linuxOnly, 'Linux only')

  test('a mouse-capturing program opens a clicked link in the viewer browser', async () => {
    const readyToken = `BRIDGE_READY_${Date.now()}`
    const uri = 'https://example.com/bridged?pr=261'
    const { electronApp, window } = await launchApp({
      env: { [READY_ENV_KEY]: readyToken, [URL_ENV_KEY]: uri },
    })

    try {
      const opened: string[] = []
      if (isWebTarget) {
        // The popup is the viewer's new tab; keep it off the network.
        await window
          .context()
          .route('https://example.com/**', route => route.fulfill({ status: 200, body: 'ok' }))
        window.context().on('page', page => opened.push(page.url()))
      } else {
        await electronApp.evaluate(({ shell }) => {
          const state = globalThis as LinkCaptureGlobal
          state.__opencoveLinkOpenCalls = []
          shell.openExternal = async target => {
            state.__opencoveLinkOpenCalls?.push(target)
          }
        })
      }
      const readOpened = async (): Promise<string[]> =>
        isWebTarget
          ? opened
          : ((await electronApp.evaluate(
              () => (globalThis as LinkCaptureGlobal).__opencoveLinkOpenCalls,
            )) ?? [])

      await clearAndSeedWorkspace(window, [
        {
          id: 'node-browser-bridge',
          title: 'terminal-browser-bridge',
          position: { x: 120, y: 120 },
          width: 720,
          height: 320,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      await window.keyboard.type(`node -e "${MOUSE_CAPTURING_OPENER}"`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(readyToken)
      if (isWebTarget) {
        await expect(terminal).toContainText('BRIDGED')
      }

      await xterm.click({ position: { x: 60, y: 60 } })

      await expect.poll(async () => (await readOpened()).map(url => decodeURI(url))).toEqual([uri])
    } finally {
      await electronApp.close()
    }
  })
})

// SPIKE (tiling remount feasibility, docs/canvas/TILING_VIEW_SPEC.md §10). Never merged: it
// measures and reports; it asserts only what the spec requires to stay true.
import { chromium, expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
} from './workspace-canvas.helpers'

const nodeId = 'terminal-tiling-spike'
const SWITCHES = 10

type SpikeEvent = { ts: number; event: string; clientId?: string; [key: string]: unknown }

async function sessionIdOf(page: Page): Promise<string | null> {
  return await page.evaluate(
    id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
    nodeId,
  )
}

async function gridOf(page: Page): Promise<{ cols: number; rows: number } | null> {
  return await page.evaluate(
    id => window.__opencoveTerminalSelectionTestApi?.getSize(id) ?? null,
    nodeId,
  )
}

async function writeMarker(page: Page, marker: string): Promise<void> {
  const terminal = page.locator('.terminal-node').first()
  await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')
  await terminal.locator('.xterm').click()
  await page.keyboard.type(
    buildNodeEvalCommand(`process.stdout.write(${JSON.stringify(marker)} + '\\n')`),
  )
  await page.keyboard.press('Enter')
}

/** Records the most `.xterm` elements present at once, to catch two mounted bodies. */
async function watchXtermCount(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __spikeMaxXterm: number }
    w.__spikeMaxXterm = document.querySelectorAll('.xterm').length
    new MutationObserver(() => {
      w.__spikeMaxXterm = Math.max(w.__spikeMaxXterm, document.querySelectorAll('.xterm').length)
    }).observe(document.body, { childList: true, subtree: true })
  })
}

async function maxXterm(page: Page): Promise<number> {
  return await page.evaluate(
    () => (window as unknown as { __spikeMaxXterm: number }).__spikeMaxXterm,
  )
}

async function readLog(path: string): Promise<SpikeEvent[]> {
  const text = await readFile(path, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as SpikeEvent)
}

const pageErrors: string[] = []

function collectErrors(page: Page, label: string): void {
  page.on('pageerror', error =>
    pageErrors.push(`${label} pageerror: ${error.message}`.slice(0, 600)),
  )
  page.on('console', message => {
    if (message.type() === 'error') {
      pageErrors.push(`${label} console: ${message.text()}`.slice(0, 600))
    }
  })
}

async function tileDiagnostics(page: Page) {
  return await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="tiling-spike-layer"]')
    return {
      hasSpikeApi: typeof window.__opencoveTilingSpike,
      state: window.__opencoveTilingSpike?.state().tiledNodeId ?? null,
      layer: layer ? layer.outerHTML.slice(0, 1200) : null,
      terminalNodes: document.querySelectorAll('.terminal-node').length,
      xterms: document.querySelectorAll('.xterm').length,
    }
  })
}

async function switchTenTimes(page: Page, marker: string) {
  const toTileMs: number[] = []
  const toCanvasMs: number[] = []
  for (let index = 0; index < SWITCHES; index += 1) {
    let start = Date.now()
    await page.evaluate(id => window.__opencoveTilingSpike?.tile(id), nodeId)
    const tile = page.locator('[data-testid="tiling-spike-layer"] .terminal-node')
    try {
      await expect(tile.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false', {
        timeout: 15_000,
      })
    } catch (error) {
      throw new Error(
        `tile did not become ready: ${JSON.stringify(await tileDiagnostics(page))} errors=${JSON.stringify(pageErrors.slice(-10))}`,
        { cause: error },
      )
    }
    await expect(tile).toContainText(marker, { timeout: 15_000 })
    toTileMs.push(Date.now() - start)
    await page.waitForTimeout(400)

    start = Date.now()
    await page.evaluate(() => window.__opencoveTilingSpike?.untile())
    await expect(page.locator('[data-testid="tiling-spike-layer"]')).toHaveCount(0)
    const canvas = page.locator('.react-flow .terminal-node')
    await expect(canvas.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false', {
      timeout: 15_000,
    })
    await expect(canvas).toContainText(marker, { timeout: 15_000 })
    toCanvasMs.push(Date.now() - start)
    await page.waitForTimeout(400)
  }
  return { toTileMs, toCanvasMs }
}

function summarise(events: SpikeEvent[], sessionId: string) {
  const mine = events.filter(event => event.sessionId === sessionId)
  const byClient: Record<
    string,
    { attach: number; overlappingAttach: number; detach: number; acceptedResizes: number }
  > = {}
  const client = (id: string | undefined) =>
    (byClient[id ?? '?'] ??= { attach: 0, overlappingAttach: 0, detach: 0, acceptedResizes: 0 })
  for (const event of mine) {
    if (event.event === 'attach') {
      client(event.clientId).attach += 1
      if (event.alreadySubscribed) {
        client(event.clientId).overlappingAttach += 1
      }
    } else if (event.event === 'detach') {
      client(event.clientId).detach += 1
    } else if (event.event === 'resize_diag') {
      client(event.clientId).acceptedResizes += 1
    }
  }
  const resultStatuses: Record<string, number> = {}
  for (const event of mine.filter(item => item.event === 'resize_result')) {
    const status = String(event.status)
    resultStatuses[status] = (resultStatuses[status] ?? 0) + 1
  }
  const geometryChanges = mine.filter(
    event => event.event === 'resize_diag' && event['diagEvent'] === 'stream-forwarded',
  ).length
  return { byClient, resultStatuses, geometryChangingResizes: geometryChanges }
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    all: values,
  }
}

test('SPIKE: tiling view switch keeps the PTY session and attaches cleanly', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(240_000)
  const userDataDir = await createTestUserDataDir()
  const logPath = join(userDataDir, 'tiling-spike.jsonl')
  await writeFile(
    join(userDataDir, 'home-worker.json'),
    `${JSON.stringify({
      version: 1,
      mode: 'local',
      remote: null,
      webUi: { enabled: true, port: null, exposeOnLan: false, passwordHash: null },
      updatedAt: null,
    })}\n`,
    'utf8',
  )
  const { electronApp, window: desktop } = await launchApp({
    windowMode: 'offscreen',
    userDataDir,
    env: { OPENCOVE_SPIKE_LOG: logPath },
  })
  const browser = await chromium.launch({ headless: true })
  const report: Record<string, unknown> = {}
  try {
    await clearAndSeedWorkspace(desktop, [
      { id: nodeId, title: nodeId, position: { x: 120, y: 120 }, width: 680, height: 360 },
    ])
    await expect(desktop.locator('.terminal-node')).toHaveCount(1)
    const webUiUrl = await desktop.evaluate(
      async () => await window.opencoveApi.worker.getWebUiUrl(),
    )
    const web = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await web.goto(webUiUrl!, { waitUntil: 'domcontentloaded' })
    await web.goto(new URL('/?opencoveTerminalTestApi=1', webUiUrl!).toString(), {
      waitUntil: 'domcontentloaded',
    })
    await expect(web.locator('.terminal-node .terminal-node__terminal')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 30_000 },
    )
    const sessionId = await sessionIdOf(desktop)
    expect(sessionId).toBeTruthy()
    await expect.poll(() => sessionIdOf(web), { timeout: 30_000 }).toBe(sessionId)

    const marker = `TILING_SPIKE_${Date.now()}`
    await writeMarker(desktop, marker)
    await expect(web.locator('.terminal-node')).toContainText(marker, { timeout: 10_000 })
    collectErrors(desktop, 'desktop')
    collectErrors(web, 'web')
    await watchXtermCount(desktop)
    await watchXtermCount(web)
    report['gridBefore'] = { desktop: await gridOf(desktop), web: await gridOf(web) }
    const logStart = (await readLog(logPath)).length
    report['setupEvents'] = summarise((await readLog(logPath)).slice(0, logStart), sessionId!)

    // Phase A: the Web client switches; Desktop stays on the canvas.
    const webTimings = await switchTenTimes(web, marker).catch(error => {
      report['phaseA_error'] = String(error).slice(0, 4000)
      throw error
    })
    const afterA = await readLog(logPath)
    report['phaseA_webSwitches'] = {
      timings: { toTile: stats(webTimings.toTileMs), toCanvas: stats(webTimings.toCanvasMs) },
      sessionIds: { desktop: await sessionIdOf(desktop), web: await sessionIdOf(web) },
      grids: { desktop: await gridOf(desktop), web: await gridOf(web) },
      maxXterm: { desktop: await maxXterm(desktop), web: await maxXterm(web) },
      worker: summarise(afterA.slice(logStart), sessionId!),
    }

    // Phase B: the Desktop client switches; Web stays on the canvas.
    const desktopTimings = await switchTenTimes(desktop, marker).catch(error => {
      report['phaseB_error'] = String(error).slice(0, 4000)
      throw error
    })
    const afterB = await readLog(logPath)
    report['phaseB_desktopSwitches'] = {
      timings: {
        toTile: stats(desktopTimings.toTileMs),
        toCanvas: stats(desktopTimings.toCanvasMs),
      },
      sessionIds: { desktop: await sessionIdOf(desktop), web: await sessionIdOf(web) },
      grids: { desktop: await gridOf(desktop), web: await gridOf(web) },
      maxXterm: { desktop: await maxXterm(desktop), web: await maxXterm(web) },
      worker: summarise(afterB.slice(afterA.length), sessionId!),
    }
    report['rawEvents'] = afterB.filter(event => event.sessionId === sessionId)

    // What the spec requires to hold; everything else is measured, not asserted.
    expect(await sessionIdOf(desktop)).toBe(sessionId)
    expect(await sessionIdOf(web)).toBe(sessionId)
    await expect(desktop.locator('.terminal-node')).toContainText(marker)
    await expect(web.locator('.terminal-node')).toContainText(marker)
  } finally {
    const json = JSON.stringify(report, null, 2)
    await writeFile(testInfo.outputPath('tiling-spike-report.json'), json, 'utf8')
    await testInfo.attach('tiling-spike-report', { body: json, contentType: 'application/json' })
    report['pageErrors'] = pageErrors.slice(-20)
    const { rawEvents: _raw, ...summary } = report
    process.stdout.write(`TILING_SPIKE_REPORT ${JSON.stringify(summary)}\n`)
    await browser.close()
    await electronApp.close()
  }
})

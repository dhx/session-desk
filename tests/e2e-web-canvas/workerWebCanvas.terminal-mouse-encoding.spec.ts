import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand } from '../e2e/workspace-canvas.testUtils'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

test('mouse motion and wheel remain SGR encoded after live Web reattach', async ({
  page,
}, testInfo) => {
  const workspacePath = await createWorkspaceDir('mouse-encoding')
  await writeAppState(
    page.request,
    buildAppState({ workspacePath, workspaceName: 'mouse-encoding', spaces: [] }),
  )
  await openAuthedCanvas(page, '/?opencoveTerminalTestApi=1')
  const pane = page.locator('.workspace-canvas .react-flow__pane')
  await expect(pane).toBeVisible()
  await pane.click({ button: 'right', position: { x: 260, y: 220 } })
  await page.getByTestId('workspace-context-new-terminal').click()
  const terminal = page.locator('.terminal-node').first()
  await expect(terminal).toBeVisible()
  const shared = await readSharedState(page.request)
  const nodeId = shared.state?.workspaces[0]?.nodes.find(node => node.kind === 'terminal')?.id
  expect(typeof nodeId).toBe('string')
  if (typeof nodeId !== 'string') {
    throw new Error('Missing terminal node')
  }
  await terminal.locator('.xterm').click()
  await page.keyboard.type(
    buildNodeEvalCommand(`
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let reports = 0;
      process.stdin.on('data', data => {
        const text = data.toString('latin1');
        if (text.includes('\\x1b[M')) process.stdout.write('\\r\\nMOUSE_LEGACY');
        if (text.includes('\\x1b[<')) {
          process.stdout.write('\\r\\nMOUSE_SGR_' + (++reports));
          process.stdout.write(/\\x1b\\[<(\\d+)/.exec(text)?.[1] >= 64 ? ' WHEEL' : ' MOVE');
        }
      });
      process.stdout.write('\\x1b[2J\\x1b[H\\x1b[?1006hMOUSE_READY\\x1b[?1003h');
    `),
  )
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText('MOUSE_READY')

  const read = async () =>
    await page.evaluate(id => {
      const buffer = window.__opencoveTerminalSelectionTestApi?.getBufferText(id, 'MOUSE_READY')
      return buffer?.viewportLines.join('\n') ?? ''
    }, nodeId)
  await expect.poll(read).toContain('MOUSE_READY')
  const exerciseMouse = async () => {
    const point = await page.evaluate(
      id => window.__opencoveTerminalSelectionTestApi?.getCellCenter(id, 8, 3),
      nodeId,
    )
    if (!point) {
      throw new Error('Terminal cell not available')
    }
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, -100)
  }
  await exerciseMouse()
  await expect.poll(read).toContain('MOUSE_SGR_')
  expect(await read()).not.toContain('MOUSE_LEGACY')
  await expect.poll(read).toContain('WHEEL')
  await expect.poll(read).toContain('MOVE')
  const sessionId = await page.evaluate(
    id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id),
    nodeId,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(terminal).toBeVisible()
  await expect
    .poll(
      async () =>
        await page.evaluate(
          id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id),
          nodeId,
        ),
    )
    .toBe(sessionId)
  await expect(terminal).toContainText('MOUSE_READY')
  await expect.poll(read).toContain('MOUSE_READY')
  const before = Math.max(
    0,
    ...[...(await read()).matchAll(/MOUSE_SGR_(\d+)/g)].map(match => Number(match[1])),
  )
  await exerciseMouse()
  await expect.poll(read).toContain(`MOUSE_SGR_${before + 1}`)
  expect(await read()).not.toContain('MOUSE_LEGACY')
  await testInfo.attach('mouse-encoding-after-reattach', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
})

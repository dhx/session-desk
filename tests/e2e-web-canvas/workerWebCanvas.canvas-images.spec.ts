import { expect, test, type Page } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  dispatchFileTransfer,
  openAuthedCanvas,
  readSharedState,
  webCanvasBaseUrl,
  webCanvasToken,
  writeAppState,
} from './helpers'

// 2x2 PNG.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

const PANE = '.workspace-canvas .react-flow__pane'

async function seedEmptyCanvas(page: Page, name: string): Promise<void> {
  const workspacePath = await createWorkspaceDir(name)
  await writeAppState(page.request, () => buildAppState({ workspacePath, spaces: [] }))
}

async function readImageAssetIds(page: Page): Promise<string[]> {
  const { state } = await readSharedState(page.request)
  return (state?.workspaces[0]?.nodes ?? [])
    .filter(node => node.kind === 'image')
    .map(node => String((node.task as { assetId?: unknown } | null)?.assetId ?? ''))
}

async function expectImageShown(page: Page, count: number): Promise<void> {
  const images = page.locator('.image-node img.image-node__img')
  await expect(images).toHaveCount(count)
  for (let index = 0; index < count; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await expect(images.nth(index)).toHaveAttribute('src', /^blob:/)
    // eslint-disable-next-line no-await-in-loop
    await expect
      .poll(() => images.nth(index).evaluate(img => (img as HTMLImageElement).naturalWidth))
      .toBe(2)
  }
}

test.describe('Worker web canvas images', () => {
  test('a pasted image becomes an image node that survives reload and shows in other browsers', async ({
    browser,
    page,
  }) => {
    await seedEmptyCanvas(page, 'canvas-image-paste')
    await openAuthedCanvas(page)
    await expect(page.locator(PANE)).toBeVisible()

    await dispatchFileTransfer(page, PANE, 'paste', [
      { kind: 'file', name: 'image.png', type: 'image/png', base64: TINY_PNG_BASE64 },
    ])

    await expectImageShown(page, 1)
    await expect.poll(() => readImageAssetIds(page)).toHaveLength(1)

    // The bytes are on the worker: read them back over its route.
    const [assetId] = await readImageAssetIds(page)
    const stored = await page.request.get(`/canvas-images/${assetId}`, {
      headers: { authorization: `Bearer ${webCanvasToken}` },
    })
    expect(stored.status()).toBe(200)
    expect(stored.headers()['content-type']).toBe('image/png')
    expect((await stored.body()).toString('base64')).toBe(TINY_PNG_BASE64)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator(PANE)).toBeVisible()
    await expectImageShown(page, 1)

    const secondContext = await browser.newContext({ baseURL: webCanvasBaseUrl })
    try {
      const secondPage = await secondContext.newPage()
      await openAuthedCanvas(secondPage)
      await expectImageShown(secondPage, 1)
    } finally {
      await secondContext.close()
    }
  })

  test('a dropped image file becomes an image node', async ({ page }) => {
    await seedEmptyCanvas(page, 'canvas-image-drop')
    await openAuthedCanvas(page)
    await expect(page.locator(PANE)).toBeVisible()

    await dispatchFileTransfer(page, PANE, 'drop', [
      { kind: 'file', name: 'dropped.png', type: 'image/png', base64: TINY_PNG_BASE64 },
    ])

    await expectImageShown(page, 1)
    await expect.poll(() => readImageAssetIds(page)).toHaveLength(1)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectImageShown(page, 1)
  })
})

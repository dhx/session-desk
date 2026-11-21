import { defineConfig } from '@playwright/test'
import { webTargetSkips } from './tests/e2e/webTarget/skips'

// The Electron E2E suite (tests/e2e) against the headless worker and its Web UI in Chromium.
// `launchApp()` (tests/e2e/workspace-canvas.app.ts) switches on OPENCOVE_E2E_TARGET; set here so every
// Playwright worker process sees it. Run: `pnpm build && pnpm exec playwright test -c
// playwright.e2e-web.config.ts` (docs/dhx/RELEASES.md).
process.env['OPENCOVE_E2E_TARGET'] = 'web'

const isCi = process.env.CI === '1' || process.env.CI === 'true'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Playwright matches grep against "<project> <file> <describe titles> <test title> <tags>"; a skip's
// title may be a fragment of a templated test title.
// OPENCOVE_E2E_WEB_NO_SKIPS=1 runs the skipped tests too, e.g. to see whether a gap has closed.
const activeSkips = process.env['OPENCOVE_E2E_WEB_NO_SKIPS'] === '1' ? [] : webTargetSkips
const skippedTests = activeSkips
  .filter(skip => typeof skip.title === 'string')
  .map(
    skip => new RegExp(`(^|\\s)${escapeRegExp(skip.file)}\\s.*${escapeRegExp(skip.title ?? '')}`),
  )
const skippedFiles = activeSkips
  .filter(skip => typeof skip.title !== 'string')
  .map(skip => `**/${skip.file}`)

function resolveRetries(rawValue: string | undefined): number {
  const parsed = Number(rawValue)
  return rawValue?.trim() && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: skippedFiles,
  forbidOnly: !!process.env.CI,
  grepInvert: skippedTests.length > 0 ? skippedTests : undefined,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  retries: resolveRetries(process.env.OPENCOVE_E2E_RETRIES),
  workers: 1,
  reporter: isCi
    ? [['list'], ['json', { outputFile: 'test-results-e2e-web/results.json' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-e2e-web' }]],
  outputDir: './test-results-e2e-web',
  projects: [
    {
      name: 'e2e-web',
      use: {
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],
})

/**
 * Vitest 测试环境设置文件
 *
 * 此文件在每个测试文件运行前自动加载
 */
import '@testing-library/jest-dom/vitest'
import { installMockStorage } from './persistenceTestStorage'

// Headless Linux terminals get a browser bridge (src/platform/terminal/browserBridge.ts) that
// writes into the home cache and extends PATH. Tests that spawn with the real process env must not
// depend on whether the machine has a display; bridge tests inject their env explicitly.
if (typeof process !== 'undefined' && !process.env.BROWSER) {
  process.env.BROWSER = 'opencove-test-no-browser'
}

if (typeof window !== 'undefined') {
  const storage = window.localStorage as Partial<Storage> | undefined
  if (
    typeof storage?.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function' ||
    typeof storage.clear !== 'function'
  ) {
    installMockStorage()
  }
}

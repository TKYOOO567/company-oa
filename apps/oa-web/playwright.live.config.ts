import { defineConfig, devices } from '@playwright/test'
import { liveOutputDirectory, readLiveSettings } from './e2e/support/live-settings'

// This configuration never starts services. The operator must start the isolated
// Java/O2OA/MariaDB platform and the connected Web app before explicitly enabling it.
const settings = readLiveSettings()
const stage = process.env.OA_LIVE_STAGE || 'pending'
if (!['pending', 'completed'].includes(stage))
  throw new Error('OA_LIVE_STAGE must be pending or completed.')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'live-integration.spec.ts',
  grep: stage === 'completed' ? /completed workflow/ : undefined,
  grepInvert: stage === 'pending' ? /completed workflow/ : undefined,
  outputDir: liveOutputDirectory,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: 'list',
  use: {
    baseURL: settings.webBaseUrl,
    channel: process.env.OA_TEST_BROWSER_CHANNEL || 'chrome',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    actionTimeout: 20000,
    navigationTimeout: 60000,
  },
  projects: [
    {
      name: 'real-platform-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
})

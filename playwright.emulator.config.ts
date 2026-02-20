import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for E2E tests with Firebase Emulators.
 *
 * Prerequisites (run in a separate terminal before executing tests):
 *   npm run emulators
 *   # → starts Firebase Auth Emulator (port 9099) + Firestore Emulator (port 8080)
 *
 * Run tests:
 *   npm run test:e2e:emulator
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/equipment-tracking.spec.ts',
  fullyParallel: false, // run serially to avoid Firestore write conflicts
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report-emulator' }], ['list']],
  timeout: 120 * 1000,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Show browser for local debugging (set headless: true for CI)
    headless: true,
  },

  projects: [
    {
      name: 'chromium-emulator',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Dev server in emulator mode (port 3001, loads VITE_USE_EMULATOR=true from .env.e2e) */
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 60 * 1000,
  },
});

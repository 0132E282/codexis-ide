import { defineConfig, devices } from '@playwright/test';

// * Port of the Vite dev server (`vite.config.ts`); the browser tests run against it, without the Tauri backend.
const PORT = 1420;
const isCI = Boolean(process.env.CI);
// * `E2E_BASE_URL=https://example.com pnpm test:e2e` runs against a deployed website; without it the local Vite server is started.
const remoteBaseURL = process.env.E2E_BASE_URL;

export default defineConfig({
    testDir: 'e2e',
    outputDir: '.agents/storage/playwright',
    fullyParallel: true,
    workers: isCI ? 2 : '50%',
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: isCI
        ? [
              ['github'],
              [
                  'html',
                  {
                      open: 'never',
                      outputFolder: '.agents/storage/playwright-report',
                  },
              ],
          ]
        : [
              ['list'],
              [
                  'html',
                  {
                      open: 'never',
                      outputFolder: '.agents/storage/playwright-report',
                  },
              ],
          ],
    use: {
        baseURL: remoteBaseURL ?? `http://localhost:${PORT}`,
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        // * Trace keeps the DOM, network and console of a failing run, so it can be opened with `pnpm test:e2e:report`.
        trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    },
    // * Every browser project runs at the same time (in parallel workers); `--project=firefox` runs just one.
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    webServer: remoteBaseURL
        ? undefined
        : {
              command: 'pnpm dev',
              url: `http://localhost:${PORT}`,
              reuseExistingServer: !isCI,
              timeout: 60_000,
          },
});

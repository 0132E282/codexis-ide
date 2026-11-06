import { defineConfig, devices } from '@playwright/test';

// * Port of the Vite dev server (`vite.config.ts`); the browser tests run against it, without the Tauri backend.
const PORT = 1420;

export default defineConfig({
    testDir: 'e2e',
    outputDir: '.agents/storage/playwright',
    use: {
        baseURL: `http://localhost:${PORT}`,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'pnpm dev',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
    },
});

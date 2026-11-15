import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // One worker: every test drives the same local API, whose real-data aggregations
  // time out when several browsers query it at once.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1100 },
    // Software rendering keeps MapLibre tests independent of the host GPU.
    launchOptions: { args: ['--use-angle=swiftshader', '--in-process-gpu'] },
  },
  webServer: [
    { command: '../.venv/bin/python -m uvicorn app.api.main:app --app-dir ../.. --host 127.0.0.1 --port 8000', url: 'http://127.0.0.1:8000/meta', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});

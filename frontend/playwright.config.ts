import { defineConfig, devices } from "playwright/test";

const backendPort = process.env.RMUC_E2E_BACKEND_PORT ?? "8001";
const frontendPort = process.env.RMUC_E2E_FRONTEND_PORT ?? "3105";
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  reporter: "line",
  use: {
    baseURL: frontendOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      command: `.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: "..",
      url: `${backendOrigin}/api/health/ready`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `NEXT_PUBLIC_API_BASE_URL=${backendOrigin} npm run dev -- --hostname 127.0.0.1 --port ${frontendPort}`,
      cwd: ".",
      url: frontendOrigin,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

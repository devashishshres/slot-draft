import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

/**
 * Port comes from $DEEPSPACE_PORT (set by `deepspace test run [--port N]`),
 * defaulting to 5173. The same port is passed to vite via --strictPort so
 * a busy address fails fast rather than silently rebinding to 5174.
 *
 * The test runner owns this server. A busy port is a hard failure so a test
 * can never attach to an unrelated or shutting-down app. To run suites in
 * parallel, give each one a different --port.
 */
const PORT = Number(process.env.DEEPSPACE_PORT ?? 5173)
// Use the address the test server binds to. New Chromium releases can apply
// Local Network Access checks to top-level `localhost` navigation in an agent
// container; the explicit loopback address keeps the browser and Vite on the
// same local origin without relying on hostname classification.
const LOCAL_URL = `http://127.0.0.1:${PORT}`
// Set SLOTDRAFT_BASE_URL=https://<name>.app.space to run against the deployed
// app instead (no local server is started). Use it for the smoke suite only:
// the other suites create test rounds, which would land in production data.
const REMOTE_URL = process.env.SLOTDRAFT_BASE_URL
const BASE_URL = REMOTE_URL ?? LOCAL_URL

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
  webServer: REMOTE_URL ? undefined : {
    // Bind the local test server directly. A bare `--host` asks Vite to
    // enumerate every interface, which fails in restricted containers before
    // the app can start (`uv_interface_addresses`).
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: '..',
    // Readiness gates on the auth plane, not just vite: /api/auth/ok only
    // answers once workerd behind /api/* has booted, so no test starts
    // against a half-up server. Playwright keeps polling through non-OK
    // responses and fails setup with its own clear error at the timeout.
    url: `${LOCAL_URL}/api/auth/ok`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

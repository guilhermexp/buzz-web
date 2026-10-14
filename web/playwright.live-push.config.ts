import { defineConfig } from "@playwright/test";

function liveBaseUrl(): string {
  const value = process.env.BUZZ_LIVE_BASE_URL?.trim();
  if (!value) throw new Error("BUZZ_LIVE_BASE_URL is required for live push acceptance tests.");
  const url = new URL(value);
  // Service workers and the Push API require a secure context; plain HTTP is only one on loopback.
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("BUZZ_LIVE_BASE_URL must use HTTPS, except for localhost.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "BUZZ_LIVE_BASE_URL must not contain credentials, query parameters, or a hash.",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

// The spec launches its own persistent Firefox profile: Playwright's Chromium
// builds have no GCM credentials, Firefox reaches Mozilla autopush directly.
// Screenshots, traces and videos stay off because identities are real keys.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/live-push.spec.ts"],
  timeout: 15 * 60_000,
  globalTimeout: 25 * 60_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: liveBaseUrl(),
    locale: "en-US",
    actionTimeout: 30_000,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});

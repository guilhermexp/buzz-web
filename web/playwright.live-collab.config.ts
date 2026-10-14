import { defineConfig } from "@playwright/test";

function liveBaseUrl(): string {
  const value = process.env.BUZZ_LIVE_BASE_URL?.trim();
  if (!value) throw new Error("BUZZ_LIVE_BASE_URL is required for live collaboration tests.");
  const url = new URL(value);
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

// Canvas, forums, reminders, Pulse and exports against a real Relay with real
// identities; traces and videos stay off because the identities are real keys.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/live-collab-*.spec.ts"],
  timeout: 240_000,
  globalTimeout: 30 * 60_000,
  expect: { timeout: 20_000 },
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

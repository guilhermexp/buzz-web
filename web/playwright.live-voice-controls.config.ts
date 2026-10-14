import { defineConfig } from "@playwright/test";

function liveBaseUrl(): string {
  const value = process.env.BUZZ_LIVE_BASE_URL?.trim();
  if (!value) throw new Error("BUZZ_LIVE_BASE_URL is required for live voice acceptance tests.");
  const url = new URL(value);
  // Microphone capture requires a secure context; plain HTTP is only one on loopback.
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

// Voice permission/device/reconnect and Firefox acceptance against a real Relay.
// Each test launches its own browsers with synthetic capture; screenshots,
// traces and videos stay off because identities are real keys.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/live-voice-controls.spec.ts"],
  timeout: 300_000,
  globalTimeout: 25 * 60_000,
  expect: { timeout: 15_000 },
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

import { defineConfig, devices } from "@playwright/test";
import { browserEnvironment } from "./tests/e2e/support/live-session";

function liveBaseUrl(): string {
  const value = process.env.BUZZ_LIVE_BASE_URL?.trim();
  if (!value) throw new Error("BUZZ_LIVE_BASE_URL is required for live UI shell acceptance tests.");
  const url = new URL(value);
  // Plain HTTP is accepted only on loopback.
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

// Screenshots, traces and videos stay off because identities are real keys.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/live-uishell.spec.ts"],
  timeout: 180_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: { env: browserEnvironment() },
    baseURL: liveBaseUrl(),
    locale: "en-US",
    actionTimeout: 30_000,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});

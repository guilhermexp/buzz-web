import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delay } from "./push-live";

// Firefox with `alerts.useSystemBackend: false` presents each web notification
// as its own toplevel XUL alert window (windowtype "alert:alert", X class
// name "alert"). A pointer click on that window runs the alert's own click
// handler, which Firefox turns into the service worker's `notificationclick`.
// These helpers drive the X server's pointer (XTest via xdotool); they never
// talk to the page or the worker.

const run = promisify(execFile);
const ALERT_CLASSNAME = "^alert$";
/** Inside the alert's title/body text, away from the close and settings buttons. */
const CLICK_X = 60;
const CLICK_Y = 36;

export type AlertWindow = { id: string; x: number; y: number; width: number; height: number };

async function xdotool(...args: string[]): Promise<string> {
  const { stdout } = await run("xdotool", args, { env: process.env });
  return stdout.trim();
}

/** Fail fast with the exact prerequisite when no X display is available. */
export async function requireXDisplay(): Promise<string> {
  if (!process.env.DISPLAY) {
    throw new Error(
      "DISPLAY is required: run this suite under xvfb-run (Xvfb) with xdotool and ImageMagick installed.",
    );
  }
  return xdotool("getdisplaygeometry");
}

/** Currently mapped Firefox alert windows. */
export async function visibleAlerts(): Promise<string[]> {
  try {
    const ids = await xdotool("search", "--onlyvisible", "--classname", ALERT_CLASSNAME);
    return ids ? ids.split("\n") : [];
  } catch (error) {
    // xdotool exits 1 when nothing matches.
    if (error && typeof error === "object" && "code" in error && error.code === 1) return [];
    throw error;
  }
}

async function geometry(id: string): Promise<AlertWindow> {
  const values = Object.fromEntries(
    (await xdotool("getwindowgeometry", "--shell", id))
      .split("\n")
      .map((line) => line.split("="))
      .map(([key, value]) => [key, Number(value)]),
  );
  return { id, x: values.X, y: values.Y, width: values.WIDTH, height: values.HEIGHT };
}

/**
 * Wait for an alert window that is not in `known`, then rest the pointer on
 * it. Hovering pauses the alert's 20-second auto-hide, exactly as a user's
 * pointer does, so the notification stays on screen until it is clicked.
 */
export async function waitForNewAlert(
  known: ReadonlySet<string>,
  timeoutMs = 180_000,
): Promise<AlertWindow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = (await visibleAlerts()).find((id) => !known.has(id));
    if (fresh) {
      await xdotool("mousemove", "--window", fresh, String(CLICK_X), String(CLICK_Y));
      return geometry(fresh);
    }
    await delay(200);
  }
  throw new Error(`no Firefox alert window appeared within ${timeoutMs} ms`);
}

/** Press and release the primary button on the alert, then wait for it to close. */
export async function clickAlert(alert: AlertWindow): Promise<void> {
  await xdotool("mousemove", "--window", alert.id, String(CLICK_X), String(CLICK_Y), "click", "1");
  const deadline = Date.now() + 10_000;
  while ((await visibleAlerts()).includes(alert.id)) {
    if (Date.now() > deadline) throw new Error(`alert window ${alert.id} stayed open after click`);
    await delay(100);
  }
}

/**
 * Capture the whole X screen (browser window plus any alert windows). The
 * headed window repaints asynchronously from the page Playwright inspects, so
 * give it a moment first; the capture is evidence, never an assertion.
 */
export async function captureScreen(path: string): Promise<void> {
  await delay(1_500);
  await run("import", ["-window", "root", path], { env: process.env });
}

import { randomBytes } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import {
  archiveChannel,
  browserEnvironment,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
  openChannel,
  reloadAndUnlock,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

const owner = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const approver = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
const screenshotDir = process.env.BUZZ_LIVE_SCREENSHOT_DIR?.trim();

type Session = { browser: Browser; context: BrowserContext; page: Page };

/**
 * Relay traffic passes through a WebSocket route so a test can drop the Relay's
 * `OK` for one decision: the decision reaches the Relay, but the browser loses
 * the connection before learning the verdict.
 */
type OkDropper = { armKind: number | null; droppedEventIds: string[] };

async function launch(
  baseURL: string,
  viewport: { width: number; height: number },
  dropper?: OkDropper,
): Promise<Session> {
  const browser = await chromium.launch({ env: browserEnvironment() });
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    viewport,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  if (dropper) {
    const relayHost = new URL(liveRelayUrl()).host;
    await context.routeWebSocket(
      (url) => url.host === relayHost,
      (socket) => {
        const server = socket.connectToServer();
        const pending = new Set<string>();
        socket.onMessage((message) => {
          if (typeof message === "string" && dropper.armKind !== null) {
            const frame: unknown = JSON.parse(message);
            const event: unknown = Array.isArray(frame) && frame[0] === "EVENT" ? frame[1] : null;
            if (
              event &&
              typeof event === "object" &&
              "kind" in event &&
              "id" in event &&
              event.kind === dropper.armKind &&
              typeof event.id === "string"
            ) {
              pending.add(event.id);
              dropper.armKind = null;
            }
          }
          server.send(message);
        });
        server.onMessage((message) => {
          if (typeof message === "string" && pending.size) {
            const frame: unknown = JSON.parse(message);
            if (!Array.isArray(frame)) return socket.send(message);
            if (frame[0] === "OK" && typeof frame[1] === "string" && pending.has(frame[1])) {
              pending.delete(frame[1]);
              dropper.droppedEventIds.push(frame[1]);
              socket.close();
              server.close();
              return;
            }
          }
          socket.send(message);
        });
      },
    );
  }
  return { browser, context, page: await context.newPage() };
}

async function capture(page: Page, name: string) {
  if (!screenshotDir) return;
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: false });
}

async function openWorkflows(page: Page) {
  await page.getByRole("button", { name: "Workflows", exact: true }).first().click();
  await expect(page.getByTestId("workspace-tool-workflows")).toBeVisible();
}

async function selectWorkflow(page: Page, name: string) {
  const item = page.getByTestId("workflow-list-item").filter({ hasText: name });
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

function latestRun(page: Page): Locator {
  return page.getByTestId("workflow-run").first();
}

async function expectRunStatus(run: Locator, status: string, timeout = 45_000) {
  await expect(run.locator("[data-status]").first()).toHaveAttribute("data-status", status, {
    timeout,
  });
}

async function expandRun(run: Locator) {
  const toggle = run.getByRole("button", { name: /^Run [0-9a-f]{8}/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Triggers a run and waits until its durable record is listed first. */
async function triggerRun(page: Page, fields: string) {
  const runs = page.getByTestId("workflow-run");
  const before = await runs.count();
  await page.getByRole("button", { name: "Trigger", exact: true }).first().click();
  const form = page.getByRole("form", { name: "Trigger this workflow" });
  await form.getByLabel("Trigger fields (optional JSON object)").fill(fields);
  await form.getByRole("button", { name: "Trigger", exact: true }).click();
  await expect(form).toHaveCount(0, { timeout: 30_000 });
  await expect(runs).toHaveCount(before + 1, { timeout: 30_000 });
}

function approvalYaml(nonce: string, approverHex: string, timeout: string) {
  return [
    `name: wf-accept-${nonce}`,
    "trigger:",
    "  on: webhook",
    "steps:",
    "  - id: before",
    "    action: send_message",
    `    text: 'wf-${nonce} before approval v{{trigger.version}}'`,
    "  - id: gate",
    "    action: request_approval",
    `    from: '${approverHex}'`,
    `    message: 'Release wf-${nonce}?'`,
    `    timeout: ${timeout}`,
    "  - id: after",
    "    action: send_message",
    `    text: 'wf-${nonce} after approval'`,
    "",
  ].join("\n");
}

async function editYaml(page: Page, yaml: string) {
  const editor = page.getByLabel("Workflow YAML");
  await editor.fill(yaml);
  await expect(page.getByText("Definition is valid for the relay.")).toBeVisible();
  await page.getByRole("button", { name: "Save workflow" }).click();
}

async function channelMessages(relay: NodeRelayClient, channelId: string, text: string) {
  const events = await relay.query([{ kinds: [9], "#h": [channelId], limit: 200 }]);
  return events.filter((event) => event.content === text).length;
}

async function signIn(session: Session, identity: LiveIdentity) {
  await importIdentity(session.page, identity);
}

/** Shared test identities hit the Relay's write quota; back off as it instructs. */
async function publishWithBackoff(
  relay: NodeRelayClient,
  identity: LiveIdentity,
  kind: number,
  tags: string[][],
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await relay.publish(
        { kind, created_at: Math.floor(Date.now() / 1000), content: "", tags },
        identity.secretKey,
      );
    } catch (error) {
      if (attempt >= 8 || !String(error).includes("rate-limited")) throw error;
      await sleep(3_000);
    }
  }
}

test("workflow authoring, approval gating, denial, expiry and recovery against the live Relay", async ({
  baseURL,
}) => {
  test.skip(!baseURL, "BUZZ_LIVE_BASE_URL is required");
  const nonce = randomBytes(4).toString("hex");
  const channelName = `wf-accept-${nonce}`;
  const workflowName = `wf-accept-${nonce}`;
  const ownerSession = await launch(String(baseURL), { width: 1440, height: 900 });
  const dropper: OkDropper = { armKind: null, droppedEventIds: [] };
  const approverSession = await launch(String(baseURL), { width: 1440, height: 900 }, dropper);
  const ownerRelay = await NodeRelayClient.connect(liveRelayUrl(), owner.secretKey);
  const approverRelay = await NodeRelayClient.connect(liveRelayUrl(), approver.secretKey);
  const ownerPage = ownerSession.page;
  const approverPage = approverSession.page;
  const channelId = crypto.randomUUID();
  let workflowId = "";
  let webhookSecret = "";

  try {
    await test.step("owner creates a channel with the approver and authors a workflow", async () => {
      // Channel setup goes through the Relay protocol; the UI under test is the workflow tool.
      await publishWithBackoff(ownerRelay, owner, 9007, [
        ["h", channelId],
        ["name", channelName],
        ["channel_type", "stream"],
        ["visibility", "private"],
      ]);
      await publishWithBackoff(ownerRelay, owner, 9000, [
        ["h", channelId],
        ["p", approver.pubkey],
      ]);
      await signIn(ownerSession, owner);
      await openChannel(ownerPage, channelName);
      await openWorkflows(ownerPage);
      await ownerPage.getByRole("button", { name: "Create Workflow" }).click();
      await ownerPage
        .getByRole("form", { name: "New workflow" })
        .getByLabel("Channel", { exact: true })
        .selectOption({ label: `#${channelName}` });
      // Rejected definitions never reach the Relay: the editor applies the Relay's rules.
      await ownerPage
        .getByLabel("Workflow YAML")
        .fill("name: x\ntrigger:\n  on: cron\nsteps: []\n");
      await expect(
        ownerPage.getByRole("alert").filter({ hasText: "unknown value `cron`" }),
      ).toBeVisible();
      await expect(ownerPage.getByRole("button", { name: "Save workflow" })).toBeDisabled();
      await editYaml(ownerPage, approvalYaml(nonce, approver.pubkey, "1h"));
      await expect(
        ownerPage.getByRole("heading", { name: workflowName, exact: true }),
      ).toBeVisible();
      // The one-time webhook secret is shown only locally to the owner…
      const secretBox = ownerPage.getByTestId("workflow-webhook-secret");
      await expect(secretBox).toBeVisible();
      await ownerPage.getByRole("button", { name: "Reveal webhook secret" }).click();
      webhookSecret = (await secretBox.textContent())?.trim() ?? "";
      expect(webhookSecret.length).toBeGreaterThan(20);
      // …and never appears in the public definition event.
      const definitions = await ownerRelay.query([
        { kinds: [30620], authors: [owner.pubkey], limit: 50 },
      ]);
      const definition = definitions.find((event) => event.content.includes(`wf-accept-${nonce}`));
      expect(definition).toBeTruthy();
      expect(JSON.stringify(definition)).not.toContain(webhookSecret);
      expect(definition?.tags.find((tag) => tag[0] === "h")?.[1]).toBe(channelId);
      workflowId = definition?.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
      await expect(ownerPage.getByTestId("workflow-webhook-url")).toHaveText(
        `${liveRelayUrl().replace(/^ws/, "http")}/hooks/${workflowId}`,
      );
      await ownerPage.getByRole("button", { name: "Continue" }).click();
      await expect(secretBox).toHaveCount(0);
    });

    await test.step("a manual trigger suspends at the approval gate", async () => {
      await triggerRun(ownerPage, '{"version": "7"}');
      const run = latestRun(ownerPage);
      await expectRunStatus(run, "waiting_approval");
      await expandRun(run);
      await expect(run.getByTestId("workflow-run-trace")).toContainText("gate");
      await expect(run.locator('[data-step-status="waiting_approval"]')).toHaveCount(1);
      // The owner is not the designated approver and gets no decision controls.
      await expect(run.getByText(/^Only .+ can decide this approval\.$/)).toBeVisible();
      await expect(run.getByRole("button", { name: "Approve" })).toHaveCount(0);
      expect(await channelMessages(ownerRelay, channelId, `wf-${nonce} before approval v7`)).toBe(
        1,
      );
      await capture(ownerPage, "workflows-owner-waiting-desktop");
    });

    await test.step("a non-approver decision is rejected and does not advance the run", async () => {
      const [request] = await ownerRelay.query([{ kinds: [46010], "#h": [channelId], limit: 5 }]);
      const approvalRef = request?.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
      expect(approvalRef).toMatch(/^[0-9a-f]{64}$/);
      await expect(
        ownerRelay.publish(
          {
            kind: 46030,
            created_at: Math.floor(Date.now() / 1000),
            content: "",
            tags: [["d", approvalRef]],
          },
          owner.secretKey,
        ),
      ).rejects.toThrow(/not the designated approver/);
      await ownerPage.getByRole("button", { name: "Refresh run history" }).click();
      await expectRunStatus(latestRun(ownerPage), "waiting_approval");
    });

    await test.step("the run is recovered from the Relay after a reload", async () => {
      await reloadAndUnlock(ownerPage, owner);
      await openWorkflows(ownerPage);
      await selectWorkflow(ownerPage, workflowName);
      await expectRunStatus(latestRun(ownerPage), "waiting_approval");
    });

    await test.step("the designated approver grants and observes completion", async () => {
      await signIn(approverSession, approver);
      await openWorkflows(approverPage);
      await selectWorkflow(approverPage, workflowName);
      const run = latestRun(approverPage);
      await expandRun(run);
      await expect(run.getByRole("button", { name: "Approve" })).toBeVisible();
      await capture(approverPage, "workflows-approver-pending-desktop");
      await run.getByLabel("Note for the record (optional)").fill("ship it");
      await run.getByRole("button", { name: "Approve" }).click();
      await expectRunStatus(run, "completed");
      await expect(run.getByTestId("workflow-approval-outcome")).toContainText("Approved by");
      await expect(run.getByTestId("workflow-approval-outcome")).toContainText("ship it");
      await expect
        .poll(() => channelMessages(approverRelay, channelId, `wf-${nonce} after approval`))
        .toBe(1);
      await capture(approverPage, "workflows-approver-completed-desktop");
      await expectRunStatus(latestRun(ownerPage), "completed");
    });

    await test.step("the webhook starts a run; a stale view's replayed decision is rejected", async () => {
      const hookUrl = `${liveRelayUrl().replace(/^ws/, "http")}/hooks/${workflowId}`;
      const forged = await fetch(hookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": "not-the-secret" },
        body: '{"version": "8"}',
      });
      expect(forged.status).toBe(401);
      const hook = await fetch(hookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret },
        body: '{"version": "8"}',
      });
      expect(hook.ok).toBe(true);
      await expect
        .poll(() => channelMessages(ownerRelay, channelId, `wf-${nonce} before approval v8`))
        .toBe(1);
      // Hold this tab's view at the pre-decision state, then decide again.
      await approverPage.getByRole("button", { name: "Refresh run history" }).click();
      const run = latestRun(approverPage);
      await expectRunStatus(run, "waiting_approval");
      await expandRun(run);
      await expect(run.getByRole("button", { name: "Approve" })).toBeVisible();
      const runId = await run.getAttribute("data-run-id");
      await approverPage.route("**/workflows/**", (route) => route.abort());
      const request = (
        await approverRelay.query([{ kinds: [46010], "#h": [channelId], limit: 20 }])
      ).find((event) => event.content.includes(`"run_id":"${runId}"`));
      const approvalRef = request?.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
      await approverRelay.publish(
        {
          kind: 46030,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [["d", approvalRef]],
        },
        approver.secretKey,
      );
      await run.getByRole("button", { name: "Approve" }).click();
      await expect(
        run.getByRole("alert").filter({ hasText: "approval already granted" }),
      ).toBeVisible();
      await approverPage.unroute("**/workflows/**");
      await approverPage.getByRole("button", { name: "Refresh run history" }).click();
      await expectRunStatus(run, "completed");
      expect(await channelMessages(approverRelay, channelId, `wf-${nonce} after approval`)).toBe(2);
    });

    await test.step("a denial whose OK is lost is re-read and cancels the run", async () => {
      await triggerRun(ownerPage, '{"version": "9"}');
      await expectRunStatus(latestRun(ownerPage), "waiting_approval");
      await approverPage.getByRole("button", { name: "Refresh run history" }).click();
      const run = latestRun(approverPage);
      await expectRunStatus(run, "waiting_approval");
      await expandRun(run);
      dropper.armKind = 46031;
      await run.getByRole("button", { name: "Deny" }).click();
      await expect.poll(() => dropper.droppedEventIds.length).toBe(1);
      await expectRunStatus(run, "cancelled");
      await expect(run.getByTestId("workflow-run-error")).toContainText("Approval was denied.");
      await expect(run.getByTestId("workflow-approval-outcome")).toContainText("Denied by");
      expect(await channelMessages(approverRelay, channelId, `wf-${nonce} after approval`)).toBe(2);
    });

    await test.step("an approval that is never decided expires and fails the run", async () => {
      await ownerPage.getByRole("button", { name: "Edit" }).click();
      await editYaml(ownerPage, approvalYaml(nonce, approver.pubkey, "4s"));
      await expect(
        ownerPage.getByRole("heading", { name: workflowName, exact: true }),
      ).toBeVisible();
      // The detail view remounted after the edit; let its run history load first.
      await expect(ownerPage.getByTestId("workflow-run")).toHaveCount(3);
      await triggerRun(ownerPage, '{"version": "10"}');
      const run = latestRun(ownerPage);
      await expandRun(run);
      await expectRunStatus(run, "failed", 60_000);
      await expect(run.getByTestId("workflow-run-error")).toContainText("Approval expired");
      await expect(run.getByTestId("workflow-approval-outcome")).toContainText("Expired");
      await capture(ownerPage, "workflows-owner-expired-desktop");
    });

    await test.step("mobile layout shows the run detail", async () => {
      await approverPage.setViewportSize({ width: 390, height: 844 });
      await approverPage.getByRole("button", { name: "Back to workflows" }).click();
      await expect(approverPage.getByTestId("workflow-list-item").first()).toBeVisible();
      await capture(approverPage, "workflows-list-mobile");
      await selectWorkflow(approverPage, workflowName);
      const run = latestRun(approverPage);
      await expandRun(run);
      await expect(run.getByTestId("workflow-run-trace")).toBeVisible();
      await capture(approverPage, "workflows-approver-mobile");
    });

    await test.step("the owner disables and deletes the workflow", async () => {
      await ownerPage.getByRole("button", { name: "Disable workflow" }).click();
      await expect(ownerPage.getByTestId("workflow-enabled-state")).toHaveText("Disabled", {
        timeout: 30_000,
      });
      await ownerPage.getByRole("button", { name: "Delete workflow" }).click();
      await ownerPage.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(
        ownerPage.getByTestId("workflow-list-item").filter({ hasText: workflowName }),
      ).toHaveCount(0, { timeout: 30_000 });
    });
  } finally {
    if (channelId) {
      await openChannel(ownerPage, channelName).catch(() => undefined);
      await archiveChannel(ownerPage, channelName).catch(() => undefined);
    }
    ownerRelay.close();
    approverRelay.close();
    await ownerSession.browser.close();
    await approverSession.browser.close();
  }
});

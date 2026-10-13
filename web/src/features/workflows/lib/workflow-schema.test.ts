import { describe, expect, it } from "vitest";
import { isValidCron, normalizeCron } from "@/features/workflows/lib/cron";
import { parseDurationSecs, validateWorkflowYaml } from "@/features/workflows/lib/workflow-schema";
import parityCases from "@/features/workflows/lib/workflow-schema.parity.json";

type ParityCase = { yaml: string; accepted: boolean; relayError?: string };

/**
 * Ground truth: each case was run through the Relay's own `parse_yaml`
 * (serde_yaml 0.9.34 + `WorkflowDef::validate` + cron 0.16) and its verdict
 * recorded in workflow-schema.parity.json.
 */
describe("workflow YAML parity with the Relay", () => {
  it.each((parityCases as ParityCase[]).map((item, index) => [index, item] as const))(
    "case %i matches the Relay verdict",
    (_index, item) => {
      const result = validateWorkflowYaml(item.yaml);
      expect(
        result.ok,
        result.ok ? `accepted; Relay said: ${item.relayError}` : JSON.stringify(result.error),
      ).toBe(item.accepted);
    },
  );
});

describe("workflow validation errors", () => {
  const steps = "steps:\n  - id: a\n    action: send_message\n    text: hi\n";

  it("reports the first Relay rule the definition breaks", () => {
    expect(validateWorkflowYaml(`name: '  '\ntrigger:\n  on: webhook\n${steps}`)).toMatchObject({
      ok: false,
      error: { code: "name_empty" },
    });
    expect(
      validateWorkflowYaml(
        "name: x\ntrigger:\n  on: webhook\nsteps:\n  - id: my-step\n    action: delay\n    duration: 1s\n",
      ),
    ).toMatchObject({ ok: false, error: { code: "step_id_invalid", params: { id: "my-step" } } });
    expect(
      validateWorkflowYaml(`name: x\ntrigger:\n  on: schedule\n  interval: 30s\n${steps}`),
    ).toMatchObject({ ok: false, error: { code: "interval_too_short" } });
  });

  it("locates type errors at the offending field", () => {
    const result = validateWorkflowYaml(
      "name: x\ntrigger:\n  on: webhook\nsteps:\n  - id: a\n    action: send_message\n    text: 5\n",
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_type", path: "steps[0].text", params: { found: "integer" } },
    });
  });

  it("names the unknown trigger and lists the supported ones", () => {
    const result = validateWorkflowYaml(`name: x\ntrigger:\n  on: cron\n${steps}`);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unknown_variant", params: { value: "cron" } },
    });
  });

  it("reports YAML syntax errors with a line", () => {
    const result = validateWorkflowYaml("name: x\ntrigger: [webhook\nsteps: []\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("yaml_syntax");
      expect(result.error.line).toBeGreaterThan(0);
    }
  });
});

describe("execution warnings for definitions the Relay stores but cannot run", () => {
  const gate = (from: string, timeout: string) =>
    `name: x\ntrigger:\n  on: webhook\nsteps:\n  - id: gate\n    action: request_approval\n    from: '${from}'\n    message: ok\n    timeout: '${timeout}'\n`;

  it("accepts hex, npub and any approvers within the 30 day window", () => {
    for (const from of [
      "any",
      "ANY",
      "a".repeat(64),
      "npub1u9l940mmrk7nv0cw6maa5fz4vztj0vj42s5dagj38zx9gtxj7qls94fpux",
      "{{trigger.author}}",
    ]) {
      const result = validateWorkflowYaml(gate(from, "30m"));
      expect(result.ok && result.warnings).toEqual([]);
    }
  });

  it("flags role mentions, malformed npubs and out-of-range timeouts", () => {
    const codes = (yaml: string) => {
      const result = validateWorkflowYaml(yaml);
      return result.ok ? result.warnings.map((warning) => warning.code) : ["rejected"];
    };
    expect(codes(gate("@release-manager", "1h"))).toEqual(["approver_invalid"]);
    expect(codes(gate("npub1notakey", "1h"))).toEqual(["approver_invalid"]);
    expect(codes(gate("any", "0s"))).toEqual(["approval_timeout_invalid"]);
    expect(codes(gate("any", "721h"))).toEqual(["approval_timeout_invalid"]);
    expect(codes(gate("any", "720h"))).toEqual([]);
  });

  it("flags delays above the executor cap and unimplemented actions", () => {
    const result = validateWorkflowYaml(
      "name: x\ntrigger:\n  on: schedule\n  interval: 1h\nsteps:\n  - id: wait\n    action: delay\n    duration: 5m\n  - id: dm\n    action: send_dm\n    to: x\n    text: y\n  - id: react\n    action: add_reaction\n    emoji: eyes\n",
    );
    expect(result.ok && result.warnings.map((warning) => warning.code)).toEqual([
      "delay_too_long",
      "action_not_implemented",
      "reaction_needs_message",
    ]);
  });
});

describe("schedule helpers", () => {
  it("normalizes 5 and 6 field cron expressions like the Relay", () => {
    expect(normalizeCron("*/5 * * * *")).toBe("0 */5 * * * * *");
    expect(normalizeCron("0 */5 * * * *")).toBe("0 */5 * * * * *");
    expect(isValidCron("0 9 * * MON-FRI")).toBe(true);
    expect(isValidCron("0 9 * * MON-XYZ")).toBe(false);
  });

  it("parses durations with the Relay's suffix rules and u64 bounds", () => {
    expect(parseDurationSecs(" 2 h ")).toBe(7200n);
    expect(parseDurationSecs("90")).toBe(90n);
    expect(parseDurationSecs("1d")).toBeNull();
    expect(parseDurationSecs("-1m")).toBeNull();
    expect(parseDurationSecs("5124095576030432h")).toBeNull();
  });
});

import type {
  ChannelAddPolicy,
  ManagedAgentStatus,
  ManagedRespondTo,
} from "@/features/agents/lib/agent-control-client";
import { t } from "@/shared/i18n";

export const RESPOND_TO_OPTIONS: readonly ManagedRespondTo[] = [
  "owner-only",
  "allowlist",
  "anyone",
  "nobody",
];
export const ADD_POLICY_OPTIONS: readonly ChannelAddPolicy[] = ["owner_only", "anyone", "nobody"];

export function respondToLabel(mode: ManagedRespondTo | null): string {
  if (mode === "anyone") return t("agents.respondAnyone");
  if (mode === "allowlist") return t("agents.respondAllowlist");
  if (mode === "owner-only") return t("agents.respondOwner");
  if (mode === "nobody") return t("agents.respondNobody");
  return t("agents.respondDefault");
}

export function addPolicyLabel(policy: ChannelAddPolicy | null): string {
  if (policy === "anyone") return t("agents.addPolicyAnyone");
  if (policy === "nobody") return t("agents.addPolicyNobody");
  if (policy === "owner_only") return t("agents.addPolicyOwner");
  return t("agents.addPolicyUnknown");
}

export function processStatusLabel(status: ManagedAgentStatus): string {
  if (status === "running") return t("agents.processRunning");
  if (status === "starting") return t("agents.processStarting");
  if (status === "error") return t("agents.processError");
  return t("agents.processStopped");
}

export function presenceLabel(status: "online" | "away" | "offline"): string {
  if (status === "online") return t("agents.online");
  if (status === "away") return t("agents.away");
  return t("agents.offline");
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export const fieldClass =
  "mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
export const labelClass = "block text-xs font-medium text-muted-foreground";
export const secondaryButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
export const primaryButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
export const dangerButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/8 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive disabled:pointer-events-none disabled:opacity-50";

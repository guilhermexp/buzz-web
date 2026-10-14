import { AgentControlError } from "@/features/remote/lib/agent-control-request";
import { type MessageKey, t } from "@/shared/i18n";

const MESSAGE_BY_CODE: Record<string, MessageKey> = {
  forbidden: "remote.error.forbidden",
  revoked: "remote.error.revoked",
  path_escape: "remote.error.pathEscape",
  not_found: "remote.error.notFound",
  quota_exceeded: "remote.error.quota",
  conflict: "remote.error.conflict",
  payload_too_large: "remote.error.tooLarge",
  workspace_root: "remote.error.workspaceRoot",
  not_a_file: "remote.error.notAFile",
  not_a_directory: "remote.error.notADirectory",
  mcp_unavailable: "remote.error.mcpUnavailable",
  mcp_timeout: "remote.error.mcpTimeout",
  cancelled: "remote.error.cancelled",
  network_error: "remote.error.network",
};

/** User-facing text for an Agent Control failure; unknown codes keep the service's message. */
export function remoteErrorMessage(error: unknown): string {
  if (error instanceof AgentControlError) {
    const key = MESSAGE_BY_CODE[error.code];
    return key ? t(key) : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function remoteErrorCode(error: unknown): string | null {
  return error instanceof AgentControlError ? error.code : null;
}

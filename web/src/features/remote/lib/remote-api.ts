import {
  type AgentControlTarget,
  agentControlFetch,
  agentControlJson,
  agentControlUrl,
} from "@/features/remote/lib/agent-control-request";
import { isRecord } from "@/features/remote/lib/json-guards";

export type RemoteCapability = "agents" | "terminal" | "files" | "mcp";

export type RemoteGrant = {
  capabilities: RemoteCapability[];
  workspaces: string[];
  maxWorkspaces: number;
  maxAgents: number;
};

export type RemoteWorkspace = {
  id: string;
  name: string;
  status: "running" | "stopped" | "missing";
  createdAt: number;
};

export type RemoteFileEntry = {
  name: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpContentBlock = { type: string; text?: string; [key: string]: unknown };

export type McpCallResult = {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
};

const CAPABILITIES: Record<RemoteCapability, true> = {
  agents: true,
  terminal: true,
  files: true,
  mcp: true,
};

function isCapability(value: unknown): value is RemoteCapability {
  return typeof value === "string" && value in CAPABILITIES;
}

function parseGrant(value: unknown): RemoteGrant {
  const grant: Record<string, unknown> =
    isRecord(value) && isRecord(value.grant) ? value.grant : {};
  const capabilities = Array.isArray(grant.capabilities)
    ? grant.capabilities.filter(isCapability)
    : [];
  return {
    capabilities,
    workspaces: Array.isArray(grant.workspaces)
      ? grant.workspaces.filter((item): item is string => typeof item === "string")
      : [],
    maxWorkspaces: typeof grant.maxWorkspaces === "number" ? grant.maxWorkspaces : 0,
    maxAgents: typeof grant.maxAgents === "number" ? grant.maxAgents : 0,
  };
}

function parseWorkspace(value: unknown): RemoteWorkspace | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const status =
    value.status === "running" || value.status === "stopped" ? value.status : "missing";
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    status,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
  };
}

function parseEntry(value: unknown): RemoteFileEntry | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const type =
    value.type === "directory" || value.type === "file" || value.type === "symlink"
      ? value.type
      : "other";
  return {
    name: value.name,
    type,
    size: typeof value.size === "number" ? value.size : 0,
    modifiedAt: typeof value.modifiedAt === "number" ? value.modifiedAt : 0,
  };
}

function parseTool(value: unknown): McpTool | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return {
    name: value.name,
    description: typeof value.description === "string" ? value.description : undefined,
    inputSchema: isRecord(value.inputSchema) ? value.inputSchema : undefined,
  };
}

function parseCallResult(value: unknown): McpCallResult {
  const result: Record<string, unknown> =
    isRecord(value) && isRecord(value.result) ? value.result : {};
  return {
    content: Array.isArray(result.content)
      ? result.content.filter(
          (block): block is McpContentBlock => isRecord(block) && typeof block.type === "string",
        )
      : undefined,
    structuredContent: result.structuredContent,
    isError: result.isError === true,
  };
}

const workspacePath = (id: string, suffix = "") =>
  `/v1/workspaces/${encodeURIComponent(id)}${suffix}`;

export async function fetchGrant(target: AgentControlTarget): Promise<RemoteGrant> {
  return parseGrant(await agentControlJson<unknown>(target, "GET", "/v1/grant"));
}

export async function listWorkspaces(target: AgentControlTarget): Promise<RemoteWorkspace[]> {
  const value = await agentControlJson<unknown>(target, "GET", "/v1/workspaces");
  const items = isRecord(value) && Array.isArray(value.workspaces) ? value.workspaces : [];
  return items.map(parseWorkspace).filter((item): item is RemoteWorkspace => item !== null);
}

export async function createWorkspace(
  target: AgentControlTarget,
  input: { id: string; name: string },
): Promise<void> {
  await agentControlFetch(target, "POST", "/v1/workspaces", { json: input });
}

export async function deleteWorkspace(target: AgentControlTarget, id: string): Promise<void> {
  await agentControlFetch(target, "DELETE", workspacePath(id));
}

export async function issueTerminalTicket(target: AgentControlTarget, id: string): Promise<string> {
  const value = await agentControlJson<unknown>(
    target,
    "POST",
    workspacePath(id, "/terminal-tickets"),
  );
  if (!isRecord(value) || typeof value.ticket !== "string") throw new Error("invalid ticket");
  return value.ticket;
}

/** WebSocket URL for a ticket; the ticket (not NIP-98) authorizes the upgrade. */
export function terminalSocketUrl(
  target: AgentControlTarget,
  id: string,
  query: { ticket: string; session?: string; cols: number; rows: number },
): string {
  const url = new URL(
    agentControlUrl(target, workspacePath(id, "/terminal"), {
      ticket: query.ticket,
      cols: String(query.cols),
      rows: String(query.rows),
      ...(query.session ? { session: query.session } : {}),
    }),
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.delete("relay");
  return url.toString();
}

export async function listFiles(
  target: AgentControlTarget,
  id: string,
  path: string,
): Promise<RemoteFileEntry[]> {
  const value = await agentControlJson<unknown>(target, "GET", workspacePath(id, "/files"), {
    query: { path },
  });
  const items = isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
  return items.map(parseEntry).filter((item): item is RemoteFileEntry => item !== null);
}

export async function readFile(
  target: AgentControlTarget,
  id: string,
  path: string,
): Promise<Blob> {
  const response = await agentControlFetch(target, "GET", workspacePath(id, "/file"), {
    query: { path },
  });
  return response.blob();
}

export async function writeFile(
  target: AgentControlTarget,
  id: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await agentControlFetch(target, "PUT", workspacePath(id, "/file"), { query: { path }, bytes });
}

export async function deleteFile(
  target: AgentControlTarget,
  id: string,
  path: string,
): Promise<void> {
  await agentControlFetch(target, "DELETE", workspacePath(id, "/file"), { query: { path } });
}

export async function listMcpTools(target: AgentControlTarget, id: string): Promise<McpTool[]> {
  const value = await agentControlJson<unknown>(target, "GET", workspacePath(id, "/mcp/tools"));
  const items = isRecord(value) && Array.isArray(value.tools) ? value.tools : [];
  return items.map(parseTool).filter((item): item is McpTool => item !== null);
}

export async function callMcpTool(
  target: AgentControlTarget,
  id: string,
  input: { callId: string; name: string; arguments: Record<string, unknown> },
): Promise<McpCallResult> {
  return parseCallResult(
    await agentControlJson<unknown>(target, "POST", workspacePath(id, "/mcp/calls"), {
      json: input,
    }),
  );
}

export async function cancelMcpCall(
  target: AgentControlTarget,
  id: string,
  callId: string,
): Promise<void> {
  await agentControlFetch(
    target,
    "POST",
    workspacePath(id, `/mcp/calls/${encodeURIComponent(callId)}/cancel`),
  );
}

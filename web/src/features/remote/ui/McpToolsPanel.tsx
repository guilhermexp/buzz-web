import { useQuery } from "@tanstack/react-query";
import { Play, RefreshCw, Square, Wrench } from "lucide-react";
import { type FormEvent, useMemo, useRef, useState } from "react";
import type { AgentControlTarget } from "@/features/remote/lib/agent-control-request";
import {
  buildMcpArguments,
  type McpArgumentsResult,
  type McpField,
  mcpFields,
} from "@/features/remote/lib/mcp-arguments";
import {
  callMcpTool,
  cancelMcpCall,
  listMcpTools,
  type McpCallResult,
  type McpTool,
} from "@/features/remote/lib/remote-api";
import { remoteErrorCode, remoteErrorMessage } from "@/features/remote/lib/remote-errors";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

type Outcome =
  | { kind: "result"; result: McpCallResult }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

function invalidMessage(result: Extract<McpArgumentsResult, { ok: false }>): string {
  if (result.problem === "required")
    return t("remote.tools.invalid.required", { field: result.field });
  if (result.problem === "number") return t("remote.tools.invalid.number", { field: result.field });
  if (result.problem === "integer")
    return t("remote.tools.invalid.integer", { field: result.field });
  return t("remote.tools.invalid.json", { field: result.field });
}

function resultText(result: McpCallResult): string {
  const text = (result.content ?? [])
    .map((block) => (typeof block.text === "string" ? block.text : JSON.stringify(block)))
    .join("\n");
  if (text) return text;
  return result.structuredContent === undefined
    ? ""
    : JSON.stringify(result.structuredContent, null, 2);
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: McpField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  const id = `remote-mcp-field-${field.name}`;
  const label = (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-xs font-medium">{field.name}</span>
      {field.required ? (
        <span className="text-[10px] text-muted-foreground">{t("remote.tools.required")}</span>
      ) : null}
    </span>
  );
  const control =
    "w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";
  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2" htmlFor={id}>
        <input
          checked={value === true}
          id={id}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }
  return (
    <label className="block space-y-1" htmlFor={id}>
      {label}
      {field.kind === "enum" ? (
        <select
          className={`${control} h-8`}
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" />
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "json" || field.name === "command" ? (
        <textarea
          className={`${control} min-h-20 py-1.5 font-mono text-xs`}
          id={id}
          placeholder={field.kind === "json" ? t("remote.tools.jsonHint") : undefined}
          spellCheck={false}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={`${control} h-8 ${field.kind === "string" ? "" : "tabular-nums"}`}
          id={id}
          inputMode={field.kind === "string" ? undefined : "decimal"}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description ? (
        <span className="block text-[11px] leading-4 text-muted-foreground">
          {field.description}
        </span>
      ) : null}
    </label>
  );
}

function ToolForm({
  target,
  workspaceId,
  tool,
}: {
  target: AgentControlTarget;
  workspaceId: string;
  tool: McpTool;
}) {
  const fields = useMemo(() => mcpFields(tool.inputSchema), [tool.inputSchema]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [invalid, setInvalid] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const cancelled = useRef(new Set<string>());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildMcpArguments(fields, values);
    if (!built.ok) {
      setInvalid(invalidMessage(built));
      return;
    }
    setInvalid(null);
    setOutcome(null);
    const callId = crypto.randomUUID();
    setRunning(callId);
    try {
      const result = await callMcpTool(target, workspaceId, {
        callId,
        name: tool.name,
        arguments: built.arguments,
      });
      setOutcome({ kind: "result", result });
    } catch (error) {
      setOutcome(
        remoteErrorCode(error) === "cancelled" || cancelled.current.has(callId)
          ? { kind: "cancelled" }
          : { kind: "error", message: remoteErrorMessage(error) },
      );
    } finally {
      setRunning(null);
    }
  };

  const cancel = async () => {
    if (!running) return;
    cancelled.current.add(running);
    try {
      await cancelMcpCall(target, workspaceId, running);
    } catch (error) {
      setOutcome({ kind: "error", message: remoteErrorMessage(error) });
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <h3 className="font-mono text-sm font-semibold">{tool.name}</h3>
        {tool.description ? (
          <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground">
            {tool.description}
          </p>
        ) : null}
      </div>
      {fields.length ? (
        <fieldset className="space-y-3" disabled={running !== null}>
          {fields.map((field) => (
            <FieldInput
              field={field}
              key={field.name}
              value={values[field.name]}
              onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
            />
          ))}
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">{t("remote.tools.noArguments")}</p>
      )}
      {invalid ? (
        <p className="text-xs text-destructive" role="alert">
          {invalid}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={running !== null} size="sm" type="submit">
          <Play />
          {running ? t("remote.tools.running") : t("remote.tools.run")}
        </Button>
        {running ? (
          <Button size="sm" type="button" variant="outline" onClick={() => void cancel()}>
            <Square />
            {t("remote.tools.cancel")}
          </Button>
        ) : null}
      </div>
      {outcome ? (
        <div aria-live="polite" className="space-y-2" data-testid="remote-mcp-outcome">
          {outcome.kind === "cancelled" ? (
            <p className="text-sm text-muted-foreground">{t("remote.tools.cancelled")}</p>
          ) : outcome.kind === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {outcome.message}
            </p>
          ) : (
            <>
              <h4
                className={`text-xs font-semibold ${outcome.result.isError ? "text-destructive" : ""}`}
              >
                {outcome.result.isError ? t("remote.tools.toolError") : t("remote.tools.result")}
              </h4>
              <pre className="buzz-scrollbar max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5">
                {resultText(outcome.result) || t("remote.tools.noOutput")}
              </pre>
            </>
          )}
        </div>
      ) : null}
    </form>
  );
}

export function McpToolsPanel({
  target,
  workspaceId,
  workspaceName,
  queryKey,
}: {
  target: AgentControlTarget;
  workspaceId: string;
  workspaceName: string;
  queryKey: readonly unknown[];
}) {
  const tools = useQuery({
    queryKey: [...queryKey, "mcp-tools"],
    queryFn: () => listMcpTools(target, workspaceId),
    retry: false,
  });
  // Underscore-prefixed tools are buzz-dev-mcp's internal agent lifecycle hooks.
  const visible = (tools.data ?? []).filter((tool) => !tool.name.startsWith("_"));
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = visible.find((tool) => tool.name === selectedName) ?? null;

  return (
    <section
      aria-label={t("remote.tools.label", { name: workspaceName })}
      className="flex min-h-0 flex-1 flex-col md:flex-row"
    >
      <div className="flex shrink-0 flex-col border-b md:w-56 md:border-b-0 md:border-r">
        <div className="flex h-11 items-center gap-2 border-b px-3">
          <h3 className="flex-1 text-xs font-semibold">{t("remote.tools.list")}</h3>
          <button
            aria-label={t("remote.retry")}
            className="buzz-icon-button h-7 w-7"
            title={t("remote.retry")}
            type="button"
            onClick={() => void tools.refetch()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${tools.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
        {tools.isPending ? (
          <p className="p-3 text-xs text-muted-foreground">{t("remote.files.loading")}</p>
        ) : tools.isError ? (
          <p className="p-3 text-xs text-destructive" role="alert">
            {remoteErrorMessage(tools.error)}
          </p>
        ) : visible.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("remote.tools.empty")}</p>
        ) : (
          <ul className="buzz-scrollbar flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-y-auto">
            {visible.map((tool) => (
              <li key={tool.name}>
                <button
                  aria-pressed={tool.name === selectedName}
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent aria-pressed:bg-accent aria-pressed:font-semibold"
                  type="button"
                  onClick={() => setSelectedName(tool.name)}
                >
                  <Wrench aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  {tool.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="buzz-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {selected ? (
          <ToolForm key={selected.name} target={target} tool={selected} workspaceId={workspaceId} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("remote.tools.select")}</p>
        )}
      </div>
    </section>
  );
}

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentControlTarget } from "@/features/remote/lib/agent-control-request";
import { issueTerminalTicket, terminalSocketUrl } from "@/features/remote/lib/remote-api";
import { remoteErrorMessage } from "@/features/remote/lib/remote-errors";
import { TerminalConnection, type TerminalState } from "@/features/remote/lib/terminal-connection";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

function statusText(state: TerminalState): string {
  if (state.phase === "connecting") return t("remote.terminal.connecting");
  if (state.phase === "open") return t("remote.terminal.connected");
  if (state.phase === "reconnecting") {
    return t("remote.terminal.reconnecting", { attempt: state.attempt });
  }
  if (state.phase === "exited") {
    if (state.reason === "revoked") return t("remote.terminal.revoked");
    if (state.reason === "expired") return t("remote.terminal.expired");
    if (state.reason === "detached") return t("remote.terminal.detached");
    if (state.code !== null) return t("remote.terminal.exited", { code: state.code });
    return t("remote.terminal.ended");
  }
  const message =
    state.error instanceof Error && state.error.message === "session_lost"
      ? t("remote.terminal.lost")
      : remoteErrorMessage(state.error);
  return t("remote.terminal.failed", { message });
}

const TERMINAL_THEME = {
  background: "#161616",
  foreground: "#e8e8e8",
  cursor: "#e8e8e8",
  selectionBackground: "#3a5f8f",
};

/** Interactive PTY in the workspace container; stays mounted while other tabs are shown. */
export function TerminalPanel({
  target,
  workspaceId,
  workspaceName,
  active,
}: {
  target: AgentControlTarget;
  workspaceId: string;
  workspaceName: string;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const connectionRef = useRef<TerminalConnection | null>(null);
  const [state, setState] = useState<TerminalState>({ phase: "connecting" });
  const [generation, setGeneration] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (active) setStarted(true);
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` intentionally restarts the session.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !started) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    const connection = new TerminalConnection({
      issueTicket: () => issueTerminalTicket(target, workspaceId),
      socketUrl: (ticket, sessionId, size) =>
        terminalSocketUrl(target, workspaceId, {
          ticket,
          session: sessionId ?? undefined,
          ...size,
        }),
      size: () => ({ cols: terminal.cols, rows: terminal.rows }),
      onOutput: (data) => terminal.write(data),
      onState: setState,
    });
    connectionRef.current = connection;
    const input = terminal.onData((data) => connection.send(data));
    const resized = terminal.onResize(({ cols, rows }) => connection.resize(cols, rows));
    const observer = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    });
    observer.observe(host);
    connection.start();
    terminal.focus();
    return () => {
      observer.disconnect();
      input.dispose();
      resized.dispose();
      connection.close();
      terminal.dispose();
      connectionRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [generation, started, target, workspaceId]);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    terminalRef.current?.focus();
  }, [active]);

  const endSession = useCallback(() => connectionRef.current?.close(), []);
  const ended = state.phase === "exited" || state.phase === "failed";

  useEffect(() => {
    if (state.phase === "exited" && terminalRef.current)
      terminalRef.current.options.disableStdin = true;
  }, [state]);

  return (
    <section
      aria-label={t("remote.terminal.label", { name: workspaceName })}
      className="flex min-h-0 flex-1 flex-col"
      hidden={!active}
    >
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <p
          aria-live="polite"
          className={`min-w-0 flex-1 truncate text-xs ${
            state.phase === "open"
              ? "text-[hsl(var(--buzz-positive))]"
              : state.phase === "failed" || (state.phase === "exited" && state.reason === "revoked")
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
          data-testid="remote-terminal-status"
        >
          {statusText(state)}
        </p>
        {ended ? (
          <Button size="sm" variant="outline" onClick={() => setGeneration((value) => value + 1)}>
            <Plus />
            {t("remote.terminal.newSession")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={endSession}>
            <Square />
            {t("remote.terminal.endSession")}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-[#161616] p-2">
        <div className="h-full w-full" data-testid="remote-terminal" ref={hostRef} />
      </div>
    </section>
  );
}

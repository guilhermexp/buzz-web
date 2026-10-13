# Spec Delta

## Purpose
Expose useful real remote workspace tools to authorized browser users without granting arbitrary access to the operator's host or unrelated projects.

## ADDED Requirements

### Requirement: Real scoped terminal
The application SHALL provide an actual remote PTY in an explicitly authorized workspace with interactive input/output, resize, cancellation, bounded lifetime and reconnect behavior. It SHALL NOT execute commands on the browser user's machine or expose an unrestricted host-global command proxy.

#### Scenario: Interactive command and cleanup
- **WHEN** an authorized user opens a terminal, runs a command, resizes and closes the session
- **THEN** real workspace output and effects are observable and session-owned processes are cleaned up according to the lifecycle contract

### Requirement: Workspace filesystem boundary
Authorized file browsing/editing and uploads/downloads SHALL resolve within the selected remote workspace, reject path/symlink escapes and enforce current session authority.

#### Scenario: File modification and escape attempt
- **WHEN** a user edits an allowed workspace file and attempts access outside that workspace
- **THEN** the allowed edit persists and the escape is rejected without exposing or modifying host data

### Requirement: Authorized MCP tool operation
Supported MCP tools SHALL execute against the authorized remote workspace with real results, cancellation/error reporting and permission checks consistent with the runtime. Connection to a tool server SHALL NOT itself authorize unrelated host or channel access.

#### Scenario: Tool result and rejected invocation
- **WHEN** an authorized local-workspace tool executes and an unauthorized client attempts the same operation
- **THEN** the authorized result corresponds to real workspace state and the unauthorized request produces no effect

### Requirement: Revocation and secret-safe transport
Remote sessions SHALL bind owner, community and workspace authority, resist replay and stop access after revocation. Runtime secrets and another user's sessions SHALL NOT appear in public configuration, terminal reconnection data or diagnostics.

#### Scenario: Revoked remote session
- **WHEN** a user's workspace authority is revoked during an active session
- **THEN** further terminal/file/tool operations are denied and access to unrelated retained output is not granted

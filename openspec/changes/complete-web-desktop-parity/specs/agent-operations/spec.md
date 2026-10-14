# Spec Delta

## Purpose
Let authorized owners observe and operate real remote agents from the browser without confusing public profiles with runtime secrets.

## ADDED Requirements

### Requirement: Live and historical observability
The application SHALL distinguish ephemeral live activity from durable authorized session/history/log sources and expose useful activity and session navigation without leaking another owner's or channel's data.

#### Scenario: Observe a real remote turn
- **WHEN** a configured remote agent performs a real local task and finishes
- **THEN** its live activity and declared durable history/session result are visible to its authorized owner, including after reconnect where persistence is promised

### Requirement: Owner-private usage and memory
The browser SHALL expose compatible owner-authorized usage/cost metrics and agent memory through existing private/encrypted contracts, without turning those records into public agent profile content.

#### Scenario: Private metrics and memory
- **WHEN** an owner and an unrelated member request the same agent records
- **THEN** the owner can obtain the intended readable records while the unrelated member cannot discover or decrypt them

### Requirement: Real remote lifecycle and configuration
Authorized owners SHALL create/register, configure, start, stop, restart and remove supported remote agents through bounded operations with observable process/session outcomes. Provider credentials and agent private keys SHALL NOT be returned in public configuration, logs or browser snapshots.

#### Scenario: Lifecycle control
- **WHEN** an owner launches, stops and restarts a configured agent
- **THEN** actual remote process state, connection and cleanup match the requested transitions rather than only changing a UI badge

#### Scenario: Denied control
- **WHEN** a different owner or replayed request attempts lifecycle/configuration control
- **THEN** the operation is rejected without modifying the process or revealing secrets

### Requirement: Personas and persisted teams
Users SHALL browse, create, edit, import/export and apply authorized personas and persisted teams using compatible private/shared catalog semantics. Channel-derived group display SHALL NOT substitute for team management.

#### Scenario: Apply a shared catalog item
- **WHEN** an owner imports a shared persona/team and configures a runtime from it
- **THEN** the definitions and resulting runtime configuration are usable, private entries stay private and shared projections exclude secrets

### Requirement: Channel access and response policy
Agent channel membership and response policies SHALL use real authorized contracts and remain consistent with the Relay's membership authority.

#### Scenario: Remove channel access
- **WHEN** an authorized owner removes agent access to a private channel
- **THEN** subsequent observation and execution cannot continue to disclose or act on that channel through stale cached authority

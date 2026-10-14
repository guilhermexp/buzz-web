# Spec Delta

## Purpose
Make browser workflow authoring and approval controls correspond to durable, authorized execution instead of fixture-only or failed approval gates.

## ADDED Requirements

### Requirement: Workflow definitions and triggers
Users SHALL list, create, edit, validate and trigger authorized workflows, including supported message/reaction, schedule and webhook triggers, without exposing webhook secrets in public data.

#### Scenario: Trigger a valid workflow
- **WHEN** an authorized user saves and triggers a valid workflow
- **THEN** the persisted definition executes and a real run with attributable trigger and step results appears

### Requirement: Durable run and step inspection
The client SHALL show actual run status, current step, trace, errors and relevant approvals from the supported Relay contracts and recover those records after reconnect or reload.

#### Scenario: Observe failed and completed runs
- **WHEN** a workflow step completes or fails
- **THEN** the displayed run/trace and error information agree with the durable backend state

### Requirement: Persisted approval suspension and resume
Approval-gated workflows SHALL persist an accessible pending approval and suspended run, accept a valid authorized decision and resume or terminate execution exactly according to that decision, including after backend restart.

#### Scenario: Approve and resume after restart
- **WHEN** a run reaches an approval gate, the backend restarts and the authorized reviewer approves
- **THEN** the durable pending approval is recovered and remaining steps execute once to the intended terminal outcome

#### Scenario: Deny or reject unauthorized approval
- **WHEN** the authorized reviewer denies, or an unauthorized/replayed decision is submitted
- **THEN** denial prevents continuation and invalid decisions do not advance or duplicate execution

### Requirement: Visible delivery uncertainty
The UI SHALL distinguish a submitted decision from observed execution progress and recover safely from uncertain delivery without fabricating success.

#### Scenario: Connection loss after decision submission
- **WHEN** the connection is interrupted after a decision request
- **THEN** the client reads the actual approval/run state before claiming resumed execution or retrying a non-idempotent action

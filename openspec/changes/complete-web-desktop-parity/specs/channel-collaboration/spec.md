# Spec Delta

## Purpose
Complete channel collaboration and personal productivity in the web client using compatible persistent Relay contracts.

## ADDED Requirements

### Requirement: Versioned channel documents
Members SHALL read, edit and restore channel documents with history, authorization and compare-and-swap conflict protection compatible with Buzz Desktop.

#### Scenario: Concurrent document updates
- **WHEN** two authorized clients edit the same loaded revision
- **THEN** the first accepted update becomes the head, the stale update is rejected and both revisions remain available in history

#### Scenario: Unauthorized document access
- **WHEN** a non-member requests or modifies a private channel document
- **THEN** no document content is disclosed or changed

### Requirement: Complete forums
The web client SHALL support forum topic creation, replies, metadata, sorting, moderation and unread behavior using the Relay's advertised capability and membership rules.

#### Scenario: Forum topic lifecycle
- **WHEN** an authorized member creates a topic and another client replies
- **THEN** topic details and replies converge in web and desktop and moderator actions respect roles

### Requirement: Persistent Inbox productivity and reminders
Inbox SHALL provide useful grouping, source navigation, drafts and reminder actions with reload and cross-device behavior matching the declared persistence contract. Reminder contents SHALL remain author-private.

#### Scenario: Reminder across clients
- **WHEN** an author creates a reminder and reloads or uses another authorized client
- **THEN** the same reminder and target can be recovered while another member cannot read its private data

### Requirement: Pulse feed
The web client SHALL provide the desktop-compatible Pulse feed with authorized reads, publication, interaction and navigation distinct from Inbox items.

#### Scenario: Feed publication
- **WHEN** an authorized user publishes supported Pulse content
- **THEN** another authorized client receives it through the actual Relay and navigation returns to the correct source

### Requirement: Authorized portable exports
Users SHALL export their authorized conversation/document/history data and supported agent/team snapshots in usable portable formats. Content export SHALL remain distinct from private identity backup and SHALL enforce channel and owner privacy.

#### Scenario: Export and import supported data
- **WHEN** a user exports and imports a supported snapshot or opens a content archive
- **THEN** the intended data is usable without unrelated channel data, provider secrets or another identity's private material

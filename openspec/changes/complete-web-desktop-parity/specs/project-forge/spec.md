# Spec Delta

## Purpose
Provide useful Buzz project and repository workflows in the browser with real work items, review and authenticated Git outcomes.

## ADDED Requirements

### Requirement: Project and repository collections
The client SHALL discover, publish/import and manage authorized project/repository collections with nested trees, refs, commits, files, clone URLs and correct project-channel navigation.

#### Scenario: Publish and browse a collection
- **WHEN** an authorized maintainer publishes a project containing repositories
- **THEN** another authorized client can browse the real collection and repository content without losing existing Git remotes

### Requirement: Issues and pull requests
Users SHALL read and author supported issues and pull requests using compatible event semantics, real counts, changes/status transitions and permission-aware controls.

#### Scenario: Work item round trip
- **WHEN** web creates an issue or pull request and another client updates it
- **THEN** both clients display the same work item and current authorized state after reload

### Requirement: Reviews and diffs
The client SHALL show actual diffs and allow authorized review/comment/approval interactions linked to the intended pull request and revision.

#### Scenario: Review the intended revision
- **WHEN** a reviewer opens and comments on a pull request revision
- **THEN** the displayed diff and persisted review identify that revision and are visible to authorized peers

### Requirement: Actual Git writes and merge
Authorized maintainers SHALL perform supported Git publication and merge operations through authenticated transport with existing branch protections. Publishing a status event SHALL NOT be presented as proof of a Git merge.

#### Scenario: Protected branch merge
- **WHEN** an authorized maintainer merges an approved pull request
- **THEN** the intended repository ref and commit graph change and protected-branch authorization is enforced

#### Scenario: Rejected Git write
- **WHEN** an unauthorized writer attempts a protected ref update
- **THEN** the ref remains unchanged and the UI reports the rejection without a merged state

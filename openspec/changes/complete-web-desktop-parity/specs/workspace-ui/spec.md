# Spec Delta

## Purpose
Provide a desktop-aligned Buzz workspace in modern browsers without sacrificing mobile usability or community isolation.

## ADDED Requirements

### Requirement: Aligned workspace surfaces
The application SHALL align its shell, typography, density, sidebar organization, channel entry actions, search, Inbox, settings and navigation with the pinned Buzz Desktop reference while preserving browser accessibility and responsive mobile behavior.

#### Scenario: Operate at desktop and phone widths
- **WHEN** a user navigates chat, Inbox, search, agent and project views at desktop and phone widths
- **THEN** controls remain usable without clipping, lost focus or unavailable navigation

### Requirement: Full browser composer
The composer SHALL support rich formatting, mentions, emoji/custom emoji, supported GIF/media insertion and clipboard attachments while preserving scoped drafts, keyboard/IME behavior and desktop-compatible message serialization.

#### Scenario: Formatted message interoperability
- **WHEN** web sends formatted text, mentions and supported attachments and desktop replies
- **THEN** both clients render the intended content and associate replies with the correct conversation

#### Scenario: Reload unsent content
- **WHEN** a user reloads an unsent draft or switches to a different conversation
- **THEN** the original draft is restored only in its own Relay, identity and conversation scope

### Requirement: Sidebar and thread interaction parity
The application SHALL provide useful channel sections, reordering, context actions, unread/favorite/mute controls and thread focus/split modes through real existing preference and authorization contracts.

#### Scenario: Thread and organization persist correctly
- **WHEN** a user changes supported organization and thread preferences and reloads
- **THEN** the choices persist without corrupting shared read state or losing a thread draft

### Requirement: Independent readability preferences
Users SHALL control font size and conversation density independently of browser zoom, and the application SHALL restore these preferences across reloads.

#### Scenario: Readability adjustment
- **WHEN** font size or density changes at desktop and mobile widths
- **THEN** text and spacing reflect the selected preference without changing conversation content

### Requirement: Multiple isolated communities
The application SHALL support saved community selection and reconnect behavior with Relay/identity-scoped caches, drafts, subscriptions, profiles and read state.

#### Scenario: Switch between communities
- **WHEN** a user switches between two communities using the same identity
- **THEN** only the selected community's authorized state and traffic appear, and returning restores its scoped state

### Requirement: Honest localized capability controls
All user-facing additions SHALL support the existing English and Simplified Chinese locales, keyboard navigation and visible failures. A displayed action SHALL have a working authorized operation rather than a no-op or fixture-only success.

#### Scenario: Unavailable or denied operation
- **WHEN** a capability is unsupported or an operation is rejected
- **THEN** the UI states the limitation or error and does not retain success-looking state

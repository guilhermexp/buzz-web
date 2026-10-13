# Spec Delta

## Purpose
Deliver opt-in browser background notifications with correct destination navigation and explicit permission/platform limits.

## ADDED Requirements

### Requirement: Explicit notification enrollment
The application SHALL offer opt-in browser push enrollment and revocation with permission-aware UI, private subscription storage and no automatic subscription on unrelated navigation.

#### Scenario: Denied or revoked permission
- **WHEN** notification permission is denied or a user revokes enrollment
- **THEN** the application shows the correct state and does not claim background delivery or continue using a revoked subscription

### Requirement: Actual background push
Supported browser deployments SHALL deliver authorized notifications through a real push subscription and service worker while the application tab is closed, respecting community membership and notification preferences.

#### Scenario: Notification with the tab closed
- **WHEN** an authorized subscribed user receives an eligible event after closing the app tab
- **THEN** the browser service worker displays the intended notification through actual push delivery

### Requirement: Correct private navigation
Opening a notification SHALL select the authorized community and exact conversation/event without exposing another identity's or community's private content. Removal or sign-out SHALL retire stale enrollment appropriately.

#### Scenario: Open a notification after community change
- **WHEN** the user opens a notification for a different saved community
- **THEN** navigation resolves the correct scoped event and rechecks current access instead of displaying cached private content

---
'eas-cli': patch
---

Confirm before `eas integrations:posthog:connect` creates a PostHog organization and project, since the CLI cannot remove them afterwards.

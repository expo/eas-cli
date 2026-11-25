---
'eas-cli': minor
---

Return `{"error":{"errorCode":"EAS_PROJECT_NOT_CONFIGURED","accountsWithProjectCreationPermission":[...]}}` on stdout when `eas build:list --json` fails because the project is unlinked. The error includes `accountName` when the target account is known, and the command exits with status 1.

---
'eas-cli': patch
---

Stop `eas workflow:validate` and `eas workflow:create` from rejecting a `${{ ... }}` expression where the schema asks for a URI, such as the Slack job's `webhook_url`.

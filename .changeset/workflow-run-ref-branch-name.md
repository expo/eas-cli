---
'eas-cli': patch
---

Keep the fully qualified branch or tag name in `eas workflow:run --ref`, so a run is labeled with the ref that was requested instead of the commit hash it resolved to locally, and warn when the remote has that ref at a different commit.

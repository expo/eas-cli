---
'eas-cli': patch
---

Stop the simulator session when `eas simulator:start` receives SIGTERM, as it already does for Ctrl+C. Package runners such as `pnpm dlx` can send SIGTERM, which left the session running on EAS.

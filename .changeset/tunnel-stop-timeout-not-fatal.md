---
'@expo/build-tools': patch
---

A remote device run session that succeeded no longer fails when its agent-device, Appium, or Argent ngrok tunnel does not stop within its time-out. The stop first makes the tunnel's local proxy drop every connection, so the tunnel cannot reach the session. The failure is still logged and reported to Sentry.

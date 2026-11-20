---
'@expo/build-tools': patch
---

Pick device run session server ports below the ephemeral port range, so another process cannot take the port before the server binds it.

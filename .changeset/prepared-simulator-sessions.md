---
'@expo/build-tools': minor
---

Add opt-in iOS session functions that claim warm Simulator services through the local CLI, configure requested network capture before app launch, and start new session tunnels. The controller owns requested-device matching and replacement.

Fetch TURN while claiming the warm session and open tool and preview tunnels alongside adoption. Failed TURN requests still fall back to P2P/STUN.

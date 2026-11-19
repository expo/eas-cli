---
'@expo/build-tools': patch
'@expo/simulator-launcher': patch
---

Use serve-sim's resident egress guard when adopting a warm iOS Simulator. Requires a serve-sim release with resident guard startup and policy admission support.

Resident warmup currently requires one Simulator and refuses camera app reinjection and Simulator shutdown/reboot while enrolled. Multi-device warm pools remain unsupported.

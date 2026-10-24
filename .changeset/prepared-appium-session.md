---
'@expo/simulator-launcher': minor
'@expo/build-tools': minor
---

Add an opt-in warm Appium session that reuses the warm Simulator and serve-sim, then sets up Appium and WDA per job. Wait for unused controllers to stop before handoff and drain Appium setup before stopping the warm session.

---
'@expo/simulator-launcher': minor
'@expo/build-tools': minor
---

Add `eas/start_warm_appium_remote_session`, which runs the Appium session on the warm Simulator, or starts cold. An `appium` claim stops the unused tools first, so WDA does not share the Simulator with the agent-device runner.

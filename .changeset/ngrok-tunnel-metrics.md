---
'@expo/build-tools': patch
---

Report Datadog metrics for the ngrok tunnels of device run sessions: each open attempt with its outcome and ngrok error code, each late open, each tunnel startup with its number of attempts, and each stop. They show how often the first-open retry saves a session, and how often a tunnel stop times out.

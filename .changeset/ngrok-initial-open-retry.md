---
'@expo/build-tools': patch
---

Retry the first ngrok tunnel open of a device run session up to two times when ngrok rejects it with ERR_NGROK_802. The first open now waits 19 seconds instead of 15, so a tunnel that opens late is kept instead of closed. Startup can be cancelled during the retries, and a preview tunnel stops retrying when its session host finishes.

---
'@expo/build-tools': patch
---

Retry the first ngrok tunnel open of a device run session up to two times when it times out or ngrok rejects it with ERR_NGROK_802. A retry starts only after the failed open settles, because ngrok runs one open at a time. Startup can now be cancelled during the retries.

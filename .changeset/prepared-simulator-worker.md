---
'@expo/worker': patch
---

Stop warm Simulator services in the background for jobs that do not opt into warm sessions on images with the vm-tools startup script or launcher state. Job setup continues immediately; built-in Simulator operations wait for cleanup and fail if it cannot be confirmed.

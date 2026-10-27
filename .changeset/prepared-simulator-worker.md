---
'@expo/worker': patch
---

Stop warm Simulator services in the background for jobs that do not opt into warm sessions on images with the vm-tools startup script or launcher state. Shutdown failures log a warning and do not block job setup.

---
'@expo/worker': patch
'@expo/build-tools': patch
---

Stop warm Simulator startup through the launcher CLI before worker environment setup unless the job opts into warm adoption. Await cleanup for any claimed controller. Unadopted opt-in resources remain owned by the VM/controller until shutdown.

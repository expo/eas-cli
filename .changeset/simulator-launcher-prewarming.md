---
'@expo/simulator-launcher': minor
---

Accept a comma-separated list of warm Simulators in `EXPO_SIMULATOR_DEVICE`; the first is the default. One serve-sim serves every listed device on one port. After the default device is ready, warmup preinstalls the latest stable Expo Go from one download and tries to disable apsd on the other devices, until a job claims one. A claim can select any listed device and reports its preinstalled Expo Go.

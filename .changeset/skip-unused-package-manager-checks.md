---
'@expo/worker': patch
---

Allow jobs with only image and environment settings to skip unused package-manager version queries with EAS_BUILD_DISABLE_PACKAGE_MANAGER_VERSION_CHECKS=1. Jobs with tool overrides keep the existing setup.

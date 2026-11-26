---
'@expo/eas-build-job': patch
'@expo/build-tools': patch
---

Validate Android `launch_args` against supported `am start` Intent options and argument arities before launching, and classify Android `am start` invalid argument and unregistered `open_url` scheme failures as `UserError`s (`EAS_LAUNCH_APPLICATION_INVALID_INPUT` and `EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME`).

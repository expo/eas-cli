---
'@expo/build-tools': major
---

Agent-device session steps now accept `install_app_path` instead of `build_id` or `application_archive_url`. Download the app with `eas/download_build` first and pass its `artifact_path` output to the session step.

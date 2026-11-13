---
'@expo/build-tools': minor
---

Count Android web preview input as session activity, so `max_idle_time_minutes` works on Android sessions. `eas/start_serve_sim_remote_session` no longer rejects it on Android; the API does not accept an idle timeout for Android web-preview-only sessions yet.

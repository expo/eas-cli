---
'@expo/build-tools': patch
---

Send the reason when the worker stops a Simulator session: `idle_timeout` after the idle timeout, and `max_duration` when the session reaches its maximum duration, which now also stops the session through the worker stop route. A canceled build step sends no stop.

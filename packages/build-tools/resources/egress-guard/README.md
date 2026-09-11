# egress-guard

A small dylib injected into every process the iOS Simulator launches during a
`--egress local` session. It interposes the socket calls that open outbound
traffic (`connect`, `connectx`, `sendto`, `sendmsg`) and refuses any
destination that is not loopback. The system proxy and the `--egress-allow`
forwards live on loopback, so everything that honors the proxy keeps working
and everything that bypasses it fails with `ECONNREFUSED` in the process that
tried, with the calling frameworks recorded.

Why interposing: simulator processes share the worker's uid, so a packet
filter cannot tell them apart from the worker's own traffic. dyld interposing
from an inserted library reaches calls made inside Apple's own frameworks
(CFNetwork, Network.framework), and `launchctl setenv DYLD_INSERT_LIBRARIES`
inside the simulator makes launchd hand the library to every process it
spawns. The simulator does not enforce library validation, which is what makes
this possible there and nowhere else.

Configuration comes from the environment the simulator's launchd provides:

- `EAS_EGRESS_GUARD_LOG`: file the guard appends events to (host path).
- `EAS_EGRESS_GUARD_MODE`: `block` (default, and what any unknown value means)
  or `log` (observe only).

Each event is one tab-separated line:

```
eas-egress-guard\t<process>\t<pid>\t<function>\t<blocked|logged>\t<peer>\t<caller>,<caller>...
```

Layout:

- `policy.c` / `policy.h`: classification, mode, formatting, per-process
  dedupe. Pure C, host-testable.
- `guard.c`: the interposers and the constructor that reads the environment.
- `check.c`: `egress-guard-check`, run inside the simulator right after the
  guard is installed. Exits non-zero unless the library is loaded in a fresh
  process and behaves as the mode says; the worker fails the session on that.
- `tests/policy_test.c`: host unit tests, `tests/run-policy-tests.sh`.
- `tests/nettest.swift`: probe binary the simulator end-to-end test runs inside
  a device; exercises URLSession, Network.framework, BSD TCP and UDP, DNS.
- `build.sh`: universal simulator dylib into `packages/build-tools/bin/`.

Installation order matters: the worker sets the launchd environment right
after `simctl boot` returns, when launchd is up but nothing else has started,
so every process the boot then spawns inherits the guard. The self-check runs
once boot completes. Both the dylib and the check binary are built by
`packages/worker/package.sh` for the iOS worker tarball and by the
`test-egress-guard` EAS workflow, not committed.

Failure semantics: a missing library, a failed `launchctl setenv`, or a failed
self-check fails the session, since a `--egress local` session without the
guard would silently leak. Only an unwritable event log is a warning, because
refusals still happen and only the reporting is lost.

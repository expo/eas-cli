# egress-guard

A small dylib injected into every process the iOS Simulator launches during a
`--egress local` session. It interposes the socket calls that open outbound
traffic (`connect`, `connectx`, `sendto`, `sendmsg`, and the `$NOCANCEL`
variants of the last three that libsystem exports alongside them) and refuses
any destination that is not loopback. A sockaddr whose family was left
`AF_UNSPEC` is classified as the family its length implies, which is how the
kernel treats it for TCP `connect` and IPv4 sends; on a datagram socket
`connect(AF_UNSPEC)` is left to the kernel, which dissolves the association. The system proxy and the `--egress-allow`
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

A process lists each `(function, peer)` once, up to 128 of them. When that
table fills it writes one more line with function `overflow` and the limit as
the peer; further distinct destinations are still refused but not listed.

Layout:

- `policy.c` / `policy.h`: classification, mode, formatting, per-process
  dedupe. Pure C, host-testable.
- `guard.c`: the interposers and the constructor that reads the environment.
- `check.c`: `egress-guard-check`, run inside the simulator right after the
  guard is installed. Exits non-zero unless the library is loaded in a fresh
  process and behaves as the mode says on `connect`, `connect$NOCANCEL` and a
  `connect` with an `AF_UNSPEC` sockaddr; the worker fails the session on that.
- `tests/policy_test.c`: host unit tests, `tests/run-policy-tests.sh`.
- `tests/guard_test.c`, `tests/guard_insert_test.c`: host tests of the
  interposers themselves, `tests/run-guard-tests.sh`. The first compiles
  `guard.c` in and forces the lock schedules (a signal handler making a socket
  call inside the critical section, a fork while another thread holds the lock,
  contention); the second inserts the built library like the simulator does and
  checks descriptor reuse, the `$NOCANCEL` symbols, `AF_UNSPEC` shapes and the
  UDP disconnect. Nothing in them opens a socket to a non-loopback address.
- `tests/nettest.swift`: probe binary the simulator end-to-end test runs inside
  a device; exercises URLSession, Network.framework, BSD TCP and UDP, DNS.
- `build.sh`: universal simulator dylib into `packages/build-tools/bin/`.

Installation order matters. `simctl` forwards every `SIMCTL_CHILD_`-prefixed
variable of its own environment to the process it starts, and for `simctl
boot` that process is the simulator's launchd, so the worker boots with the
guard and proxy variables in that form and every process of the boot inherits
them (measured: 176 of 176). `launchctl setenv` after boot is kept for a
device that was already booted, but by then the boot's own processes have
started without it. It also cannot change a variable the boot already carried:
a device booted with one guard configuration keeps it until it is shut down,
which is why the worker boots devices itself and every configuration in the
end-to-end test gets its own boot. The self-check runs once boot completes and is followed
by a coverage report from `lsof`, listing any process without the library. Both the dylib and the check binary are built by
`packages/worker/package.sh` for the iOS worker tarball and by the
`test-egress-guard` EAS workflow, not committed.

Failure semantics: a missing library, a failed `launchctl setenv`, or a failed
self-check fails the session, since a `--egress local` session without the
guard would silently leak. Only an unwritable event log is a warning, because
refusals still happen and only the reporting is lost. Recording is best-effort
in the process too: the event log is opened per event rather than held open
(a process that closes descriptors it does not own, as `launchd_sim` does,
would otherwise make the guard write into whatever reused the number), and a
dedupe slot that cannot be taken within a bounded number of attempts (a signal
handler re-entering the guard, a fork child inheriting a held lock) skips the
event rather than blocking or aborting the process.

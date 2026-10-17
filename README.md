# Saved simulator start configuration: local QA

Codex tested EAS CLI `79cc3f8af84c0c7f3bc14e9b667921b6b10c6ba1` against real authenticated serve-sim and a fresh iOS 26.4 Simulator in the owned Tart VM `eas-start-import-qa-20261017` on 2026-10-17. Native source checkout: `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620`.

## Evidence boundary

Session creation, account/project context, readiness polling and cleanup mutations use a loopback GraphQL fixture. The runner's HTTP/WebSocket authentication, pinned device, catalog validation, actions, file uploads/downloads and iOS Simulator are real. The VM/helper is staged explicitly for QA. This does not create a paid EAS session and is not hosted EAS, Universe-to-worker, or production API-to-worker E2E.

## Verified

- The file provides iOS platform, device, web-preview-only type and 10-minute duration. An explicit CLI name replaces the saved name in the recorded create request.
- The readiness fixture returns no remote config on the first poll and a real authenticated endpoint on the next. The command runs actions only after readiness.
- Seven native actions: appearance, hardware keyboard, app installation, file upload, exact file readback, app launch/deep link, screenshot. Imported text is visible inside the real UIKit QA app.
- The same file also succeeds with `simulator:control --import` (its start section is ignored).
- Start and control `--json` each produce one parseable JSON stdout object with seven results. Private start output omits the preview token. Connection details remain governed by the existing --public-link policy.
- A native failure at step 2 retains the first completed result, reports the failed action, exits 1 and sends a stop mutation only for the newly created fixture session ID. The cleanup mutation is simulated; this does not prove hosted worker termination.
- File SHA-256: `b0af4ba55cc8f460d10c0583ed8bd731b090c950fb18993cf61b0a2cbb7998ee`.
- Real transport regressions cover cancellation before connection, during upgrade and while an action is pending. Startup integration covers Ctrl-C cleanup and removal of its session handler. The recorded success restores terminal canonical/echo flags.
- Final focused config validation: 149 tests; new config modules 98.67% lines, 93.94% branches, 100% functions. Full CLI iteration: 368 suites / 3,672 passed / four skipped / 19 snapshots. Typecheck, build, changed-file type-aware lint, formatting and diff checks passed. A final simulator sweep covers the review fixes separately.
- Local Stanley and Will agent reviews found the empty-path and mutually-exclusive-source override cases; both are fixed and have regressions. The separate security agent review was still running when this evidence was prepared.

## Limits

Actions run after the worker has already installed/launched any requested app and reported readiness. They run before the inline local-egress client starts; network-dependent setup should use control import after the egress tunnel connects. Android can import start settings, but configs containing control actions are rejected before creation. No Android native or hosted EAS acceptance is claimed.

The first Tart attempt exceeded serve-sim's 120-second initial boot limit during migration. The final recording uses the fully booted Simulator and a verified authenticated endpoint. Recordings contain actual PTY output, rendered from the captured cast; existing DEP0040 dependency warnings were suppressed only in the recording environment. Private credentials/logs are excluded.

— Codex

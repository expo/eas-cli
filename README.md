# Simulator control context and import QA

Codex recorded the real EAS CLI terminal against authenticated serve-sim in an owned Tart VM on 2026-10-17. Session lookup and account authentication use local GraphQL fixtures; the WebSocket host actions, uploads, downloads, device metadata and iOS Simulator are real. This is local native QA, not hosted EAS or API-to-worker E2E.

- Interactive recording: EAS CLI `9c5aa3860`, with the same displayed fields as final `d6396aa11`. Shows session name, project, real device name/runtime, state and IDs; searchable action picker; keyboard write/readback; screenshot save; Exit.
- Import recording: final EAS CLI `d6396aa11`. Validates a seven-action file, shows the same header and local file destinations, uploads text into the app, reads identical bytes back, launches the app, saves a screenshot, and exits without a picker. `verified-in-app.png` shows the imported text in the real UIKit fixture app.
- serve-sim source checkout: `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620`. The 62-action catalog was fetched successfully. Earlier all-62 direct/import action QA remains linked in the PR; this run repeats the changed UI/JSON/lifecycle and file-import paths, not the whole matrix.
- `--list --json`, direct-action `--json`, import success `--json` and import failure `--json` stdout parsed as JSON. Direct/import results include safe session metadata; the list remains the action catalog. No picker or human header appears on JSON stdout.
- File upload/readback SHA-256: `b0af4ba55cc8f460d10c0583ed8bd731b090c950fb18993cf61b0a2cbb7998ee`.
- Exit, Ctrl-C (130), session stop (0), and session error (1) restored terminal canonical/echo settings. Session status transitions use the local fixture. A fresh-app stop failure also demonstrated stop-on-failure and structured error output.
- A cold device-metadata request timed out under host load and fell back to the pinned UDID. Subsequent native requests and both recordings returned the real device name/runtime.
- Final focused validation: 213 tests across seven suites; typecheck, build, changed-file type-aware lint, formatting and diff checks passed. Full suite during iteration: 356 suites, 3,523 tests passed, four skipped and 19 snapshots; the known worker teardown warning was previously reproduced on the base. Final presentation fixes were followed by the focused suite.
- Three local review lenses (Stanley, Will and security) found no blocker. Verified issues fixed: alternative upload usage, errored-session exit status, oclif JSON example formatting, and output-directory hints. Android explicitly reports unsupported; no Android or hosted EAS acceptance is claimed.

Recordings capture actual PTY output and input. Rendered videos use the captured cast; existing dependency deprecation warning DEP0040 was suppressed only in the recorder environment. Credentials and private server logs are excluded.

The published stack subsequently merged current main `0199cd933` through all four layers (top `fae8c090f`). Control/UI source is unchanged from the recordings. Post-merge validation: all 25 simulator suites / 607 tests passed, including the combined preview-access and embedding tests; typecheck, build, affected-file lint and formatting passed.

— Codex

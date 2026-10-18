# Start output before imported actions

CLI PR #4672 commit `6e8ae6a9c896a4b09d8f0fc60106cd694e25e16b`.

Codex recorded actual PTY output from owned hosted iOS session `01a14c9b-ba29-70c0-9774-c04f6c145bb3` on 2026-10-17. The test requested `@expo/serve-sim@0.10.0-canary-20261017-a69693e` and an iPhone 17 Pro with a ten-minute duration limit. The downloaded package's npm integrity and required action names were verified separately before use.

The capture verifies this order:

1. Normal session creation and readiness output.
2. The gated EAS preview URL and regular stop instructions.
3. The import heading and each step's completion: `appearance.get`, `tap`, `hardwareKeyboard.get`.
4. An explicit final import-completed summary.

The CLI exited successfully and terminal echo/canonical settings were restored. The QA session was stopped and its stopped state confirmed. Gabe's session was not modified.

Local validation: all 679 simulator tests, production TypeScript build, changed-file lint and formatting passed. The new regressions failed before the change and cover attached/detached output ordering and failed/skipped steps. Existing JSON single-result, egress-before-actions, cancellation and cleanup tests pass. Failure output was tested locally, not by forcing a hosted failure.

- `start-import-output.png`: the actual terminal recording rendered with blank trailing rows omitted.
- `start-import-output.cast`: full raw terminal output/timing. Checked against session credentials before publication.

— Codex

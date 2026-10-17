# Simulator start import: real EAS QA

Codex ran six owned hosted EAS iOS sessions on 2026-10-17 using the actual CLI, production account/project authentication, session API, worker creation/readiness, authenticated preview transport and a real iOS 26.5 iPhone 17 Pro Simulator. No session/auth/readiness/cleanup fixtures were used for these runs.

## Exact artifacts

- EAS CLI at `2b7a4f4ea1629380110072ec4f1086537bd04c7c` for the primary JSON, interactive, egress and cancellation runs. Real CLI testing found an import-preflight stdout issue; `1b0114c148ba862a65cb3febf0ffaf9eb1b112be` fixes it. The six negative cases and final non-interactive start ran against the rebuilt fix.
- Native host from Device Hub `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620`. All seven current lower native-stack heads were verified as ancestors before accepting this provenance. Codex rebuilt it and supplied its temporary tarball through `--package-version`; worker logs and the artifact-server download confirm the exact URL was used.
- Native archive SHA-256: `eafbbd4f9fe6db7b8e2a6b05bb7b328e3d2c7b8ebc72f53d8a39ddedbc3ba3b8`. This is an unpublished QA artifact, not a published npm-release acceptance claim.
- The UIKit fixture app, imported text and local HTTP service contain synthetic QA data. The temporary artifact service/tunnel were shut down after worker cleanup. No credentials or raw private worker/config logs are published.

## Verified on real sessions

- JSON start applies seven imported actions after readiness; file contents match byte-for-byte, stdout parses as one JSON object, and private output contains only the authenticated preview link.
- A 54-action control import covers settings writes/readbacks, Unicode app-file upload/readback, launch arguments, app files, permissions listing, location, memory warning, complete gestures, clipboard read/write and landscape/portrait rotation. Native screenshots show the app rotating; simulator screenshot files retain the device's physical pixel dimensions.
- A further 15-action input/clipboard import passed with the hardware keyboard connected: Copy, explicit Unicode Paste, stored-buffer Paste, typed carriage return normalized to Enter, keyboard toggle and screenshot. Exact copied text verifies the app's field contents.
- Interactive control displays the real session name, project, iPhone/runtime and IDs; two actions return to the picker, Exit closes it, and terminal canonical/echo flags are restored.
- Human-readable file import validates/runs once and exits without a picker, shows the session context and saves an exact readback.
- Interactive start with local egress waits for the actual tunnel connection before any imported action. A post-readiness app launch reaches `127.0.0.1:49783` on this machine through the real tunnel; the app writes a successful HTTP 200 response, which the CLI downloads and verifies. Ctrl-C stops the new session and finishes its worker.
- A separate non-interactive start imports settings and five actions, returns without attaching, preserves a CLI launch-argument override over saved arguments, opens the requested deep link, and creates output files. Its session is then explicitly stopped.
- A real native action failure at step 2 retains the first result, prints one JSON failure object with `stopped: true`, exits 1 and stops only its newly created session. The worker reaches FINISHED.
- Ctrl-C during a deliberately long native gesture closes setup, stops its new session, exits 130 and restores terminal state. The worker reaches FINISHED.
- Six real CLI negative cases (empty/missing import path, Android actions, detached local egress with actions, invalid platform and missing input file) exit before creation. After the fix, stdout is empty, diagnostics are on stderr and the project's matching session IDs are unchanged.
- 40 distinct successful action names were exercised across the main scenarios. This is not a claim that every entry in the 62-action catalog was tested.

## Findings and limits

- Fixed in EAS CLI `1b0114c14`: import preflight ran before JSON logging redirection, so `--json --import=` wrote plain text to stdout. A regression and the six real CLI cases verify the fix. All 657 simulator tests, typecheck, build, changed-file type-aware lint and formatting checks pass.
- Native Copy timed out twice with the hardware keyboard disabled despite a visible text selection. Connecting the hardware keyboard made Copy/Paste pass. This is recorded as a remaining native-input limitation; the CLI correctly reports failure rather than stale clipboard contents.
- One typing probe with the hardware keyboard disabled lost characters. Two deliberate follow-up probes, including the same text, passed exactly. This remains an observation, not a confirmed reproducible defect or a passing guarantee for that combination.
- The first interactive fixture used an `.ipa` where hosted Simulator startup requires an `.app` build artifact. That session ERRORED before readiness. Retrying with a `.app.tar.gz` succeeded; this fixture-format failure is included in the six-session accounting.
- Five sessions reached native readiness. Five sessions ended STOPPED/FINISHED; the invalid-archive session ended ERRORED/ERRORED. Cleanup was limited to the six recorded owned IDs. Final status evidence is in `hosted-summary.json`.
- Camera/capture lifecycle, foldable hinge controls, the other automation session types, Android native actions, and fleet acceptance are not covered here. The private browser preview required a browser login; visual proof uses real authenticated CLI screenshots instead.
- Recordings contain actual PTY output. The egress video omits the long startup wait, as labeled; the cast retains its timing. Existing dependency warnings are suppressed only for recordings. Font fallback is a renderer concern, not a CLI encoding transformation.

## Recordings

- [Real start import with local egress](hosted-start-egress.mp4)
- [Real interactive control loop](hosted-control-loop.mp4)
- [Imported file and successful network response in the app](hosted-egress-app.png)
- [Visible selection after the disabled-keyboard Copy failure](hosted-copy-off-selection.png)

Earlier local Tart/fixture evidence remains in the prior media commits and is separate from these hosted runs.

— Codex

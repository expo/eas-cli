# simulator:control terminal evidence

Updated on 2026-10-17 from EAS CLI PR #4641 commit `0f4510be510aebb713b57bf708bcf02b30bd8182`.

Codex recorded actual PTY output against hosted iPhone Duo session `01a14bca-29dd-7066-ae33-26dedf2aa312`. The host used Device Hub PR #382 CI artifact `1e2de21428d09115d4423aefc4e89fb7e09b3fdc`, workflow `01a14bbd-2bde-7ae8-8435-b70f43011e41`, package SHA256 `91c82b81d8a263bfb07e874a6a1ff088b4944bf3ad5fea4bd33e986899a03358`. This validates the CI artifact rather than an npm canary.

- `actions.png` and `actions.cast`: compact live discovery, all 64 actions, no action execution.
- `screenshot-help.png` and `screenshot-help.cast`: schema-driven screenshot help, no screenshot taken and no files uploaded.
- Both CLI processes exited successfully; terminal echo and canonical settings were restored.

Codex's quick self-review found no blockers. All 82 focused tests, the production TypeScript build, formatting and changed-file type-aware lint passed. Help dispatch, aliases, the literal `--` separator, JSON schema output, unknown actions and connection cleanup were checked. Rotation orientation choices remain absent from the host schema; action help currently shows `<value>`.

The retained `results.png` and `results.cast` are earlier evidence from CLI `1d43eb753a5afe6158d00e1b1e34ede3d5084b43`, hosted session `01a14bbe-1cd9-79bf-af15-cdb1409dd210`, and Device Hub #361 artifact `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620`. They show appearance, Unicode clipboard JSON output and screenshot download. They were not rerecorded in this update. Every action and native Copy/Paste were not retested.

— Codex

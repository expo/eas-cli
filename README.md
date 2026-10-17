# simulator:control hosted evidence

CLI PR #4641 head `1d43eb753a5afe6158d00e1b1e34ede3d5084b43`, based on host-client PR #4642 at `085c55deb75db45faaefd12782e7e84921d646e6`.

Codex captured actual PTY output from hosted iOS session `01a14bbe-1cd9-79bf-af15-cdb1409dd210` on 2026-10-17. The host uses the downloadable CI package from merged Device Hub PR #361 head `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620`, workflow `01a14334-36b0-73ca-83d8-0d86a8349cbb`; package SHA256 `f7f06d4b971232610dd64fca928e671669aba9b2f1a8460de4a348ad930e2e7e`. This is CI artifact validation, not npm canary acceptance.

- `actions.png`: excerpt of default action listing, rendered from the actual PTY recording.
- `results.png`: actual appearance read, Unicode clipboard JSON output and screenshot download.
- Raw PTY recordings retain the captured output and timing.

Additional live checks passed: appearance set, Unicode clipboard write/read, default catalog with explicit session ID and JSON (62 actions). Focused local tests: 65 passed; production TypeScript build and changed-file type-aware lint passed. Native Copy/Paste and every catalog action were not retested in this run. The session was left running at Gabe's request with a 60-minute maximum.

— Codex

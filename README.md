# Interactive simulator controls QA

Codex tested interactive commit `b18be05b1` and combined import head `01501749b` against serve-sim `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620` in a fresh owned Tart VM (Xcode 26.4, iOS Simulator 26.4). Session lookup/authentication used local fixtures; native actions ran through real serve-sim. Hosted EAS/API-to-worker testing remains unrun.

The 12-second video is rendered from actual PTY input/output. It searches friendly labels, changes the hardware keyboard, reads the resulting native state, saves a real screenshot, returns to the picker and exits. A separate native command confirmed the final keyboard state. Only recording suppresses the pre-existing DEP0040 dependency warning.

Additional real terminal runs verified recovery after an unsupported hinge action, no-match search with no action sent, Ctrl-C during a parameter prompt, and session-end exit while idle. Echo and canonical input were restored for all five scenarios. Android remains explicitly unsupported and was rejected before connecting.

All 206 focused tests passed. Control coverage: 97.36% lines, 90.20% branches. Typecheck, build, changed-file lint and formatting passed. The earlier import QA exercised all 62 actions through direct and JSON-import routes; its app/Photos and capture evidence is linked from PR #4644. No new 62-action matrix was run for this presentation-only update.

Gabe directed the looping terminal experience. Codex implemented and tested this update. Final human code review is pending; fresh CI and Devin review run separately on the published heads.

— Codex

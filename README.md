# Simulator control import QA

Codex tested commit `8abc7e60816f5ecc79a35af52ab74714dd067575` against serve-sim `1c41d7e0aa3f27ca9cc10f74f2c8bd2442b71620` in an owned Tart VM, Xcode 26.4 and iOS Simulator 26.4. Session lookup/authentication used local fixtures; native actions used real serve-sim. Hosted EAS/API-to-worker testing remains unrun.

All 62 catalog actions were exercised through direct commands and JSON import (40 grouped checks passed). Imported app files matched source hashes and appeared in the test app; imported photos were visually verified in Photos. Native input, settings, camera injection, network capture/body retrieval and reboots were checked. Hinge actions correctly rejected this nonfolding iPhone; positive folding behavior remains untested. Core Animation calls succeeded, but visible overlay rendering was not established.

The video shows a real seven-action import and a runtime failure that skips the following action. It uses existing ora/Log output, rendered from actual PTY recordings; only the recording suppresses the existing DEP0040 dependency warning. Terminal echo and canonical input were restored after both runs.

Local validation: 356 suites, 3516 tests passed, four skipped, 19 snapshots; Jest reported one force-exited worker after completion. Focused 205 tests exited normally. Control coverage: 97.54% lines, 90.89% branches. Typecheck, build, changed-file lint and formatting passed. The owned VM and processes were removed after QA.

Gabe directed and approved the terminal experience. Codex implemented and ran these checks; final human code review is pending.

— Codex

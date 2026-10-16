# Simulator control validation

Codex captured these terminal sessions from the built EAS CLI against native serve-sim on an owned iPhone 17 Pro Simulator (iOS 26.4, Xcode 26.4 / 17E192). Session lookup and authentication used local GraphQL/context fixtures. This is local native validation; hosted EAS and Android device execution were not tested.

Interactive source: `52544e70d05d431582f3c0cdfba437a523a8fb69`. Import source: `721e2dc22c2a95c6cd71bc26b00b7250dec0254d`.

Codex ran the EAS CLI package suite: 353 suites and 3,448 tests passed, with 4 skipped. The focused control run passed 193 tests with default Babel coverage: 97.29% lines and 90.48% branches across the seven control modules. Typecheck, changed-file lint, formatting, and build passed.

Independent Codex reviews found output preflight and competing upload-source issues in config import. Both were fixed, reproduced again, and re-reviewed. Human review remains pending.

- Interactive selection: set hardware keyboard off, read back off, return to picker, Exit (status 0).
- Ctrl-C at the picker: status 130. Session ending at the picker: status 0. Canonical input and echo restored in all three terminal runs.
- Seven-action import: keyboard set/read, clipboard write/read, local image upload to Photos, screenshot download, keyboard restore. The import returned to the picker and Exit restored the terminal.
- Invalid later parameters rejected with status 1; keyboard readback remained on.
- Runtime failure at step 2 preserved the first result, reported the failing step, exited 1, and left the third action unapplied.
- Android session selection rejected with the explicit unsupported message.

The PNG, GIF, MP4, and cast files come from actual PTY output. The MP4s are conversions of the captured GIFs. `downloaded-screen.png` is the screenshot returned by the native import.

— Codex

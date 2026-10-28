---
'@expo/simulator-launcher': patch
---

Confirm cleanup when an owned service wrapper propagates its deliberately stopped child's exit status. Drain discovered children, any remaining members of its owned process group, and captured output before reporting success; exits before teardown and unconfirmed cleanup still fail.

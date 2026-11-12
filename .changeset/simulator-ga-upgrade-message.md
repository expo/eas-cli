---
'eas-cli': minor
---

Tell accounts without EAS Simulator access that it is available on the Starter, Production, and Enterprise plans and link to the billing page, instead of pointing at the waitlist. `simulator:availability --json` now returns `billingUrl` instead of `waitlistUrl`.

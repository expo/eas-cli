---
'eas-cli': patch
---

Make `eas metadata:lint` report an `apple.review.demoPassword` longer than 100 characters, instead of letting `eas metadata:push` fail at upload time with "Password cannot be longer than 100 characters".

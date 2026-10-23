---
'eas-cli': patch
---

Package local Simulator app bundles for upload when the host supports gzip tar archives, and reject unsupported IPA and ZIP installs before uploading.

Fix packaging stalls for app bundles containing hard links and clean temporary archives when interrupted. Local app directories and `.tar.gz`/`.tgz` files require a host advertising archive support.

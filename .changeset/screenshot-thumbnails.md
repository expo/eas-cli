---
'@expo/build-tools': minor
'eas-cli': patch
---

Upload a small WebP copy of each simulator session screenshot wider than 480 px as a `screenshot-thumbnail` artifact, so the website lists load faster. The screenshot and its copy share a `thumbnailKey` in their metadata. `eas simulator:get` does not show these copies.

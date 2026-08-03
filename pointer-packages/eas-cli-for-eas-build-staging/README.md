# eas-cli-for-eas-build-staging

Internal Expo pointer package. Do not install this package directly.

The `latest` version of this package pins the exact `eas-cli` version that EAS Build **staging** infrastructure uses. The pin is the `eas-cli` entry in `dependencies`.

This package replaces the `latest-eas-build-staging` npm dist-tag on `eas-cli`. CI can no longer move dist-tags with npm access tokens. CI can still publish packages with OIDC trusted publishing, and every publish moves this package's `latest` tag.

See [`pointer-packages/README.md`](https://github.com/expo/eas-cli/tree/main/pointer-packages) in the repository for how to publish, promote, and roll back.

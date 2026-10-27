# @expo/worker

## 26.0.0

### Patch Changes

- Retry Node.js installation without the internal Node.js cache mirror when the first attempt fails, while preserving other configured mirrors. ([#3452](https://github.com/expo/eas-cli/pull/3452) by [@sjchmiela](https://github.com/sjchmiela))
- Mask secrets in every field of uploaded job log records, such as logged errors, not only in log messages. ([#4698](https://github.com/expo/eas-cli/pull/4698) by [@brentvatne](https://github.com/brentvatne))

## 25.3.0

No changes in this release.

## 25.2.0

No changes in this release.

## 25.1.1

No changes in this release.

## 25.1.0

No changes in this release.

## 25.0.0

### Patch Changes

- Call the device run session worker API with the session token when www provides one. ([#4615](https://github.com/expo/eas-cli/pull/4615) by [@szdziedzic](https://github.com/szdziedzic))

# @expo/worker

## 27.4.0

No changes in this release.

## 27.3.0

### Patch Changes

- Mask secrets in every record the worker process writes to its stdout: the build log records and the worker's own records. ([#4782](https://github.com/expo/eas-cli/pull/4782) by [@hSATAC](https://github.com/hSATAC))
- Stop warmup in the background for jobs that do not use the warm Simulator, so job setup does not wait for it. Before build-tools boots or clones a Simulator, it waits until the launcher's state file records that cleanup finished, and fails if cleanup does not finish in time. ([#4721](https://github.com/expo/eas-cli/pull/4721) by [@gwdp](https://github.com/gwdp))

## 27.2.0

### Patch Changes

- Run package-manager version queries in parallel during worker preparation. ([#4710](https://github.com/expo/eas-cli/pull/4710) by [@gwdp](https://github.com/gwdp))
- Start the Xcode version check in the background during worker tool preparation. Apply the Xcode 26.0 upload workaround when the query finishes, without delaying job startup. ([#4707](https://github.com/expo/eas-cli/pull/4707) by [@gwdp](https://github.com/gwdp))
- Allow jobs to skip installing the CocoaPods cache proxy with EAS_BUILD_DISABLE_COCOAPODS_CACHE_PLUGIN=1. ([#4709](https://github.com/expo/eas-cli/pull/4709) by [@gwdp](https://github.com/gwdp))

## 27.1.0

### Patch Changes

- Put the `NPM_TOKEN` registry credential in the builder's npm user config on EAS Build (`~/.npmrc`, or the file `NPM_CONFIG_USERCONFIG` names), where pnpm 10.34.2+ and 11.5.3+ still expand `${NPM_TOKEN}` (they ignore it in a project-level `.npmrc`). Explain what to change when the project's pnpm version needs a newer Node.js than the build runs, including when eas.json sets `node` or `pnpm`. ([#4729](https://github.com/expo/eas-cli/pull/4729) by [@hSATAC](https://github.com/hSATAC))

## 27.0.0

No changes in this release.

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

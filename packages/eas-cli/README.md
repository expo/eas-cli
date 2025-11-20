# eas-cli

EAS command line tool

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![Downloads/week](https://img.shields.io/npm/dw/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![License](https://img.shields.io/npm/l/eas-cli.svg)](https://github.com/expo/eas-cli/blob/main/package.json)

- [Installation](#installation)
- [Usage](#usage)
- [Commands](#commands)

# Installation

```sh
npm install -g eas-cli
# or
yarn global add eas-cli
```

## Enforcing eas-cli version for your project

If you want to enforce the `eas-cli` version for your project, use the `"cli.version"` field in **eas.json**. Installing `eas-cli` to your project dependencies is strongly discouraged because it may cause dependency conflicts that are difficult to debug.

An example of **eas.json** that enforces `eas-cli` in version `1.0.0` or newer:

```json
{
  "cli": {
    "version": ">=1.0.0"
  },
  "build": {
    // build profiles
  },
  "submit": {
    // submit profiles
  }
}
```

Learn more: https://docs.expo.dev/build/eas-json/

# Usage

```sh
eas COMMAND
# runs the command
eas (-v|--version|version)
# prints the version
eas --help COMMAND
# outputs help for specific command
```

# Commands

<!-- commands -->
* [`eas account:login`](#eas-accountlogin)
* [`eas account:logout`](#eas-accountlogout)
* [`eas account:view`](#eas-accountview)
* [`eas analytics [STATUS]`](#eas-analytics-status)
* [`eas autocomplete [SHELL]`](#eas-autocomplete-shell)
* [`eas branch:create [NAME]`](#eas-branchcreate-name)
* [`eas branch:delete [NAME]`](#eas-branchdelete-name)
* [`eas branch:list`](#eas-branchlist)
* [`eas branch:rename`](#eas-branchrename)
* [`eas branch:view [NAME]`](#eas-branchview-name)
* [`eas build`](#eas-build)
* [`eas build:cancel [BUILD_ID]`](#eas-buildcancel-build_id)
* [`eas build:configure`](#eas-buildconfigure)
* [`eas build:delete [BUILD_ID]`](#eas-builddelete-build_id)
* [`eas build:dev`](#eas-builddev)
* [`eas build:download`](#eas-builddownload)
* [`eas build:inspect`](#eas-buildinspect)
* [`eas build:list`](#eas-buildlist)
* [`eas build:resign`](#eas-buildresign)
* [`eas build:run`](#eas-buildrun)
* [`eas build:submit`](#eas-buildsubmit)
* [`eas build:version:get`](#eas-buildversionget)
* [`eas build:version:set`](#eas-buildversionset)
* [`eas build:version:sync`](#eas-buildversionsync)
* [`eas build:view [BUILD_ID]`](#eas-buildview-build_id)
* [`eas channel:create [NAME]`](#eas-channelcreate-name)
* [`eas channel:delete [NAME]`](#eas-channeldelete-name)
* [`eas channel:edit [NAME]`](#eas-channeledit-name)
* [`eas channel:list`](#eas-channellist)
* [`eas channel:pause [NAME]`](#eas-channelpause-name)
* [`eas channel:resume [NAME]`](#eas-channelresume-name)
* [`eas channel:rollout [CHANNEL]`](#eas-channelrollout-channel)
* [`eas channel:view [NAME]`](#eas-channelview-name)
* [`eas config`](#eas-config)
* [`eas credentials`](#eas-credentials)
* [`eas credentials:configure-build`](#eas-credentialsconfigure-build)
* [`eas deploy [options]`](#eas-deploy-options)
* [`eas deploy:alias`](#eas-deployalias)
* [`eas deploy:alias:delete [ALIAS_NAME]`](#eas-deployaliasdelete-alias_name)
* [`eas deploy:delete [DEPLOYMENT_ID]`](#eas-deploydelete-deployment_id)
* [`eas deploy:promote`](#eas-deploypromote)
* [`eas device:create`](#eas-devicecreate)
* [`eas device:delete`](#eas-devicedelete)
* [`eas device:list`](#eas-devicelist)
* [`eas device:rename`](#eas-devicerename)
* [`eas device:view [UDID]`](#eas-deviceview-udid)
* [`eas diagnostics`](#eas-diagnostics)
* [`eas env:create [ENVIRONMENT]`](#eas-envcreate-environment)
* [`eas env:delete [ENVIRONMENT]`](#eas-envdelete-environment)
* [`eas env:exec ENVIRONMENT BASH_COMMAND`](#eas-envexec-environment-bash_command)
* [`eas env:get [ENVIRONMENT]`](#eas-envget-environment)
* [`eas env:list [ENVIRONMENT]`](#eas-envlist-environment)
* [`eas env:pull [ENVIRONMENT]`](#eas-envpull-environment)
* [`eas env:push [ENVIRONMENT]`](#eas-envpush-environment)
* [`eas env:update [ENVIRONMENT]`](#eas-envupdate-environment)
* [`eas fingerprint:compare [HASH1] [HASH2]`](#eas-fingerprintcompare-hash1-hash2)
* [`eas fingerprint:generate`](#eas-fingerprintgenerate)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas init`](#eas-init)
* [`eas init:onboarding [TARGET_PROJECT_DIRECTORY]`](#eas-initonboarding-target_project_directory)
* [`eas login`](#eas-login)
* [`eas logout`](#eas-logout)
* [`eas metadata:lint`](#eas-metadatalint)
* [`eas metadata:pull`](#eas-metadatapull)
* [`eas metadata:push`](#eas-metadatapush)
* [`eas new [PATH]`](#eas-new-path)
* [`eas onboarding [TARGET_PROJECT_DIRECTORY]`](#eas-onboarding-target_project_directory)
* [`eas open`](#eas-open)
* [`eas project:info`](#eas-projectinfo)
* [`eas project:init`](#eas-projectinit)
* [`eas project:new [PATH]`](#eas-projectnew-path)
* [`eas project:onboarding [TARGET_PROJECT_DIRECTORY]`](#eas-projectonboarding-target_project_directory)
* [`eas submit`](#eas-submit)
* [`eas update`](#eas-update)
* [`eas update:configure`](#eas-updateconfigure)
* [`eas update:delete GROUPID`](#eas-updatedelete-groupid)
* [`eas update:edit [GROUPID]`](#eas-updateedit-groupid)
* [`eas update:list`](#eas-updatelist)
* [`eas update:republish`](#eas-updaterepublish)
* [`eas update:revert-update-rollout`](#eas-updaterevert-update-rollout)
* [`eas update:roll-back-to-embedded`](#eas-updateroll-back-to-embedded)
* [`eas update:rollback`](#eas-updaterollback)
* [`eas update:view GROUPID`](#eas-updateview-groupid)
* [`eas upload`](#eas-upload)
* [`eas webhook:create`](#eas-webhookcreate)
* [`eas webhook:delete [ID]`](#eas-webhookdelete-id)
* [`eas webhook:list`](#eas-webhooklist)
* [`eas webhook:update`](#eas-webhookupdate)
* [`eas webhook:view ID`](#eas-webhookview-id)
* [`eas whoami`](#eas-whoami)
* [`eas worker:alias`](#eas-workeralias)
* [`eas worker:alias:delete [ALIAS_NAME]`](#eas-workeraliasdelete-alias_name)
* [`eas worker:delete [DEPLOYMENT_ID]`](#eas-workerdelete-deployment_id)
* [`eas deploy [options]`](#eas-deploy-options-1)
* [`eas workflow:cancel`](#eas-workflowcancel)
* [`eas workflow:create [NAME]`](#eas-workflowcreate-name)
* [`eas workflow:logs [ID]`](#eas-workflowlogs-id)
* [`eas workflow:run [FILE]`](#eas-workflowrun-file)
* [`eas workflow:runs`](#eas-workflowruns)
* [`eas workflow:status [WORKFLOW_RUN_ID]`](#eas-workflowstatus-workflow_run_id)
* [`eas workflow:validate PATH`](#eas-workflowvalidate-path)
* [`eas workflow:view [ID]`](#eas-workflowview-id)

## `eas account:login`

log in with your Expo account

```
USAGE
  $ eas account:login [-s]

FLAGS
  -s, --sso  Login with SSO

DESCRIPTION
  log in with your Expo account

ALIASES
  $ eas login
```

_See code: [packages/eas-cli/src/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/account/login.ts)_

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

DESCRIPTION
  log out

ALIASES
  $ eas logout
```

_See code: [packages/eas-cli/src/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/account/logout.ts)_

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

DESCRIPTION
  show the username you are logged in as

ALIASES
  $ eas whoami
```

_See code: [packages/eas-cli/src/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/account/view.ts)_

## `eas analytics [STATUS]`

display or change analytics settings

```
USAGE
  $ eas analytics [STATUS]

DESCRIPTION
  display or change analytics settings
```

_See code: [packages/eas-cli/src/commands/analytics.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/analytics.ts)_

## `eas autocomplete [SHELL]`

display autocomplete installation instructions

```
USAGE
  $ eas autocomplete [SHELL] [-r]

ARGUMENTS
  SHELL  (zsh|bash|powershell) Shell type

FLAGS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

DESCRIPTION
  display autocomplete installation instructions

EXAMPLES
  $ eas autocomplete

  $ eas autocomplete bash

  $ eas autocomplete zsh

  $ eas autocomplete powershell

  $ eas autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v2.3.10/packages/eas-cli/src/commands/autocomplete/index.ts)_

## `eas branch:create [NAME]`

create a branch

```
USAGE
  $ eas branch:create [NAME] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the branch to create

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  create a branch
```

_See code: [packages/eas-cli/src/commands/branch/create.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/branch/create.ts)_

## `eas branch:delete [NAME]`

delete a branch

```
USAGE
  $ eas branch:delete [NAME] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the branch to delete

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  delete a branch
```

_See code: [packages/eas-cli/src/commands/branch/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/branch/delete.ts)_

## `eas branch:list`

list all branches

```
USAGE
  $ eas branch:list [--offset <value>] [--limit <value>] [--json --non-interactive]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>    The number of items to fetch each query. Defaults to 50 and is capped at 100.
  --non-interactive  Run the command in non-interactive mode.
  --offset=<value>   Start queries from specified index. Use for paginating results. Defaults to 0.

DESCRIPTION
  list all branches
```

_See code: [packages/eas-cli/src/commands/branch/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/branch/list.ts)_

## `eas branch:rename`

rename a branch

```
USAGE
  $ eas branch:rename [--from <value>] [--to <value>] [--json --non-interactive]

FLAGS
  --from=<value>     current name of the branch.
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.
  --to=<value>       new name of the branch.

DESCRIPTION
  rename a branch
```

_See code: [packages/eas-cli/src/commands/branch/rename.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/branch/rename.ts)_

## `eas branch:view [NAME]`

view a branch

```
USAGE
  $ eas branch:view [NAME] [--offset <value>] [--limit <value>] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the branch to view

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>    The number of items to fetch each query. Defaults to 25 and is capped at 50.
  --non-interactive  Run the command in non-interactive mode.
  --offset=<value>   Start queries from specified index. Use for paginating results. Defaults to 0.

DESCRIPTION
  view a branch
```

_See code: [packages/eas-cli/src/commands/branch/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/branch/view.ts)_

## `eas build`

start a build

```
USAGE
  $ eas build [-p android|ios|all] [-e <value>] [--local] [--output <value>] [--wait] [--clear-cache] [-s |
    --auto-submit-with-profile <value>] [--what-to-test <value>] [-m <value>] [--build-logger-level
    trace|debug|info|warn|error|fatal] [--freeze-credentials] [--verbose-logs] [--json --non-interactive]

FLAGS
  -e, --profile=PROFILE_NAME                                Name of the build profile from eas.json. Defaults to
                                                            "production" if defined in eas.json.
  -m, --message=<value>                                     A short message describing the build
  -p, --platform=(android|ios|all)
  -s, --auto-submit                                         Submit on build complete using the submit profile with the
                                                            same name as the build profile
  --auto-submit-with-profile=PROFILE_NAME                   Submit on build complete using the submit profile with
                                                            provided name
  --build-logger-level=(trace|debug|info|warn|error|fatal)  The level of logs to output during the build process.
                                                            Defaults to "info".
  --clear-cache                                             Clear cache before the build
  --freeze-credentials                                      Prevent the build from updating credentials in
                                                            non-interactive mode
  --json                                                    Enable JSON output, non-JSON messages will be printed to
                                                            stderr.
  --local                                                   Run build locally [experimental]
  --non-interactive                                         Run the command in non-interactive mode.
  --output=<value>                                          Output path for local build
  --verbose-logs                                            Use verbose logs for the build process
  --[no-]wait                                               Wait for build(s) to complete
  --what-to-test=<value>                                    Specify the "What to Test" information for the build in
                                                            TestFlight (iOS-only). To be used with the `auto-submit`
                                                            flag

DESCRIPTION
  start a build
```

_See code: [packages/eas-cli/src/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/index.ts)_

## `eas build:cancel [BUILD_ID]`

cancel a build

```
USAGE
  $ eas build:cancel [BUILD_ID] [--non-interactive] [-p android|ios|all] [-e <value>]

FLAGS
  -e, --profile=PROFILE_NAME        Filter builds by build profile if build ID is not provided
  -p, --platform=(android|ios|all)  Filter builds by the platform if build ID is not provided
  --non-interactive                 Run the command in non-interactive mode.

DESCRIPTION
  cancel a build
```

_See code: [packages/eas-cli/src/commands/build/cancel.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/cancel.ts)_

## `eas build:configure`

configure the project to support EAS Build

```
USAGE
  $ eas build:configure [-p android|ios|all]

FLAGS
  -p, --platform=(android|ios|all)  Platform to configure

DESCRIPTION
  configure the project to support EAS Build
```

_See code: [packages/eas-cli/src/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/configure.ts)_

## `eas build:delete [BUILD_ID]`

delete a build

```
USAGE
  $ eas build:delete [BUILD_ID] [--non-interactive] [-p android|ios|all] [-e <value>]

FLAGS
  -e, --profile=PROFILE_NAME        Filter builds by build profile if build ID is not provided
  -p, --platform=(android|ios|all)  Filter builds by the platform if build ID is not provided
  --non-interactive                 Run the command in non-interactive mode.

DESCRIPTION
  delete a build
```

_See code: [packages/eas-cli/src/commands/build/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/delete.ts)_

## `eas build:dev`

run dev client simulator/emulator build with matching fingerprint or create a new one

```
USAGE
  $ eas build:dev [-p ios|android] [-e <value>]

FLAGS
  -e, --profile=PROFILE_NAME    Name of the build profile from eas.json. It must be a profile allowing to create
                                emulator/simulator internal distribution dev client builds. The "development-simulator"
                                build profile will be selected by default.
  -p, --platform=(ios|android)

DESCRIPTION
  run dev client simulator/emulator build with matching fingerprint or create a new one
```

_See code: [packages/eas-cli/src/commands/build/dev.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/dev.ts)_

## `eas build:download`

download simulator/emulator builds for a given fingerprint hash

```
USAGE
  $ eas build:download --fingerprint <value> [-p ios|android] [--dev-client] [--json --non-interactive]

FLAGS
  -p, --platform=(ios|android)
  --[no-]dev-client             Filter only dev-client builds.
  --fingerprint=<value>         (required) Fingerprint hash of the build to download
  --json                        Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive             Run the command in non-interactive mode.

DESCRIPTION
  download simulator/emulator builds for a given fingerprint hash
```

_See code: [packages/eas-cli/src/commands/build/download.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/download.ts)_

## `eas build:inspect`

inspect the state of the project at specific build stages, useful for troubleshooting

```
USAGE
  $ eas build:inspect -p android|ios -s archive|pre-build|post-build -o <value> [-e <value>] [--force] [-v]

FLAGS
  -e, --profile=PROFILE_NAME
      Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.

  -o, --output=OUTPUT_DIRECTORY
      (required) Output directory.

  -p, --platform=(android|ios)
      (required)

  -s, --stage=(archive|pre-build|post-build)
      (required) Stage of the build you want to inspect.
      archive - builds the project archive that would be uploaded to EAS when building
      pre-build - prepares the project to be built with Gradle/Xcode. Does not run the native build.
      post-build - builds the native project and leaves the output directory for inspection

  -v, --verbose

  --force
      Delete OUTPUT_DIRECTORY if it already exists.

DESCRIPTION
  inspect the state of the project at specific build stages, useful for troubleshooting
```

_See code: [packages/eas-cli/src/commands/build/inspect.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/inspect.ts)_

## `eas build:list`

list all builds for your project

```
USAGE
  $ eas build:list [-p android|ios|all] [--status
    new|in-queue|in-progress|pending-cancel|errored|finished|canceled] [--distribution store|internal|simulator]
    [--channel <value>] [--app-version <value>] [--app-build-version <value>] [--sdk-version <value>] [--runtime-version
    <value>] [--app-identifier <value>] [-e <value>] [--git-commit-hash <value>] [--fingerprint-hash <value>] [--offset
    <value>] [--limit <value>] [--json --non-interactive] [--simulator]

FLAGS
  -e, --build-profile=<value>                                                   Filter only builds created with the
                                                                                specified build profile
  -p, --platform=(android|ios|all)
  --app-build-version=<value>                                                   Filter only builds created with the
                                                                                specified app build version
  --app-identifier=<value>                                                      Filter only builds created with the
                                                                                specified app identifier
  --app-version=<value>                                                         Filter only builds created with the
                                                                                specified main app version
  --channel=<value>
  --distribution=(store|internal|simulator)                                     Filter only builds with the specified
                                                                                distribution type
  --fingerprint-hash=<value>                                                    Filter only builds with the specified
                                                                                fingerprint hash
  --git-commit-hash=<value>                                                     Filter only builds created with the
                                                                                specified git commit hash
  --json                                                                        Enable JSON output, non-JSON messages
                                                                                will be printed to stderr.
  --limit=<value>                                                               The number of items to fetch each query.
                                                                                Defaults to 10 and is capped at 50.
  --non-interactive                                                             Run the command in non-interactive mode.
  --offset=<value>                                                              Start queries from specified index. Use
                                                                                for paginating results. Defaults to 0.
  --runtime-version=<value>                                                     Filter only builds created with the
                                                                                specified runtime version
  --sdk-version=<value>                                                         Filter only builds created with the
                                                                                specified Expo SDK version
  --simulator                                                                   Filter only iOS simulator builds. Can
                                                                                only be used with --platform flag set to
                                                                                "ios"
  --status=(new|in-queue|in-progress|pending-cancel|errored|finished|canceled)  Filter only builds with the specified
                                                                                status

DESCRIPTION
  list all builds for your project
```

_See code: [packages/eas-cli/src/commands/build/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/list.ts)_

## `eas build:resign`

re-sign a build archive

```
USAGE
  $ eas build:resign [-p android|ios] [-e <value>] [--source-profile <value>] [--wait] [--id <value>] [--offset
    <value>] [--limit <value>] [--json --non-interactive]

FLAGS
  -e, --target-profile=PROFILE_NAME  Name of the target build profile from eas.json. Credentials and environment
                                     variables from this profile will be used when re-signing. Defaults to "production"
                                     if defined in eas.json.
  -p, --platform=(android|ios)
  --id=<value>                       ID of the build to re-sign.
  --json                             Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>                    The number of items to fetch each query. Defaults to 50 and is capped at 100.
  --non-interactive                  Run the command in non-interactive mode.
  --offset=<value>                   Start queries from specified index. Use for paginating results. Defaults to 0.
  --source-profile=PROFILE_NAME      Name of the source build profile from eas.json. Used to filter builds eligible for
                                     re-signing.
  --[no-]wait                        Wait for build(s) to complete.

DESCRIPTION
  re-sign a build archive
```

_See code: [packages/eas-cli/src/commands/build/resign.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/resign.ts)_

## `eas build:run`

run simulator/emulator builds from eas-cli

```
USAGE
  $ eas build:run [--latest | --id <value> | --path <value> | --url <value>] [-p android|ios] [-e <value>]
    [--offset <value>] [--limit <value>]

FLAGS
  -e, --profile=PROFILE_NAME    Name of the build profile used to create the build to run. When specified, only builds
                                created with the specified build profile will be queried.
  -p, --platform=(android|ios)
  --id=<value>                  ID of the simulator/emulator build to run
  --latest                      Run the latest simulator/emulator build for specified platform
  --limit=<value>               The number of items to fetch each query. Defaults to 50 and is capped at 100.
  --offset=<value>              Start queries from specified index. Use for paginating results. Defaults to 0.
  --path=<value>                Path to the simulator/emulator build archive or app
  --url=<value>                 Simulator/Emulator build archive url

DESCRIPTION
  run simulator/emulator builds from eas-cli
```

_See code: [packages/eas-cli/src/commands/build/run.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/run.ts)_

## `eas build:submit`

submit app binary to App Store and/or Play Store

```
USAGE
  $ eas build:submit [-p android|ios|all] [-e <value>] [--latest | --id <value> | --path <value> | --url <value>]
    [--what-to-test <value>] [--verbose] [--wait] [--verbose-fastlane] [-g <value>] [--non-interactive]

FLAGS
  -e, --profile=<value>             Name of the submit profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  -g, --groups=<value>...           Internal TestFlight testing groups to add the build to (iOS only). Learn more:
                                    https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-
                                    testers
  -p, --platform=(android|ios|all)
  --id=<value>                      ID of the build to submit
  --latest                          Submit the latest build for specified platform
  --non-interactive                 Run command in non-interactive mode
  --path=<value>                    Path to the .apk/.aab/.ipa file
  --url=<value>                     App archive url
  --verbose                         Always print logs from EAS Submit
  --verbose-fastlane                Enable verbose logging for the submission process
  --[no-]wait                       Wait for submission to complete
  --what-to-test=<value>            Sets the "What to test" information in TestFlight (iOS only).

DESCRIPTION
  submit app binary to App Store and/or Play Store

ALIASES
  $ eas build:submit
```

## `eas build:version:get`

get the latest version from EAS servers

```
USAGE
  $ eas build:version:get [-p android|ios|all] [-e <value>] [--json --non-interactive]

FLAGS
  -e, --profile=PROFILE_NAME        Name of the build profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  -p, --platform=(android|ios|all)
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive                 Run the command in non-interactive mode.

DESCRIPTION
  get the latest version from EAS servers
```

_See code: [packages/eas-cli/src/commands/build/version/get.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/version/get.ts)_

## `eas build:version:set`

update version of an app

```
USAGE
  $ eas build:version:set [-p android|ios] [-e <value>]

FLAGS
  -e, --profile=PROFILE_NAME    Name of the build profile from eas.json. Defaults to "production" if defined in
                                eas.json.
  -p, --platform=(android|ios)

DESCRIPTION
  update version of an app
```

_See code: [packages/eas-cli/src/commands/build/version/set.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/version/set.ts)_

## `eas build:version:sync`

update a version in native code with a value stored on EAS servers

```
USAGE
  $ eas build:version:sync [-p android|ios|all] [-e <value>]

FLAGS
  -e, --profile=PROFILE_NAME        Name of the build profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  -p, --platform=(android|ios|all)

DESCRIPTION
  update a version in native code with a value stored on EAS servers
```

_See code: [packages/eas-cli/src/commands/build/version/sync.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/version/sync.ts)_

## `eas build:view [BUILD_ID]`

view a build for your project

```
USAGE
  $ eas build:view [BUILD_ID] [--json]

FLAGS
  --json  Enable JSON output, non-JSON messages will be printed to stderr.

DESCRIPTION
  view a build for your project
```

_See code: [packages/eas-cli/src/commands/build/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/build/view.ts)_

## `eas channel:create [NAME]`

create a channel

```
USAGE
  $ eas channel:create [NAME] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the channel to create

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  create a channel
```

_See code: [packages/eas-cli/src/commands/channel/create.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/create.ts)_

## `eas channel:delete [NAME]`

Delete a channel

```
USAGE
  $ eas channel:delete [NAME] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the channel to delete

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  Delete a channel
```

_See code: [packages/eas-cli/src/commands/channel/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/delete.ts)_

## `eas channel:edit [NAME]`

point a channel at a new branch

```
USAGE
  $ eas channel:edit [NAME] [--branch <value>] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the channel to edit

FLAGS
  --branch=<value>   Name of the branch to point to
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  point a channel at a new branch
```

_See code: [packages/eas-cli/src/commands/channel/edit.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/edit.ts)_

## `eas channel:list`

list all channels

```
USAGE
  $ eas channel:list [--offset <value>] [--limit <value>] [--json --non-interactive]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>    The number of items to fetch each query. Defaults to 10 and is capped at 25.
  --non-interactive  Run the command in non-interactive mode.
  --offset=<value>   Start queries from specified index. Use for paginating results. Defaults to 0.

DESCRIPTION
  list all channels
```

_See code: [packages/eas-cli/src/commands/channel/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/list.ts)_

## `eas channel:pause [NAME]`

pause a channel to stop it from sending updates

```
USAGE
  $ eas channel:pause [NAME] [--branch <value>] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the channel to edit

FLAGS
  --branch=<value>   Name of the branch to point to
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  pause a channel to stop it from sending updates
```

_See code: [packages/eas-cli/src/commands/channel/pause.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/pause.ts)_

## `eas channel:resume [NAME]`

resume a channel to start sending updates

```
USAGE
  $ eas channel:resume [NAME] [--branch <value>] [--json --non-interactive]

ARGUMENTS
  NAME  Name of the channel to edit

FLAGS
  --branch=<value>   Name of the branch to point to
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  resume a channel to start sending updates
```

_See code: [packages/eas-cli/src/commands/channel/resume.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/resume.ts)_

## `eas channel:rollout [CHANNEL]`

Roll a new branch out on a channel incrementally.

```
USAGE
  $ eas channel:rollout [CHANNEL] [--action create|edit|end|view] [--percent <value>] [--outcome
    republish-and-revert|revert] [--branch <value>] [--runtime-version <value>] [--private-key-path <value>] [--json
    --non-interactive]

ARGUMENTS
  CHANNEL  channel on which the rollout should be done

FLAGS
  --action=(create|edit|end|view)          Rollout action to perform
  --branch=<value>                         Branch to roll out. Use with --action=create
  --json                                   Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive                        Run the command in non-interactive mode.
  --outcome=(republish-and-revert|revert)  End outcome of rollout. Use with --action=end
  --percent=<value>                        Percent of users to send to the new branch. Use with --action=edit or
                                           --action=create
  --private-key-path=<value>               File containing the PEM-encoded private key corresponding to the certificate
                                           in expo-updates' configuration. Defaults to a file named "private-key.pem" in
                                           the certificate's directory. Only relevant if you are using code signing:
                                           https://docs.expo.dev/eas-update/code-signing/
  --runtime-version=<value>                Runtime version to target. Use with --action=create

DESCRIPTION
  Roll a new branch out on a channel incrementally.
```

_See code: [packages/eas-cli/src/commands/channel/rollout.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/rollout.ts)_

## `eas channel:view [NAME]`

view a channel

```
USAGE
  $ eas channel:view [NAME] [--json --non-interactive] [--offset <value>] [--limit <value>]

ARGUMENTS
  NAME  Name of the channel to view

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>    The number of items to fetch each query. Defaults to 50 and is capped at 100.
  --non-interactive  Run the command in non-interactive mode.
  --offset=<value>   Start queries from specified index. Use for paginating results. Defaults to 0.

DESCRIPTION
  view a channel
```

_See code: [packages/eas-cli/src/commands/channel/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/channel/view.ts)_

## `eas config`

display project configuration (app.json + eas.json)

```
USAGE
  $ eas config [-p android|ios] [-e <value>] [--json --non-interactive]

FLAGS
  -e, --profile=PROFILE_NAME    Name of the build profile from eas.json. Defaults to "production" if defined in
                                eas.json.
  -p, --platform=(android|ios)
  --json                        Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive             Run the command in non-interactive mode.

DESCRIPTION
  display project configuration (app.json + eas.json)
```

_See code: [packages/eas-cli/src/commands/config.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/config.ts)_

## `eas credentials`

manage credentials

```
USAGE
  $ eas credentials [-p android|ios]

FLAGS
  -p, --platform=(android|ios)

DESCRIPTION
  manage credentials
```

_See code: [packages/eas-cli/src/commands/credentials/index.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/credentials/index.ts)_

## `eas credentials:configure-build`

Set up credentials for building your project.

```
USAGE
  $ eas credentials:configure-build [-p android|ios] [-e <value>]

FLAGS
  -e, --profile=PROFILE_NAME    The name of the build profile in eas.json.
  -p, --platform=(android|ios)

DESCRIPTION
  Set up credentials for building your project.
```

_See code: [packages/eas-cli/src/commands/credentials/configure-build.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/credentials/configure-build.ts)_

## `eas deploy [options]`

deploy your Expo Router web build and API Routes

```
USAGE
  $ eas deploy [options]
  $ eas deploy --prod

FLAGS
  --alias=name           Custom alias to assign to the new deployment.
  --dry-run              Outputs a tarball of the new deployment instead of uploading it.
  --environment=<value>  Environment variable's environment, e.g. 'production', 'preview', 'development'
  --export-dir=dir       [default: dist] Directory where the Expo project was exported.
  --id=xyz123            Custom unique identifier for the new deployment.
  --json                 Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive      Run the command in non-interactive mode.
  --prod                 Create a new production deployment.

DESCRIPTION
  deploy your Expo Router web build and API Routes

ALIASES
  $ eas worker:deploy
```

_See code: [packages/eas-cli/src/commands/deploy/index.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/deploy/index.ts)_

## `eas deploy:alias`

Assign deployment aliases.

```
USAGE
  $ eas deploy:alias [--prod] [--alias <value>] [--id <value>] [--json --non-interactive]

FLAGS
  --alias=name       Custom alias to assign to the existing deployment.
  --id=xyz123        Unique identifier of an existing deployment.
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.
  --prod             Promote an existing deployment to production.

DESCRIPTION
  Assign deployment aliases.

ALIASES
  $ eas worker:alias
  $ eas deploy:promote
```

_See code: [packages/eas-cli/src/commands/deploy/alias/index.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/deploy/alias/index.ts)_

## `eas deploy:alias:delete [ALIAS_NAME]`

Delete deployment aliases.

```
USAGE
  $ eas deploy:alias:delete [ALIAS_NAME] [--json --non-interactive]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  Delete deployment aliases.

ALIASES
  $ eas worker:alias:delete
```

_See code: [packages/eas-cli/src/commands/deploy/alias/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/deploy/alias/delete.ts)_

## `eas deploy:delete [DEPLOYMENT_ID]`

Delete a deployment.

```
USAGE
  $ eas deploy:delete [DEPLOYMENT_ID] [--json --non-interactive]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  Delete a deployment.

ALIASES
  $ eas worker:delete
```

_See code: [packages/eas-cli/src/commands/deploy/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/deploy/delete.ts)_

## `eas deploy:promote`

Assign deployment aliases.

```
USAGE
  $ eas deploy:promote [--prod] [--alias <value>] [--id <value>] [--json --non-interactive]

FLAGS
  --alias=name       Custom alias to assign to the existing deployment.
  --id=xyz123        Unique identifier of an existing deployment.
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.
  --prod             Promote an existing deployment to production.

DESCRIPTION
  Assign deployment aliases.

ALIASES
  $ eas worker:alias
  $ eas deploy:promote
```

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create

DESCRIPTION
  register new Apple Devices to use for internal distribution
```

_See code: [packages/eas-cli/src/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/device/create.ts)_

## `eas device:delete`

remove a registered device from your account

```
USAGE
  $ eas device:delete [--apple-team-id <value>] [--udid <value>] [--json --non-interactive]

FLAGS
  --apple-team-id=<value>  The Apple team ID on which to find the device
  --json                   Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive        Run the command in non-interactive mode.
  --udid=<value>           The Apple device ID to disable

DESCRIPTION
  remove a registered device from your account
```

_See code: [packages/eas-cli/src/commands/device/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/device/delete.ts)_

## `eas device:list`

list all registered devices for your account

```
USAGE
  $ eas device:list [--apple-team-id <value>] [--offset <value>] [--limit <value>] [--json --non-interactive]

FLAGS
  --apple-team-id=<value>
  --json                   Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>          The number of items to fetch each query. Defaults to 50 and is capped at 100.
  --non-interactive        Run the command in non-interactive mode.
  --offset=<value>         Start queries from specified index. Use for paginating results. Defaults to 0.

DESCRIPTION
  list all registered devices for your account
```

_See code: [packages/eas-cli/src/commands/device/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/device/list.ts)_

## `eas device:rename`

rename a registered device

```
USAGE
  $ eas device:rename [--apple-team-id <value>] [--udid <value>] [--name <value>] [--json --non-interactive]

FLAGS
  --apple-team-id=<value>  The Apple team ID on which to find the device
  --json                   Enable JSON output, non-JSON messages will be printed to stderr.
  --name=<value>           The new name for the device
  --non-interactive        Run the command in non-interactive mode.
  --udid=<value>           The Apple device ID to rename

DESCRIPTION
  rename a registered device
```

_See code: [packages/eas-cli/src/commands/device/rename.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/device/rename.ts)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]

DESCRIPTION
  view a device for your project
```

_See code: [packages/eas-cli/src/commands/device/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/device/view.ts)_

## `eas diagnostics`

display environment info

```
USAGE
  $ eas diagnostics

DESCRIPTION
  display environment info
```

_See code: [packages/eas-cli/src/commands/diagnostics.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/diagnostics.ts)_

## `eas env:create [ENVIRONMENT]`

create an environment variable for the current project or account

```
USAGE
  $ eas env:create [ENVIRONMENT] [--name <value>] [--value <value>] [--force] [--type string|file] [--visibility
    plaintext|sensitive|secret] [--scope project|account] [--environment <value>] [--non-interactive]

ARGUMENTS
  ENVIRONMENT  Environment to create the variable in. Default environments are 'production', 'preview', and
               'development'.

FLAGS
  --environment=<value>...                   Environment variable's environment, e.g. 'production', 'preview',
                                             'development'
  --force                                    Overwrite existing variable
  --name=<value>                             Name of the variable
  --non-interactive                          Run the command in non-interactive mode.
  --scope=(project|account)                  [default: project] Scope for the variable
  --type=(string|file)                       The type of variable
  --value=<value>                            Text value or the variable
  --visibility=(plaintext|sensitive|secret)  Visibility of the variable

DESCRIPTION
  create an environment variable for the current project or account
```

_See code: [packages/eas-cli/src/commands/env/create.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/create.ts)_

## `eas env:delete [ENVIRONMENT]`

delete an environment variable for the current project or account

```
USAGE
  $ eas env:delete [ENVIRONMENT] [--variable-name <value>] [--variable-environment <value>] [--scope
    project|account] [--non-interactive]

ARGUMENTS
  ENVIRONMENT  Current environment of the variable to delete. Default environments are 'production', 'preview', and
               'development'.

FLAGS
  --non-interactive               Run the command in non-interactive mode.
  --scope=(project|account)       [default: project] Scope for the variable
  --variable-environment=<value>  Current environment of the variable to delete
  --variable-name=<value>         Name of the variable to delete

DESCRIPTION
  delete an environment variable for the current project or account
```

_See code: [packages/eas-cli/src/commands/env/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/delete.ts)_

## `eas env:exec ENVIRONMENT BASH_COMMAND`

execute a command with environment variables from the selected environment

```
USAGE
  $ eas env:exec ENVIRONMENT BASH_COMMAND [--non-interactive]

ARGUMENTS
  ENVIRONMENT   Environment to execute the command in. Default environments are 'production', 'preview', and
                'development'.
  BASH_COMMAND  bash command to execute with the environment variables from the environment

FLAGS
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  execute a command with environment variables from the selected environment
```

_See code: [packages/eas-cli/src/commands/env/exec.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/exec.ts)_

## `eas env:get [ENVIRONMENT]`

view an environment variable for the current project or account

```
USAGE
  $ eas env:get [ENVIRONMENT] [--variable-name <value>] [--variable-environment <value>] [--format
    long|short] [--scope project|account] [--non-interactive]

ARGUMENTS
  ENVIRONMENT  Current environment of the variable. Default environments are 'production', 'preview', and 'development'.

FLAGS
  --format=(long|short)           [default: short] Output format
  --non-interactive               Run the command in non-interactive mode.
  --scope=(project|account)       [default: project] Scope for the variable
  --variable-environment=<value>  Current environment of the variable
  --variable-name=<value>         Name of the variable

DESCRIPTION
  view an environment variable for the current project or account
```

_See code: [packages/eas-cli/src/commands/env/get.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/get.ts)_

## `eas env:list [ENVIRONMENT]`

list environment variables for the current project or account

```
USAGE
  $ eas env:list [ENVIRONMENT] [--include-sensitive] [--include-file-content] [--environment <value>]
    [--format long|short] [--scope project|account]

ARGUMENTS
  ENVIRONMENT  Environment to list the variables from. Default environments are 'production', 'preview', and
               'development'.

FLAGS
  --environment=<value>...   Environment variable's environment, e.g. 'production', 'preview', 'development'
  --format=(long|short)      [default: short] Output format
  --include-file-content     Display files content in the output
  --include-sensitive        Display sensitive values in the output
  --scope=(project|account)  [default: project] Scope for the variable

DESCRIPTION
  list environment variables for the current project or account
```

_See code: [packages/eas-cli/src/commands/env/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/list.ts)_

## `eas env:pull [ENVIRONMENT]`

pull environment variables for the selected environment to .env file

```
USAGE
  $ eas env:pull [ENVIRONMENT] [--non-interactive] [--environment <value>] [--path <value>]

ARGUMENTS
  ENVIRONMENT  Environment to pull variables from. Default environments are 'production', 'preview', and 'development'.

FLAGS
  --environment=<value>  Environment variable's environment, e.g. 'production', 'preview', 'development'
  --non-interactive      Run the command in non-interactive mode.
  --path=<value>         [default: .env.local] Path to the result `.env` file

DESCRIPTION
  pull environment variables for the selected environment to .env file
```

_See code: [packages/eas-cli/src/commands/env/pull.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/pull.ts)_

## `eas env:push [ENVIRONMENT]`

push environment variables from .env file to the selected environment

```
USAGE
  $ eas env:push [ENVIRONMENT] [--environment <value>] [--path <value>] [--force]

ARGUMENTS
  ENVIRONMENT  Environment to push variables to. Default environments are 'production', 'preview', and 'development'.

FLAGS
  --environment=<value>...  Environment variable's environment, e.g. 'production', 'preview', 'development'
  --force                   Skip confirmation and automatically override existing variables
  --path=<value>            [default: .env.local] Path to the input `.env` file

DESCRIPTION
  push environment variables from .env file to the selected environment
```

_See code: [packages/eas-cli/src/commands/env/push.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/push.ts)_

## `eas env:update [ENVIRONMENT]`

update an environment variable on the current project or account

```
USAGE
  $ eas env:update [ENVIRONMENT] [--variable-name <value>] [--variable-environment <value>] [--name <value>]
    [--value <value>] [--type string|file] [--visibility plaintext|sensitive|secret] [--scope project|account]
    [--environment <value>] [--non-interactive]

ARGUMENTS
  ENVIRONMENT  Current environment of the variable to update. Default environments are 'production', 'preview', and
               'development'.

FLAGS
  --environment=<value>...                   Environment variable's environment, e.g. 'production', 'preview',
                                             'development'
  --name=<value>                             New name of the variable
  --non-interactive                          Run the command in non-interactive mode.
  --scope=(project|account)                  [default: project] Scope for the variable
  --type=(string|file)                       The type of variable
  --value=<value>                            New value or the variable
  --variable-environment=<value>             Current environment of the variable to update
  --variable-name=<value>                    Current name of the variable
  --visibility=(plaintext|sensitive|secret)  Visibility of the variable

DESCRIPTION
  update an environment variable on the current project or account
```

_See code: [packages/eas-cli/src/commands/env/update.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/env/update.ts)_

## `eas fingerprint:compare [HASH1] [HASH2]`

compare fingerprints of the current project, builds, and updates

```
USAGE
  $ eas fingerprint:compare [HASH1] [HASH2] [--build-id <value>] [--update-id <value>] [--open] [--environment <value>]
    [--json --non-interactive]

ARGUMENTS
  HASH1  If provided alone, HASH1 is compared against the current project's fingerprint.
  HASH2  If two hashes are provided, HASH1 is compared against HASH2.

FLAGS
  --build-id=<value>...   Compare the fingerprint with the build with the specified ID
  --environment=<value>   If generating a fingerprint from the local directory, use the specified environment.
  --json                  Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive       Run the command in non-interactive mode.
  --open                  Open the fingerprint comparison in the browser
  --update-id=<value>...  Compare the fingerprint with the update with the specified ID

DESCRIPTION
  compare fingerprints of the current project, builds, and updates

EXAMPLES
  $ eas fingerprint:compare 	 # Compare fingerprints in interactive mode

  $ eas fingerprint:compare <FINGERPRINT-HASH> 	 # Compare fingerprint against local directory

  $ eas fingerprint:compare <FINGERPRINT-HASH-1> <FINGERPRINT-HASH-2> 	 # Compare provided fingerprints

  $ eas fingerprint:compare --build-id <BUILD-ID> 	 # Compare fingerprint from build against local directory

  $ eas fingerprint:compare --build-id <BUILD-ID> --environment production 	 # Compare fingerprint from build against local directory with the "production" environment

  $ eas fingerprint:compare --build-id <BUILD-ID-1> --build-id <BUILD-ID-2>	 # Compare fingerprint from a build against another build

  $ eas fingerprint:compare --build-id <BUILD-ID> --update-id <UPDATE-ID>	 # Compare fingerprint from build against fingerprint from update

  $ eas fingerprint:compare <FINGERPRINT-HASH> --update-id <UPDATE-ID> 	 # Compare fingerprint from update against provided fingerprint
```

_See code: [packages/eas-cli/src/commands/fingerprint/compare.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/fingerprint/compare.ts)_

## `eas fingerprint:generate`

generate fingerprints from the current project

```
USAGE
  $ eas fingerprint:generate [-p android|ios] [--environment <value> | -e <value>] [--json --non-interactive]

FLAGS
  -e, --build-profile=<value>   Name of the build profile from eas.json.
  -p, --platform=(android|ios)
  --environment=<value>         Environment variable's environment, e.g. 'production', 'preview', 'development'
  --json                        Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive             Run the command in non-interactive mode.

DESCRIPTION
  generate fingerprints from the current project

EXAMPLES
  $ eas fingerprint:generate  	 # Generate fingerprint in interactive mode

  $ eas fingerprint:generate --build-profile preview  	 # Generate a fingerprint using the "preview" build profile

  $ eas fingerprint:generate --environment preview  	 # Generate a fingerprint using the "preview" environment

  $ eas fingerprint:generate --json --non-interactive --platform android  	 # Output fingerprint json to stdout
```

_See code: [packages/eas-cli/src/commands/fingerprint/generate.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/fingerprint/generate.ts)_

## `eas help [COMMAND]`

Display help for eas.

```
USAGE
  $ eas help [COMMAND] [-n]

ARGUMENTS
  COMMAND  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for eas.
```

_See code: [@expo/plugin-help](https://github.com/expo/oclif-plugin-help/blob/v5.1.23/packages/eas-cli/src/commands/help.ts)_

## `eas init`

create or link an EAS project

```
USAGE
  $ eas init [--id <value>] [--force] [--non-interactive]

FLAGS
  --force            Whether to create a new project/link an existing project without additional prompts or overwrite
                     any existing project ID when running with --id flag
  --id=<value>       ID of the EAS project to link
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  create or link an EAS project

ALIASES
  $ eas init
```

## `eas init:onboarding [TARGET_PROJECT_DIRECTORY]`

continue onboarding process started on the https://expo.new website.

```
USAGE
  $ eas init:onboarding [TARGET_PROJECT_DIRECTORY]

DESCRIPTION
  continue onboarding process started on the https://expo.new website.

ALIASES
  $ eas init:onboarding
  $ eas onboarding
```

## `eas login`

log in with your Expo account

```
USAGE
  $ eas login [-s]

FLAGS
  -s, --sso  Login with SSO

DESCRIPTION
  log in with your Expo account

ALIASES
  $ eas login
```

## `eas logout`

log out

```
USAGE
  $ eas logout

DESCRIPTION
  log out

ALIASES
  $ eas logout
```

## `eas metadata:lint`

validate the local store configuration

```
USAGE
  $ eas metadata:lint [--json] [--profile <value>]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr
  --profile=<value>  Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.

DESCRIPTION
  validate the local store configuration
```

_See code: [packages/eas-cli/src/commands/metadata/lint.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/metadata/lint.ts)_

## `eas metadata:pull`

generate the local store configuration from the app stores

```
USAGE
  $ eas metadata:pull [-e <value>]

FLAGS
  -e, --profile=<value>  Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.

DESCRIPTION
  generate the local store configuration from the app stores
```

_See code: [packages/eas-cli/src/commands/metadata/pull.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/metadata/pull.ts)_

## `eas metadata:push`

sync the local store configuration to the app stores

```
USAGE
  $ eas metadata:push [-e <value>]

FLAGS
  -e, --profile=<value>  Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.

DESCRIPTION
  sync the local store configuration to the app stores
```

_See code: [packages/eas-cli/src/commands/metadata/push.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/metadata/push.ts)_

## `eas new [PATH]`

Create a new project configured with Expo Application Services (EAS)

```
USAGE
  $ eas new [PATH] [-p bun|npm|pnpm|yarn]

ARGUMENTS
  PATH  Path to create the project (defaults to current directory)

FLAGS
  -p, --package-manager=(bun|npm|pnpm|yarn)  [default: npm] Package manager to use for installing dependencies

DESCRIPTION
  Create a new project configured with Expo Application Services (EAS)

ALIASES
  $ eas new
```

## `eas onboarding [TARGET_PROJECT_DIRECTORY]`

continue onboarding process started on the https://expo.new website.

```
USAGE
  $ eas onboarding [TARGET_PROJECT_DIRECTORY]

DESCRIPTION
  continue onboarding process started on the https://expo.new website.

ALIASES
  $ eas init:onboarding
  $ eas onboarding
```

## `eas open`

open the project page in a web browser

```
USAGE
  $ eas open

DESCRIPTION
  open the project page in a web browser
```

_See code: [packages/eas-cli/src/commands/open.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/open.ts)_

## `eas project:info`

information about the current project

```
USAGE
  $ eas project:info

DESCRIPTION
  information about the current project
```

_See code: [packages/eas-cli/src/commands/project/info.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/project/info.ts)_

## `eas project:init`

create or link an EAS project

```
USAGE
  $ eas project:init [--id <value>] [--force] [--non-interactive]

FLAGS
  --force            Whether to create a new project/link an existing project without additional prompts or overwrite
                     any existing project ID when running with --id flag
  --id=<value>       ID of the EAS project to link
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  create or link an EAS project

ALIASES
  $ eas init
```

_See code: [packages/eas-cli/src/commands/project/init.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/project/init.ts)_

## `eas project:new [PATH]`

Create a new project configured with Expo Application Services (EAS)

```
USAGE
  $ eas project:new [PATH] [-p bun|npm|pnpm|yarn]

ARGUMENTS
  PATH  Path to create the project (defaults to current directory)

FLAGS
  -p, --package-manager=(bun|npm|pnpm|yarn)  [default: npm] Package manager to use for installing dependencies

DESCRIPTION
  Create a new project configured with Expo Application Services (EAS)

ALIASES
  $ eas new
```

_See code: [packages/eas-cli/src/commands/project/new.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/project/new.ts)_

## `eas project:onboarding [TARGET_PROJECT_DIRECTORY]`

continue onboarding process started on the https://expo.new website.

```
USAGE
  $ eas project:onboarding [TARGET_PROJECT_DIRECTORY]

DESCRIPTION
  continue onboarding process started on the https://expo.new website.

ALIASES
  $ eas init:onboarding
  $ eas onboarding
```

_See code: [packages/eas-cli/src/commands/project/onboarding.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/project/onboarding.ts)_

## `eas submit`

submit app binary to App Store and/or Play Store

```
USAGE
  $ eas submit [-p android|ios|all] [-e <value>] [--latest | --id <value> | --path <value> | --url <value>]
    [--what-to-test <value>] [--verbose] [--wait] [--verbose-fastlane] [-g <value>] [--non-interactive]

FLAGS
  -e, --profile=<value>             Name of the submit profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  -g, --groups=<value>...           Internal TestFlight testing groups to add the build to (iOS only). Learn more:
                                    https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-
                                    testers
  -p, --platform=(android|ios|all)
  --id=<value>                      ID of the build to submit
  --latest                          Submit the latest build for specified platform
  --non-interactive                 Run command in non-interactive mode
  --path=<value>                    Path to the .apk/.aab/.ipa file
  --url=<value>                     App archive url
  --verbose                         Always print logs from EAS Submit
  --verbose-fastlane                Enable verbose logging for the submission process
  --[no-]wait                       Wait for submission to complete
  --what-to-test=<value>            Sets the "What to test" information in TestFlight (iOS only).

DESCRIPTION
  submit app binary to App Store and/or Play Store

ALIASES
  $ eas build:submit
```

_See code: [packages/eas-cli/src/commands/submit.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/submit.ts)_

## `eas update`

publish an update group

```
USAGE
  $ eas update [--branch <value>] [--channel <value>] [-m <value>] [--input-dir <value>] [--skip-bundler]
    [--clear-cache] [--emit-metadata] [--rollout-percentage <value>] [-p android|ios|all] [--auto] [--private-key-path
    <value>] [--environment <value>] [--json --non-interactive]

FLAGS
  -m, --message=<value>             A short message describing the update
  -p, --platform=(android|ios|all)  [default: all]
  --auto                            Use the current git branch and commit message for the EAS branch and update message
  --branch=<value>                  Branch to publish the update group on
  --channel=<value>                 Channel that the published update should affect
  --clear-cache                     Clear the bundler cache before publishing
  --emit-metadata                   Emit "eas-update-metadata.json" in the bundle folder with detailed information about
                                    the generated updates
  --environment=<value>             Environment to use for the server-side defined EAS environment variables during
                                    command execution, e.g. "production", "preview", "development"
  --input-dir=<value>               [default: dist] Location of the bundle
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive                 Run the command in non-interactive mode.
  --private-key-path=<value>        File containing the PEM-encoded private key corresponding to the certificate in
                                    expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                                    certificate's directory. Only relevant if you are using code signing:
                                    https://docs.expo.dev/eas-update/code-signing/
  --rollout-percentage=<value>      Percentage of users this update should be immediately available to. Users not in the
                                    rollout will be served the previous latest update on the branch, even if that update
                                    is itself being rolled out. The specified number must be an integer between 1 and
                                    100. When not specified, this defaults to 100.
  --skip-bundler                    Skip running Expo CLI to bundle the app before publishing

DESCRIPTION
  publish an update group
```

_See code: [packages/eas-cli/src/commands/update/index.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/index.ts)_

## `eas update:configure`

configure the project to support EAS Update

```
USAGE
  $ eas update:configure [-p android|ios|all] [--environment <value>] [--non-interactive]

FLAGS
  -p, --platform=(android|ios|all)  [default: all] Platform to configure
  --environment=<value>             Environment to use for the server-side defined EAS environment variables during
                                    command execution, e.g. "production", "preview", "development"
  --non-interactive                 Run the command in non-interactive mode.

DESCRIPTION
  configure the project to support EAS Update
```

_See code: [packages/eas-cli/src/commands/update/configure.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/configure.ts)_

## `eas update:delete GROUPID`

delete all the updates in an update group

```
USAGE
  $ eas update:delete GROUPID [--json --non-interactive]

ARGUMENTS
  GROUPID  The ID of an update group to delete.

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  delete all the updates in an update group
```

_See code: [packages/eas-cli/src/commands/update/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/delete.ts)_

## `eas update:edit [GROUPID]`

edit all the updates in an update group

```
USAGE
  $ eas update:edit [GROUPID] [--rollout-percentage <value>] [--branch <value>] [--json --non-interactive]

ARGUMENTS
  GROUPID  The ID of an update group to edit.

FLAGS
  --branch=<value>              Branch for which to list updates to select from
  --json                        Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive             Run the command in non-interactive mode.
  --rollout-percentage=<value>  Rollout percentage to set for a rollout update. The specified number must be an integer
                                between 1 and 100.

DESCRIPTION
  edit all the updates in an update group
```

_See code: [packages/eas-cli/src/commands/update/edit.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/edit.ts)_

## `eas update:list`

view the recent updates

```
USAGE
  $ eas update:list [--branch <value> | --all] [--offset <value>] [--limit <value>] [--json --non-interactive]

FLAGS
  --all              List updates on all branches
  --branch=<value>   List updates only on this branch
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --limit=<value>    The number of items to fetch each query. Defaults to 25 and is capped at 50.
  --non-interactive  Run the command in non-interactive mode.
  --offset=<value>   Start queries from specified index. Use for paginating results. Defaults to 0.

DESCRIPTION
  view the recent updates
```

_See code: [packages/eas-cli/src/commands/update/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/list.ts)_

## `eas update:republish`

roll back to an existing update

```
USAGE
  $ eas update:republish [--channel <value> | --branch <value> | --group <value>] [--destination-channel <value> |
    --destination-branch <value>] [-m <value>] [-p android|ios|all] [--private-key-path <value>] [--rollout-percentage
    <value>] [--json --non-interactive]

FLAGS
  -m, --message=<value>             Short message describing the republished update group
  -p, --platform=(android|ios|all)  [default: all]
  --branch=<value>                  Branch name to select an update group to republish from
  --channel=<value>                 Channel name to select an update group to republish from
  --destination-branch=<value>      Branch name to republish to if republishing to a different branch
  --destination-channel=<value>     Channel name to select a branch to republish to if republishing to a different
                                    branch
  --group=<value>                   Update group ID to republish
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive                 Run the command in non-interactive mode.
  --private-key-path=<value>        File containing the PEM-encoded private key corresponding to the certificate in
                                    expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                                    certificate's directory. Only relevant if you are using code signing:
                                    https://docs.expo.dev/eas-update/code-signing/
  --rollout-percentage=<value>      Percentage of users this update should be immediately available to. Users not in the
                                    rollout will be served the previous latest update on the branch, even if that update
                                    is itself being rolled out. The specified number must be an integer between 1 and
                                    100. When not specified, this defaults to 100.

DESCRIPTION
  roll back to an existing update
```

_See code: [packages/eas-cli/src/commands/update/republish.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/republish.ts)_

## `eas update:revert-update-rollout`

revert a rollout update for a project

```
USAGE
  $ eas update:revert-update-rollout [--channel <value> | --branch <value> | --group <value>] [-m <value>] [--private-key-path
    <value>] [--json --non-interactive]

FLAGS
  -m, --message=<value>       Short message describing the revert
  --branch=<value>            Branch name to select an update group to revert the rollout update from
  --channel=<value>           Channel name to select an update group to revert the rollout update from
  --group=<value>             Rollout update group ID to revert
  --json                      Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive           Run the command in non-interactive mode.
  --private-key-path=<value>  File containing the PEM-encoded private key corresponding to the certificate in
                              expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                              certificate's directory. Only relevant if you are using code signing:
                              https://docs.expo.dev/eas-update/code-signing/

DESCRIPTION
  revert a rollout update for a project
```

_See code: [packages/eas-cli/src/commands/update/revert-update-rollout.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/revert-update-rollout.ts)_

## `eas update:roll-back-to-embedded`

roll back to the embedded update

```
USAGE
  $ eas update:roll-back-to-embedded [--branch <value>] [--channel <value>] [--runtime-version <value>] [--message <value>] [-p
    android|ios|all] [--private-key-path <value>] [--json --non-interactive]

FLAGS
  -p, --platform=(android|ios|all)  [default: all]
  --branch=<value>                  Branch to publish the rollback to embedded update group on
  --channel=<value>                 Channel that the published rollback to embedded update should affect
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --message=<value>                 A short message describing the rollback to embedded update
  --non-interactive                 Run the command in non-interactive mode.
  --private-key-path=<value>        File containing the PEM-encoded private key corresponding to the certificate in
                                    expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                                    certificate's directory. Only relevant if you are using code signing:
                                    https://docs.expo.dev/eas-update/code-signing/
  --runtime-version=<value>         Runtime version that the rollback to embedded update should target

DESCRIPTION
  roll back to the embedded update
```

_See code: [packages/eas-cli/src/commands/update/roll-back-to-embedded.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/roll-back-to-embedded.ts)_

## `eas update:rollback`

Roll back to an embedded update or an existing update. Users wishing to run this command non-interactively should instead execute "eas update:republish" or "eas update:roll-back-to-embedded".

```
USAGE
  $ eas update:rollback [--private-key-path <value>]

FLAGS
  --private-key-path=<value>  File containing the PEM-encoded private key corresponding to the certificate in
                              expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                              certificate's directory. Only relevant if you are using code signing:
                              https://docs.expo.dev/eas-update/code-signing/

DESCRIPTION
  Roll back to an embedded update or an existing update. Users wishing to run this command non-interactively should
  instead execute "eas update:republish" or "eas update:roll-back-to-embedded".
```

_See code: [packages/eas-cli/src/commands/update/rollback.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/rollback.ts)_

## `eas update:view GROUPID`

update group details

```
USAGE
  $ eas update:view GROUPID [--json]

ARGUMENTS
  GROUPID  The ID of an update group.

FLAGS
  --json  Enable JSON output, non-JSON messages will be printed to stderr.

DESCRIPTION
  update group details
```

_See code: [packages/eas-cli/src/commands/update/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/update/view.ts)_

## `eas upload`

upload a local build and generate a sharable link

```
USAGE
  $ eas upload [-p ios|android] [--build-path <value>] [--fingerprint <value>] [--json --non-interactive]

FLAGS
  -p, --platform=(ios|android)
  --build-path=<value>          Path for the local build
  --fingerprint=<value>         Fingerprint hash of the local build
  --json                        Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive             Run the command in non-interactive mode.

DESCRIPTION
  upload a local build and generate a sharable link
```

_See code: [packages/eas-cli/src/commands/upload.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/upload.ts)_

## `eas webhook:create`

create a webhook

```
USAGE
  $ eas webhook:create [--event BUILD|SUBMIT] [--url <value>] [--secret <value>] [--non-interactive]

FLAGS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
  --non-interactive       Run the command in non-interactive mode.
  --secret=<value>        Secret used to create a hash signature of the request payload, provided in the
                          'Expo-Signature' header.
  --url=<value>           Webhook URL

DESCRIPTION
  create a webhook
```

_See code: [packages/eas-cli/src/commands/webhook/create.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/webhook/create.ts)_

## `eas webhook:delete [ID]`

delete a webhook

```
USAGE
  $ eas webhook:delete [ID] [--non-interactive]

ARGUMENTS
  ID  ID of the webhook to delete

FLAGS
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  delete a webhook
```

_See code: [packages/eas-cli/src/commands/webhook/delete.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/webhook/delete.ts)_

## `eas webhook:list`

list webhooks

```
USAGE
  $ eas webhook:list [--event BUILD|SUBMIT] [--json]

FLAGS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
  --json                  Enable JSON output, non-JSON messages will be printed to stderr.

DESCRIPTION
  list webhooks
```

_See code: [packages/eas-cli/src/commands/webhook/list.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/webhook/list.ts)_

## `eas webhook:update`

update a webhook

```
USAGE
  $ eas webhook:update --id <value> [--event BUILD|SUBMIT] [--url <value>] [--secret <value>] [--non-interactive]

FLAGS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
  --id=<value>            (required) Webhook ID
  --non-interactive       Run the command in non-interactive mode.
  --secret=<value>        Secret used to create a hash signature of the request payload, provided in the
                          'Expo-Signature' header.
  --url=<value>           Webhook URL

DESCRIPTION
  update a webhook
```

_See code: [packages/eas-cli/src/commands/webhook/update.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/webhook/update.ts)_

## `eas webhook:view ID`

view a webhook

```
USAGE
  $ eas webhook:view ID

ARGUMENTS
  ID  ID of the webhook to view

DESCRIPTION
  view a webhook
```

_See code: [packages/eas-cli/src/commands/webhook/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/webhook/view.ts)_

## `eas whoami`

show the username you are logged in as

```
USAGE
  $ eas whoami

DESCRIPTION
  show the username you are logged in as

ALIASES
  $ eas whoami
```

## `eas worker:alias`

Assign deployment aliases.

```
USAGE
  $ eas worker:alias [--prod] [--alias <value>] [--id <value>] [--json --non-interactive]

FLAGS
  --alias=name       Custom alias to assign to the existing deployment.
  --id=xyz123        Unique identifier of an existing deployment.
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.
  --prod             Promote an existing deployment to production.

DESCRIPTION
  Assign deployment aliases.

ALIASES
  $ eas worker:alias
  $ eas deploy:promote
```

## `eas worker:alias:delete [ALIAS_NAME]`

Delete deployment aliases.

```
USAGE
  $ eas worker:alias:delete [ALIAS_NAME] [--json --non-interactive]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  Delete deployment aliases.

ALIASES
  $ eas worker:alias:delete
```

## `eas worker:delete [DEPLOYMENT_ID]`

Delete a deployment.

```
USAGE
  $ eas worker:delete [DEPLOYMENT_ID] [--json --non-interactive]

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  Delete a deployment.

ALIASES
  $ eas worker:delete
```

## `eas deploy [options]`

deploy your Expo Router web build and API Routes

```
USAGE
  $ eas deploy [options]
  $ eas deploy --prod

FLAGS
  --alias=name           Custom alias to assign to the new deployment.
  --dry-run              Outputs a tarball of the new deployment instead of uploading it.
  --environment=<value>  Environment variable's environment, e.g. 'production', 'preview', 'development'
  --export-dir=dir       [default: dist] Directory where the Expo project was exported.
  --id=xyz123            Custom unique identifier for the new deployment.
  --json                 Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive      Run the command in non-interactive mode.
  --prod                 Create a new production deployment.

DESCRIPTION
  deploy your Expo Router web build and API Routes

ALIASES
  $ eas worker:deploy
```

## `eas workflow:cancel`

Cancel one or more workflow runs. If no workflow run IDs are provided, you will be prompted to select IN_PROGRESS runs to cancel.

```
USAGE
  $ eas workflow:cancel [--non-interactive]

FLAGS
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  Cancel one or more workflow runs. If no workflow run IDs are provided, you will be prompted to select IN_PROGRESS runs
  to cancel.
```

_See code: [packages/eas-cli/src/commands/workflow/cancel.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/cancel.ts)_

## `eas workflow:create [NAME]`

create a new workflow configuration YAML file

```
USAGE
  $ eas workflow:create [NAME] [--skip-validation]

ARGUMENTS
  NAME  Name of the workflow file (must end with .yml or .yaml)

FLAGS
  --skip-validation  If set, the workflow file will not be validated before being created

DESCRIPTION
  create a new workflow configuration YAML file
```

_See code: [packages/eas-cli/src/commands/workflow/create.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/create.ts)_

## `eas workflow:logs [ID]`

view logs for a workflow run, selecting a job and step to view. You can pass in either a workflow run ID or a job ID. If no ID is passed in, you will be prompted to select from recent workflow runs for the current project.

```
USAGE
  $ eas workflow:logs [ID] [--json] [--non-interactive] [--all-steps]

ARGUMENTS
  ID  ID of the workflow run or workflow job to view logs for

FLAGS
  --all-steps        Print all logs, rather than prompting for a specific step. This will be automatically set when in
                     non-interactive mode.
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  view logs for a workflow run, selecting a job and step to view. You can pass in either a workflow run ID or a job ID.
  If no ID is passed in, you will be prompted to select from recent workflow runs for the current project.
```

_See code: [packages/eas-cli/src/commands/workflow/logs.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/logs.ts)_

## `eas workflow:run [FILE]`

run an EAS workflow. The entire local project directory will be packaged and uploaded to EAS servers for the workflow run, unless the --ref flag is used.

```
USAGE
  $ eas workflow:run [FILE] [--non-interactive] [--wait] [-F <value>] [--ref <value>] [--json]

ARGUMENTS
  FILE  Path to the workflow file to run

FLAGS
  -F, --input=<value>...  Set workflow inputs
  --json                  Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive       Run the command in non-interactive mode.
  --ref=<value>           Git reference to run the workflow on
  --[no-]wait             Wait for workflow run to complete. Defaults to false.

DESCRIPTION
  run an EAS workflow. The entire local project directory will be packaged and uploaded to EAS servers for the workflow
  run, unless the --ref flag is used.

FLAG DESCRIPTIONS
  -F, --input=<value>...  Set workflow inputs

    Add a parameter in key=value format. Use multiple instances of this flag to set multiple inputs.

  --ref=<value>  Git reference to run the workflow on

    The git reference must exist in the project's git repository, and the workflow file must exist at that reference.
    When this flag is used, the local project is not uploaded; instead, the workflow is run from the exact state of the
    project at the chosen reference.

  --[no-]wait  Wait for workflow run to complete. Defaults to false.

    Exit codes: 0 = success, 11 = failure, 12 = canceled, 13 = wait aborted.
```

_See code: [packages/eas-cli/src/commands/workflow/run.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/run.ts)_

## `eas workflow:runs`

list recent workflow runs for this project, with their IDs, statuses, and timestamps

```
USAGE
  $ eas workflow:runs [--workflow <value>] [--status ACTION_REQUIRED|CANCELED|FAILURE|IN_PROGRESS|NEW|SUCCESS]
    [--json] [--limit <value>]

FLAGS
  --json                                                               Enable JSON output, non-JSON messages will be
                                                                       printed to stderr.
  --limit=<value>                                                      The number of items to fetch each query. Defaults
                                                                       to 10 and is capped at 100.
  --status=(ACTION_REQUIRED|CANCELED|FAILURE|IN_PROGRESS|NEW|SUCCESS)  If present, filter the returned runs to select
                                                                       those with the specified status
  --workflow=<value>                                                   If present, the query will only return runs for
                                                                       the specified workflow file name

DESCRIPTION
  list recent workflow runs for this project, with their IDs, statuses, and timestamps
```

_See code: [packages/eas-cli/src/commands/workflow/runs.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/runs.ts)_

## `eas workflow:status [WORKFLOW_RUN_ID]`

show the status of an existing workflow run. If no run ID is provided, you will be prompted to select from recent workflow runs for the current project.

```
USAGE
  $ eas workflow:status [WORKFLOW_RUN_ID] [--non-interactive] [--wait] [--json]

ARGUMENTS
  WORKFLOW_RUN_ID  A workflow run ID.

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.
  --[no-]wait        Wait for workflow run to complete. Defaults to false.

DESCRIPTION
  show the status of an existing workflow run. If no run ID is provided, you will be prompted to select from recent
  workflow runs for the current project.

FLAG DESCRIPTIONS
  --[no-]wait  Wait for workflow run to complete. Defaults to false.

    Exit codes: 0 = success, 11 = failure, 12 = canceled, 13 = wait aborted.
```

_See code: [packages/eas-cli/src/commands/workflow/status.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/status.ts)_

## `eas workflow:validate PATH`

validate a workflow configuration yaml file

```
USAGE
  $ eas workflow:validate PATH [--non-interactive]

ARGUMENTS
  PATH  Path to the workflow configuration YAML file (must end with .yml or .yaml)

FLAGS
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  validate a workflow configuration yaml file
```

_See code: [packages/eas-cli/src/commands/workflow/validate.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/validate.ts)_

## `eas workflow:view [ID]`

view details for a workflow run, including jobs. If no run ID is provided, you will be prompted to select from recent workflow runs for the current project.

```
USAGE
  $ eas workflow:view [ID] [--json] [--non-interactive]

ARGUMENTS
  ID  ID of the workflow run to view

FLAGS
  --json             Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  view details for a workflow run, including jobs. If no run ID is provided, you will be prompted to select from recent
  workflow runs for the current project.
```

_See code: [packages/eas-cli/src/commands/workflow/view.ts](https://github.com/expo/eas-cli/blob/v16.28.0/packages/eas-cli/src/commands/workflow/view.ts)_
<!-- commandsstop -->

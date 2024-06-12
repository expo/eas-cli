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

Learn more: https://docs.expo.dev/build-reference/eas-json/

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
* [`eas channel:edit [NAME]`](#eas-channeledit-name)
* [`eas channel:list`](#eas-channellist)
* [`eas channel:rollout [CHANNEL]`](#eas-channelrollout-channel)
* [`eas channel:view [NAME]`](#eas-channelview-name)
* [`eas config`](#eas-config)
* [`eas credentials`](#eas-credentials)
* [`eas credentials:configure-build`](#eas-credentialsconfigure-build)
* [`eas device:create`](#eas-devicecreate)
* [`eas device:delete`](#eas-devicedelete)
* [`eas device:list`](#eas-devicelist)
* [`eas device:rename`](#eas-devicerename)
* [`eas device:view [UDID]`](#eas-deviceview-udid)
* [`eas diagnostics`](#eas-diagnostics)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas init`](#eas-init)
* [`eas init:onboarding [TARGET_PROJECT_DIRECTORY]`](#eas-initonboarding-target_project_directory)
* [`eas login`](#eas-login)
* [`eas logout`](#eas-logout)
* [`eas metadata:lint`](#eas-metadatalint)
* [`eas metadata:pull`](#eas-metadatapull)
* [`eas metadata:push`](#eas-metadatapush)
* [`eas onboarding [TARGET_PROJECT_DIRECTORY]`](#eas-onboarding-target_project_directory)
* [`eas open`](#eas-open)
* [`eas project:info`](#eas-projectinfo)
* [`eas project:init`](#eas-projectinit)
* [`eas project:onboarding [TARGET_PROJECT_DIRECTORY]`](#eas-projectonboarding-target_project_directory)
* [`eas secret:create`](#eas-secretcreate)
* [`eas secret:delete`](#eas-secretdelete)
* [`eas secret:list`](#eas-secretlist)
* [`eas secret:push`](#eas-secretpush)
* [`eas submit`](#eas-submit)
* [`eas update`](#eas-update)
* [`eas update:configure`](#eas-updateconfigure)
* [`eas update:delete GROUPID`](#eas-updatedelete-groupid)
* [`eas update:list`](#eas-updatelist)
* [`eas update:republish`](#eas-updaterepublish)
* [`eas update:roll-back-to-embedded`](#eas-updateroll-back-to-embedded)
* [`eas update:rollback`](#eas-updaterollback)
* [`eas update:view GROUPID`](#eas-updateview-groupid)
* [`eas webhook:create`](#eas-webhookcreate)
* [`eas webhook:delete [ID]`](#eas-webhookdelete-id)
* [`eas webhook:list`](#eas-webhooklist)
* [`eas webhook:update`](#eas-webhookupdate)
* [`eas webhook:view ID`](#eas-webhookview-id)
* [`eas whoami`](#eas-whoami)

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

_See code: [packages/eas-cli/src/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/account/login.ts)_

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

_See code: [packages/eas-cli/src/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/account/logout.ts)_

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

_See code: [packages/eas-cli/src/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/account/view.ts)_

## `eas analytics [STATUS]`

display or change analytics settings

```
USAGE
  $ eas analytics [STATUS]

DESCRIPTION
  display or change analytics settings
```

_See code: [packages/eas-cli/src/commands/analytics.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/analytics.ts)_

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

_See code: [packages/eas-cli/src/commands/branch/create.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/branch/create.ts)_

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

_See code: [packages/eas-cli/src/commands/branch/delete.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/branch/delete.ts)_

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

_See code: [packages/eas-cli/src/commands/branch/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/branch/list.ts)_

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

_See code: [packages/eas-cli/src/commands/branch/rename.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/branch/rename.ts)_

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

_See code: [packages/eas-cli/src/commands/branch/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/branch/view.ts)_

## `eas build`

start a build

```
USAGE
  $ eas build [-p android|ios|all] [-e <value>] [--local] [--output <value>] [--wait] [--clear-cache]
    [--auto-submit | --auto-submit-with-profile <value>] [-m <value>] [--build-logger-level
    trace|debug|info|warn|error|fatal] [--freeze-credentials] [--json --non-interactive]

FLAGS
  -e, --profile=PROFILE_NAME                                Name of the build profile from eas.json. Defaults to
                                                            "production" if defined in eas.json.
  -m, --message=<value>                                     A short message describing the build
  -p, --platform=(android|ios|all)
  --auto-submit                                             Submit on build complete using the submit profile with the
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
  --[no-]wait                                               Wait for build(s) to complete

DESCRIPTION
  start a build
```

_See code: [packages/eas-cli/src/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/index.ts)_

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

_See code: [packages/eas-cli/src/commands/build/cancel.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/cancel.ts)_

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

_See code: [packages/eas-cli/src/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/configure.ts)_

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

_See code: [packages/eas-cli/src/commands/build/delete.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/delete.ts)_

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

_See code: [packages/eas-cli/src/commands/build/inspect.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/inspect.ts)_

## `eas build:list`

list all builds for your project

```
USAGE
  $ eas build:list [-p android|ios|all] [--status
    new|in-queue|in-progress|pending-cancel|errored|finished|canceled] [--distribution store|internal|simulator]
    [--channel <value>] [--app-version <value>] [--app-build-version <value>] [--sdk-version <value>] [--runtime-version
    <value>] [--app-identifier <value>] [-e <value>] [--git-commit-hash <value>] [--offset <value>] [--limit <value>]
    [--json --non-interactive] [--simulator]

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

_See code: [packages/eas-cli/src/commands/build/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/list.ts)_

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

_See code: [packages/eas-cli/src/commands/build/resign.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/resign.ts)_

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

_See code: [packages/eas-cli/src/commands/build/run.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/run.ts)_

## `eas build:submit`

submit app binary to App Store and/or Play Store

```
USAGE
  $ eas build:submit [-p android|ios|all] [-e <value>] [--latest | --id <value> | --path <value> | --url <value>]
    [--verbose] [--wait] [--verbose-fastlane] [--non-interactive]

FLAGS
  -e, --profile=<value>             Name of the submit profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  -p, --platform=(android|ios|all)
  --id=<value>                      ID of the build to submit
  --latest                          Submit the latest build for specified platform
  --non-interactive                 Run command in non-interactive mode
  --path=<value>                    Path to the .apk/.aab/.ipa file
  --url=<value>                     App archive url
  --verbose                         Always print logs from EAS Submit
  --verbose-fastlane                Enable verbose logging for the submission process
  --[no-]wait                       Wait for submission to complete

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

_See code: [packages/eas-cli/src/commands/build/version/get.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/version/get.ts)_

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

_See code: [packages/eas-cli/src/commands/build/version/set.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/version/set.ts)_

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

_See code: [packages/eas-cli/src/commands/build/version/sync.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/version/sync.ts)_

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

_See code: [packages/eas-cli/src/commands/build/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/build/view.ts)_

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

_See code: [packages/eas-cli/src/commands/channel/create.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/channel/create.ts)_

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

_See code: [packages/eas-cli/src/commands/channel/edit.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/channel/edit.ts)_

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

_See code: [packages/eas-cli/src/commands/channel/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/channel/list.ts)_

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
                                           the certificate's directory.
  --runtime-version=<value>                Runtime version to target. Use with --action=create

DESCRIPTION
  Roll a new branch out on a channel incrementally.
```

_See code: [packages/eas-cli/src/commands/channel/rollout.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/channel/rollout.ts)_

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

_See code: [packages/eas-cli/src/commands/channel/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/channel/view.ts)_

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

_See code: [packages/eas-cli/src/commands/config.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/config.ts)_

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

_See code: [packages/eas-cli/src/commands/credentials/index.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/credentials/index.ts)_

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

_See code: [packages/eas-cli/src/commands/credentials/configure-build.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/credentials/configure-build.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create

DESCRIPTION
  register new Apple Devices to use for internal distribution
```

_See code: [packages/eas-cli/src/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/device/create.ts)_

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

_See code: [packages/eas-cli/src/commands/device/delete.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/device/delete.ts)_

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

_See code: [packages/eas-cli/src/commands/device/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/device/list.ts)_

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

_See code: [packages/eas-cli/src/commands/device/rename.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/device/rename.ts)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]

DESCRIPTION
  view a device for your project
```

_See code: [packages/eas-cli/src/commands/device/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/device/view.ts)_

## `eas diagnostics`

display environment info

```
USAGE
  $ eas diagnostics

DESCRIPTION
  display environment info
```

_See code: [packages/eas-cli/src/commands/diagnostics.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/diagnostics.ts)_

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
  $ eas init [--force --id <value>] [--non-interactive ]

FLAGS
  --force            Whether to overwrite any existing project ID
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

_See code: [packages/eas-cli/src/commands/metadata/lint.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/metadata/lint.ts)_

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

_See code: [packages/eas-cli/src/commands/metadata/pull.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/metadata/pull.ts)_

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

_See code: [packages/eas-cli/src/commands/metadata/push.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/metadata/push.ts)_

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

_See code: [packages/eas-cli/src/commands/open.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/open.ts)_

## `eas project:info`

information about the current project

```
USAGE
  $ eas project:info

DESCRIPTION
  information about the current project
```

_See code: [packages/eas-cli/src/commands/project/info.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/project/info.ts)_

## `eas project:init`

create or link an EAS project

```
USAGE
  $ eas project:init [--force --id <value>] [--non-interactive ]

FLAGS
  --force            Whether to overwrite any existing project ID
  --id=<value>       ID of the EAS project to link
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  create or link an EAS project

ALIASES
  $ eas init
```

_See code: [packages/eas-cli/src/commands/project/init.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/project/init.ts)_

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

_See code: [packages/eas-cli/src/commands/project/onboarding.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/project/onboarding.ts)_

## `eas secret:create`

create an environment secret on the current project or owner account

```
USAGE
  $ eas secret:create [--scope account|project] [--name <value>] [--value <value>] [--type string|file] [--force]
    [--non-interactive]

FLAGS
  --force                    Delete and recreate existing secrets
  --name=<value>             Name of the secret
  --non-interactive          Run the command in non-interactive mode.
  --scope=(account|project)  [default: project] Scope for the secret
  --type=(string|file)       The type of secret
  --value=<value>            Text value or path to a file to store in the secret

DESCRIPTION
  create an environment secret on the current project or owner account
```

_See code: [packages/eas-cli/src/commands/secret/create.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/secret/create.ts)_

## `eas secret:delete`

delete an environment secret by ID

```
USAGE
  $ eas secret:delete [--id <value>] [--non-interactive]

FLAGS
  --id=<value>       ID of the secret to delete
  --non-interactive  Run the command in non-interactive mode.

DESCRIPTION
  delete an environment secret by ID
```

_See code: [packages/eas-cli/src/commands/secret/delete.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/secret/delete.ts)_

## `eas secret:list`

list environment secrets available for your current app

```
USAGE
  $ eas secret:list

DESCRIPTION
  list environment secrets available for your current app
```

_See code: [packages/eas-cli/src/commands/secret/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/secret/list.ts)_

## `eas secret:push`

read environment secrets from env file and store on the server

```
USAGE
  $ eas secret:push [--scope account|project] [--env-file <value>] [--force] [--non-interactive]

FLAGS
  --env-file=<value>         Env file with secrets
  --force                    Delete and recreate existing secrets
  --non-interactive          Run the command in non-interactive mode.
  --scope=(account|project)  [default: project] Scope for the secrets

DESCRIPTION
  read environment secrets from env file and store on the server
```

_See code: [packages/eas-cli/src/commands/secret/push.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/secret/push.ts)_

## `eas submit`

submit app binary to App Store and/or Play Store

```
USAGE
  $ eas submit [-p android|ios|all] [-e <value>] [--latest | --id <value> | --path <value> | --url <value>]
    [--verbose] [--wait] [--verbose-fastlane] [--non-interactive]

FLAGS
  -e, --profile=<value>             Name of the submit profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  -p, --platform=(android|ios|all)
  --id=<value>                      ID of the build to submit
  --latest                          Submit the latest build for specified platform
  --non-interactive                 Run command in non-interactive mode
  --path=<value>                    Path to the .apk/.aab/.ipa file
  --url=<value>                     App archive url
  --verbose                         Always print logs from EAS Submit
  --verbose-fastlane                Enable verbose logging for the submission process
  --[no-]wait                       Wait for submission to complete

DESCRIPTION
  submit app binary to App Store and/or Play Store

ALIASES
  $ eas build:submit
```

_See code: [packages/eas-cli/src/commands/submit.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/submit.ts)_

## `eas update`

publish an update group

```
USAGE
  $ eas update [--branch <value>] [--channel <value>] [-m <value>] [--republish | --input-dir <value> |
    --skip-bundler] [--group <value> |  | ] [--clear-cache] [-p android|ios|all] [--auto] [--private-key-path <value>]
    [--json --non-interactive]

FLAGS
  -m, --message=<value>             A short message describing the update
  -p, --platform=(android|ios|all)  [default: all]
  --auto                            Use the current git branch and commit message for the EAS branch and update message
  --branch=<value>                  Branch to publish the update group on
  --channel=<value>                 Channel that the published update should affect
  --clear-cache                     Clear the bundler cache before publishing
  --group=<value>                   Update group to republish (deprecated, see republish command)
  --input-dir=<value>               [default: dist] Location of the bundle
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive                 Run the command in non-interactive mode.
  --private-key-path=<value>        File containing the PEM-encoded private key corresponding to the certificate in
                                    expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                                    certificate's directory.
  --republish                       Republish an update group (deprecated, see republish command)
  --skip-bundler                    Skip running Expo CLI to bundle the app before publishing

DESCRIPTION
  publish an update group
```

_See code: [packages/eas-cli/src/commands/update/index.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/index.ts)_

## `eas update:configure`

configure the project to support EAS Update

```
USAGE
  $ eas update:configure [-p android|ios|all] [--non-interactive]

FLAGS
  -p, --platform=(android|ios|all)  [default: all] Platform to configure
  --non-interactive                 Run the command in non-interactive mode.

DESCRIPTION
  configure the project to support EAS Update
```

_See code: [packages/eas-cli/src/commands/update/configure.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/configure.ts)_

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

_See code: [packages/eas-cli/src/commands/update/delete.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/delete.ts)_

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

_See code: [packages/eas-cli/src/commands/update/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/list.ts)_

## `eas update:republish`

roll back to an existing update

```
USAGE
  $ eas update:republish [--channel <value> | --branch <value> | --group <value>] [-m <value>] [-p android|ios|all]
    [--private-key-path <value>] [--json --non-interactive]

FLAGS
  -m, --message=<value>             Short message describing the republished update group
  -p, --platform=(android|ios|all)  [default: all]
  --branch=<value>                  Branch name to select an update group to republish from
  --channel=<value>                 Channel name to select an update group to republish from
  --group=<value>                   Update group ID to republish
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --non-interactive                 Run the command in non-interactive mode.
  --private-key-path=<value>        File containing the PEM-encoded private key corresponding to the certificate in
                                    expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                                    certificate's directory.

DESCRIPTION
  roll back to an existing update
```

_See code: [packages/eas-cli/src/commands/update/republish.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/republish.ts)_

## `eas update:roll-back-to-embedded`

roll back to the embedded update

```
USAGE
  $ eas update:roll-back-to-embedded [--branch <value>] [--channel <value>] [--message <value>] [-p android|ios|all] [--auto]
    [--private-key-path <value>] [--json --non-interactive]

FLAGS
  -p, --platform=(android|ios|all)  [default: all]
  --auto                            Use the current git branch and commit message for the EAS branch and update message
  --branch=<value>                  Branch to publish the rollback to embedded update group on
  --channel=<value>                 Channel that the published rollback to embedded update should affect
  --json                            Enable JSON output, non-JSON messages will be printed to stderr.
  --message=<value>                 A short message describing the rollback to embedded update
  --non-interactive                 Run the command in non-interactive mode.
  --private-key-path=<value>        File containing the PEM-encoded private key corresponding to the certificate in
                                    expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                                    certificate's directory.

DESCRIPTION
  roll back to the embedded update
```

_See code: [packages/eas-cli/src/commands/update/roll-back-to-embedded.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/roll-back-to-embedded.ts)_

## `eas update:rollback`

roll back to an embedded update or an existing update

```
USAGE
  $ eas update:rollback [--private-key-path <value>]

FLAGS
  --private-key-path=<value>  File containing the PEM-encoded private key corresponding to the certificate in
                              expo-updates' configuration. Defaults to a file named "private-key.pem" in the
                              certificate's directory.

DESCRIPTION
  roll back to an embedded update or an existing update
```

_See code: [packages/eas-cli/src/commands/update/rollback.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/rollback.ts)_

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

_See code: [packages/eas-cli/src/commands/update/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/update/view.ts)_

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

_See code: [packages/eas-cli/src/commands/webhook/create.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/webhook/create.ts)_

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

_See code: [packages/eas-cli/src/commands/webhook/delete.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/webhook/delete.ts)_

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

_See code: [packages/eas-cli/src/commands/webhook/list.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/webhook/list.ts)_

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

_See code: [packages/eas-cli/src/commands/webhook/update.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/webhook/update.ts)_

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

_See code: [packages/eas-cli/src/commands/webhook/view.ts](https://github.com/expo/eas-cli/blob/v9.2.0/packages/eas-cli/src/commands/webhook/view.ts)_

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
<!-- commandsstop -->

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
* [`eas branch:create [NAME]`](#eas-branchcreate-name)
* [`eas branch:delete [NAME]`](#eas-branchdelete-name)
* [`eas branch:list`](#eas-branchlist)
* [`eas branch:rename`](#eas-branchrename)
* [`eas branch:view [NAME]`](#eas-branchview-name)
* [`eas build`](#eas-build)
* [`eas build:cancel [BUILD_ID]`](#eas-buildcancel-build_id)
* [`eas build:configure`](#eas-buildconfigure)
* [`eas build:inspect`](#eas-buildinspect)
* [`eas build:list`](#eas-buildlist)
* [`eas build:view [BUILD_ID]`](#eas-buildview-build_id)
* [`eas channel:create [NAME]`](#eas-channelcreate-name)
* [`eas channel:edit [NAME]`](#eas-channeledit-name)
* [`eas channel:list`](#eas-channellist)
* [`eas channel:view [NAME]`](#eas-channelview-name)
* [`eas config`](#eas-config)
* [`eas credentials`](#eas-credentials)
* [`eas device:create`](#eas-devicecreate)
* [`eas device:list`](#eas-devicelist)
* [`eas device:view [UDID]`](#eas-deviceview-udid)
* [`eas diagnostics`](#eas-diagnostics)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas project:info`](#eas-projectinfo)
* [`eas project:init`](#eas-projectinit)
* [`eas secret:create`](#eas-secretcreate)
* [`eas secret:delete`](#eas-secretdelete)
* [`eas secret:list`](#eas-secretlist)
* [`eas submit`](#eas-submit)
* [`eas update`](#eas-update)
* [`eas update:configure`](#eas-updateconfigure)
* [`eas update:delete GROUPID`](#eas-updatedelete-groupid)
* [`eas update:view GROUPID`](#eas-updateview-groupid)
* [`eas webhook:create`](#eas-webhookcreate)
* [`eas webhook:delete [ID]`](#eas-webhookdelete-id)
* [`eas webhook:list`](#eas-webhooklist)
* [`eas webhook:update`](#eas-webhookupdate)
* [`eas webhook:view ID`](#eas-webhookview-id)

## `eas account:login`

log in with your Expo account

```
USAGE
  $ eas account:login

DESCRIPTION
  log in with your Expo account

ALIASES
  $ eas login
```

_See code: [src/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/account/login.ts)_

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

_See code: [src/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/account/logout.ts)_

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

_See code: [src/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/account/view.ts)_

## `eas analytics [STATUS]`

view or change analytics settings

```
USAGE
  $ eas analytics [STATUS]

DESCRIPTION
  view or change analytics settings
```

_See code: [src/commands/analytics.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/analytics.ts)_

## `eas branch:create [NAME]`

Create a branch on the current project.

```
USAGE
  $ eas branch:create [NAME] [--json]

ARGUMENTS
  NAME  Name of the branch to create

FLAGS
  --json  return a json with the new branch ID and name.

DESCRIPTION
  Create a branch on the current project.
```

_See code: [src/commands/branch/create.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/branch/create.ts)_

## `eas branch:delete [NAME]`

Delete a branch on the current project

```
USAGE
  $ eas branch:delete [NAME] [--json]

ARGUMENTS
  NAME  Name of the branch to delete

FLAGS
  --json  return JSON with the edited branch's ID and name.

DESCRIPTION
  Delete a branch on the current project
```

_See code: [src/commands/branch/delete.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/branch/delete.ts)_

## `eas branch:list`

List all branches on this project.

```
USAGE
  $ eas branch:list [--json]

FLAGS
  --json  return output as JSON

DESCRIPTION
  List all branches on this project.
```

_See code: [src/commands/branch/list.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/branch/list.ts)_

## `eas branch:rename`

Rename a branch.

```
USAGE
  $ eas branch:rename [--from <value>] [--to <value>] [--json]

FLAGS
  --from=<value>  current name of the branch.
  --json          return a json with the edited branch's ID and name.
  --to=<value>    new name of the branch.

DESCRIPTION
  Rename a branch.
```

_See code: [src/commands/branch/rename.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/branch/rename.ts)_

## `eas branch:view [NAME]`

View a branch.

```
USAGE
  $ eas branch:view [NAME] [--json]

ARGUMENTS
  NAME  Name of the branch to view

FLAGS
  --json  return a json with the branch's ID name and recent update groups.

DESCRIPTION
  View a branch.
```

_See code: [src/commands/branch/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/branch/view.ts)_

## `eas build`

Start a build

```
USAGE
  $ eas build [-p android|ios|all] [--json] [--skip-project-configuration] [--profile <value>]
    [--non-interactive] [--local] [--wait] [--clear-cache] [--auto-submit | --auto-submit-with-profile <value>]

FLAGS
  -p, --platform=(android|ios|all)
  --auto-submit                            Submit on build complete using the submit profile with the same name as the
                                           build profile
  --auto-submit-with-profile=PROFILE_NAME  Submit on build complete using the submit profile with provided name
  --clear-cache                            Clear cache before the build
  --json                                   Enable JSON output, non-JSON messages will be printed to stderr
  --local                                  Run build locally [experimental]
  --non-interactive                        Run command in non-interactive mode
  --profile=PROFILE_NAME                   Name of the build profile from eas.json. Defaults to "production" if defined
                                           in eas.json.
  --skip-project-configuration             Skip project configuration
  --[no-]wait                              Wait for build(s) to complete

DESCRIPTION
  Start a build
```

_See code: [src/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/build/index.ts)_

## `eas build:cancel [BUILD_ID]`

Cancel a build.

```
USAGE
  $ eas build:cancel [BUILD_ID]

DESCRIPTION
  Cancel a build.
```

_See code: [src/commands/build/cancel.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/build/cancel.ts)_

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure [-p android|ios|all]

FLAGS
  -p, --platform=(android|ios|all)  Platform to configure

DESCRIPTION
  Configure the project to support EAS Build.
```

_See code: [src/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/build/configure.ts)_

## `eas build:inspect`

Inspect the state of the project at specific build stages. Useful for troubleshooting.

```
USAGE
  $ eas build:inspect -p android|ios -s archive|pre-build|post-build --output <value> [--profile <value>] [--force]
    [--verbose]

FLAGS
  -p, --platform=(android|ios)
      (required)

  -s, --stage=(archive|pre-build|post-build)
      (required) Stage of the build you want to inspect.
      archive - builds the project archive that would be uploaded to EAS when building
      pre-build - prepares the project to be built with Gradle/Xcode. Does not run the native build.
      post-build - builds the native project and leaves the output directory for inspection

  --force
      Delete OUTPUT_DIRECTORY if it already exists.

  --output=OUTPUT_DIRECTORY
      (required) Output directory.

  --profile=PROFILE_NAME
      Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.

  --verbose

DESCRIPTION
  Inspect the state of the project at specific build stages. Useful for troubleshooting.
```

_See code: [src/commands/build/inspect.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/build/inspect.ts)_

## `eas build:list`

list all builds for your project

```
USAGE
  $ eas build:list [--platform all|android|ios] [--json] [--status
    new|in-queue|in-progress|errored|finished|canceled] [--distribution store|internal|simulator] [--channel <value>]
    [--appVersion <value>] [--appBuildVersion <value>] [--sdkVersion <value>] [--runtimeVersion <value>]
    [--appIdentifier <value>] [--buildProfile <value>] [--gitCommitHash <value>] [--limit <value>]

FLAGS
  --appBuildVersion=<value>
  --appIdentifier=<value>
  --appVersion=<value>
  --buildProfile=<value>
  --channel=<value>
  --distribution=(store|internal|simulator)
  --gitCommitHash=<value>
  --json                                                         Enable JSON output, non-JSON messages will be printed
                                                                 to stderr
  --limit=<value>
  --platform=(all|android|ios)
  --runtimeVersion=<value>
  --sdkVersion=<value>
  --status=(new|in-queue|in-progress|errored|finished|canceled)

DESCRIPTION
  list all builds for your project
```

_See code: [src/commands/build/list.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/build/list.ts)_

## `eas build:view [BUILD_ID]`

view a build for your project

```
USAGE
  $ eas build:view [BUILD_ID] [--json]

FLAGS
  --json  Enable JSON output, non-JSON messages will be printed to stderr

DESCRIPTION
  view a build for your project
```

_See code: [src/commands/build/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/build/view.ts)_

## `eas channel:create [NAME]`

Create a channel on the current project.

```
USAGE
  $ eas channel:create [NAME] [--json]

ARGUMENTS
  NAME  Name of the channel to create

FLAGS
  --json  print output as a JSON object with the new channel ID, name and branch mapping.

DESCRIPTION
  Create a channel on the current project.
```

_See code: [src/commands/channel/create.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/channel/create.ts)_

## `eas channel:edit [NAME]`

Point a channel at a new branch.

```
USAGE
  $ eas channel:edit [NAME] [--branch <value>] [--json]

ARGUMENTS
  NAME  Name of the channel to edit

FLAGS
  --branch=<value>  Name of the branch to point to
  --json            print output as a JSON object with the channel ID, name and branch mapping.

DESCRIPTION
  Point a channel at a new branch.
```

_See code: [src/commands/channel/edit.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/channel/edit.ts)_

## `eas channel:list`

List all channels on the current project.

```
USAGE
  $ eas channel:list [--json]

FLAGS
  --json  print output as a JSON object with the channel ID, name and branch mapping.

DESCRIPTION
  List all channels on the current project.
```

_See code: [src/commands/channel/list.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/channel/list.ts)_

## `eas channel:view [NAME]`

View a channel on the current project.

```
USAGE
  $ eas channel:view [NAME] [--json]

ARGUMENTS
  NAME  Name of the channel to view

FLAGS
  --json  print output as a JSON object with the channel ID, name and branch mapping.

DESCRIPTION
  View a channel on the current project.
```

_See code: [src/commands/channel/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/channel/view.ts)_

## `eas config`

show the eas.json config

```
USAGE
  $ eas config [-p android|ios] [--profile <value>]

FLAGS
  -p, --platform=(android|ios)
  --profile=<value>

DESCRIPTION
  show the eas.json config
```

_See code: [src/commands/config.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/config.ts)_

## `eas credentials`

manage your credentials

```
USAGE
  $ eas credentials

DESCRIPTION
  manage your credentials
```

_See code: [src/commands/credentials.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/credentials.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create

DESCRIPTION
  register new Apple Devices to use for internal distribution
```

_See code: [src/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/device/create.ts)_

## `eas device:list`

list all registered devices for your account

```
USAGE
  $ eas device:list [--apple-team-id <value>]

FLAGS
  --apple-team-id=<value>

DESCRIPTION
  list all registered devices for your account
```

_See code: [src/commands/device/list.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/device/list.ts)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]

DESCRIPTION
  view a device for your project
```

_See code: [src/commands/device/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/device/view.ts)_

## `eas diagnostics`

log environment info to the console

```
USAGE
  $ eas diagnostics

DESCRIPTION
  log environment info to the console
```

_See code: [src/commands/diagnostics.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/diagnostics.ts)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.1.10/src/commands/help.ts)_

## `eas project:info`

information about the current project

```
USAGE
  $ eas project:info

DESCRIPTION
  information about the current project
```

_See code: [src/commands/project/info.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/project/info.ts)_

## `eas project:init`

create or link an EAS project

```
USAGE
  $ eas project:init

DESCRIPTION
  create or link an EAS project

ALIASES
  $ eas init
```

_See code: [src/commands/project/init.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/project/init.ts)_

## `eas secret:create`

Create an environment secret on the current project or owner account.

```
USAGE
  $ eas secret:create [--scope account|project] [--name <value>] [--value <value>] [--force]

FLAGS
  --force                    Delete and recreate existing secrets
  --name=<value>             Name of the secret
  --scope=(account|project)  [default: project] Scope for the secret
  --value=<value>            Value of the secret

DESCRIPTION
  Create an environment secret on the current project or owner account.
```

_See code: [src/commands/secret/create.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/secret/create.ts)_

## `eas secret:delete`

Delete an environment secret by ID.

```
USAGE
  $ eas secret:delete [--id <value>]

FLAGS
  --id=<value>  ID of the secret to delete

DESCRIPTION
  Delete an environment secret by ID.

  Unsure where to find the secret's ID? Run eas secret:list
```

_See code: [src/commands/secret/delete.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/secret/delete.ts)_

## `eas secret:list`

Lists environment secrets available for your current app

```
USAGE
  $ eas secret:list

DESCRIPTION
  Lists environment secrets available for your current app
```

_See code: [src/commands/secret/list.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/secret/list.ts)_

## `eas submit`

Submit build archive to App Store Connect

```
USAGE
  $ eas submit [-p android|ios|all] [--profile <value>] [--latest | --id <value> | --path <value> | --url
    <value>] [--verbose] [--wait] [--non-interactive]

FLAGS
  -p, --platform=(android|ios|all)
  --id=<value>                      ID of the build to submit
  --latest                          Submit the latest build for specified platform
  --non-interactive                 Run command in non-interactive mode
  --path=<value>                    Path to the .apk/.aab/.ipa file
  --profile=<value>                 Name of the submit profile from eas.json. Defaults to "production" if defined in
                                    eas.json.
  --url=<value>                     App archive url
  --verbose                         Always print logs from Submission Service
  --[no-]wait                       Wait for submission to complete

DESCRIPTION
  Submit build archive to App Store Connect

  See how to configure submits with eas.json: https://docs.expo.dev/submit/eas-json/

ALIASES
  $ eas build:submit
```

_See code: [src/commands/submit.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/submit.ts)_

## `eas update`

Publish an update group.

```
USAGE
  $ eas update [--branch <value>] [--message <value>] [--republish | --input-dir <value> | --skip-bundler]
    [--group <value> |  | ] [-p android|ios|all] [--json] [--auto]

FLAGS
  -p, --platform=(android|ios|all)  [default: all]
  --auto                            Use the current git branch and commit message for the EAS branch and update message
  --branch=<value>                  Branch to publish the update group on
  --group=<value>                   Update group to republish
  --input-dir=<value>               [default: dist] Location of the bundle
  --json                            Enable JSON output, non-JSON messages will be printed to stderr
  --message=<value>                 A short message describing the update
  --republish                       Republish an update group
  --skip-bundler                    Skip running Expo CLI to bundle the app before publishing

DESCRIPTION
  Publish an update group.
```

_See code: [src/commands/update/index.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/update/index.ts)_

## `eas update:configure`

Configure the project to support EAS Update.

```
USAGE
  $ eas update:configure

DESCRIPTION
  Configure the project to support EAS Update.
```

_See code: [src/commands/update/configure.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/update/configure.ts)_

## `eas update:delete GROUPID`

Delete all the updates in an update Group.

```
USAGE
  $ eas update:delete [GROUPID] [--json]

ARGUMENTS
  GROUPID  The ID of an update group to delete.

FLAGS
  --json  Return a json with the group ID of the deleted updates.

DESCRIPTION
  Delete all the updates in an update Group.
```

_See code: [src/commands/update/delete.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/update/delete.ts)_

## `eas update:view GROUPID`

Update group details.

```
USAGE
  $ eas update:view [GROUPID] [--json]

ARGUMENTS
  GROUPID  The ID of an update group.

FLAGS
  --json  Return a json with the updates belonging to the group.

DESCRIPTION
  Update group details.
```

_See code: [src/commands/update/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/update/view.ts)_

## `eas webhook:create`

Create a webhook on the current project.

```
USAGE
  $ eas webhook:create [--event BUILD|SUBMIT] [--url <value>] [--secret <value>]

FLAGS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
  --secret=<value>        Secret used to create a hash signature of the request payload, provided in the
                          'Expo-Signature' header.
  --url=<value>           Webhook URL

DESCRIPTION
  Create a webhook on the current project.
```

_See code: [src/commands/webhook/create.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/webhook/create.ts)_

## `eas webhook:delete [ID]`

Delete a webhook on the current project.

```
USAGE
  $ eas webhook:delete [ID]

ARGUMENTS
  ID  ID of the webhook to delete

DESCRIPTION
  Delete a webhook on the current project.
```

_See code: [src/commands/webhook/delete.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/webhook/delete.ts)_

## `eas webhook:list`

List webhooks on the current project.

```
USAGE
  $ eas webhook:list [--event BUILD|SUBMIT]

FLAGS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook

DESCRIPTION
  List webhooks on the current project.
```

_See code: [src/commands/webhook/list.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/webhook/list.ts)_

## `eas webhook:update`

Create a webhook on the current project.

```
USAGE
  $ eas webhook:update --id <value> [--event BUILD|SUBMIT] [--url <value>] [--secret <value>]

FLAGS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
  --id=<value>            (required) Webhook ID
  --secret=<value>        Secret used to create a hash signature of the request payload, provided in the
                          'Expo-Signature' header.
  --url=<value>           Webhook URL

DESCRIPTION
  Create a webhook on the current project.
```

_See code: [src/commands/webhook/update.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/webhook/update.ts)_

## `eas webhook:view ID`

View a webhook on the current project.

```
USAGE
  $ eas webhook:view [ID]

ARGUMENTS
  ID  ID of the webhook to view

DESCRIPTION
  View a webhook on the current project.
```

_See code: [src/commands/webhook/view.ts](https://github.com/expo/eas-cli/blob/v0.42.4/packages/eas-cli/src/commands/webhook/view.ts)_
<!-- commandsstop -->

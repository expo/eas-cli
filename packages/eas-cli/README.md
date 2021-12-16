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

ALIASES
  $ eas login
```

_See code: [src/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/account/login.ts)_

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

ALIASES
  $ eas logout
```

_See code: [src/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/account/logout.ts)_

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

ALIASES
  $ eas whoami
```

_See code: [src/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/account/view.ts)_

## `eas analytics [STATUS]`

view or change analytics settings

```
USAGE
  $ eas analytics [STATUS]
```

_See code: [src/commands/analytics.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/analytics.ts)_

## `eas branch:create [NAME]`

Create a branch on the current project.

```
USAGE
  $ eas branch:create [NAME]

ARGUMENTS
  NAME  Name of the branch to create

OPTIONS
  --json  return a json with the new branch ID and name.
```

_See code: [src/commands/branch/create.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/branch/create.ts)_

## `eas branch:delete [NAME]`

Delete a branch on the current project

```
USAGE
  $ eas branch:delete [NAME]

ARGUMENTS
  NAME  Name of the branch to delete

OPTIONS
  --json  return JSON with the edited branch's ID and name.
```

_See code: [src/commands/branch/delete.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/branch/delete.ts)_

## `eas branch:list`

List all branches on this project.

```
USAGE
  $ eas branch:list

OPTIONS
  --json  return output as JSON
```

_See code: [src/commands/branch/list.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/branch/list.ts)_

## `eas branch:rename`

Rename a branch.

```
USAGE
  $ eas branch:rename

OPTIONS
  --from=from  current name of the branch.
  --json       return a json with the edited branch's ID and name.
  --to=to      new name of the branch.
```

_See code: [src/commands/branch/rename.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/branch/rename.ts)_

## `eas branch:view [NAME]`

View a branch.

```
USAGE
  $ eas branch:view [NAME]

ARGUMENTS
  NAME  Name of the branch to view

OPTIONS
  --json  return a json with the branch's ID name and recent update groups.
```

_See code: [src/commands/branch/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/branch/view.ts)_

## `eas build`

Start a build

```
USAGE
  $ eas build

OPTIONS
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
```

_See code: [src/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/build/index.ts)_

## `eas build:cancel [BUILD_ID]`

Cancel a build.

```
USAGE
  $ eas build:cancel [BUILD_ID]
```

_See code: [src/commands/build/cancel.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/build/cancel.ts)_

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure

OPTIONS
  -p, --platform=(android|ios|all)  Platform to configure
```

_See code: [src/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/build/configure.ts)_

## `eas build:inspect`

Inspect the state of the project at specific build stages. Useful for troubleshooting.

```
USAGE
  $ eas build:inspect

OPTIONS
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
```

_See code: [src/commands/build/inspect.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/build/inspect.ts)_

## `eas build:list`

list all builds for your project

```
USAGE
  $ eas build:list

OPTIONS
  --appBuildVersion=appBuildVersion
  --appIdentifier=appIdentifier
  --appVersion=appVersion
  --buildProfile=buildProfile
  --channel=channel
  --distribution=(store|internal|simulator)
  --gitCommitHash=gitCommitHash

  --json                                                         Enable JSON output, non-JSON messages will be printed
                                                                 to stderr

  --limit=limit

  --platform=(all|android|ios)

  --runtimeVersion=runtimeVersion

  --sdkVersion=sdkVersion

  --status=(new|in-queue|in-progress|errored|finished|canceled)
```

_See code: [src/commands/build/list.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/build/list.ts)_

## `eas build:view [BUILD_ID]`

view a build for your project

```
USAGE
  $ eas build:view [BUILD_ID]

OPTIONS
  --json  Enable JSON output, non-JSON messages will be printed to stderr
```

_See code: [src/commands/build/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/build/view.ts)_

## `eas channel:create [NAME]`

Create a channel on the current project.

```
USAGE
  $ eas channel:create [NAME]

ARGUMENTS
  NAME  Name of the channel to create

OPTIONS
  --json  print output as a JSON object with the new channel ID, name and branch mapping.
```

_See code: [src/commands/channel/create.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/channel/create.ts)_

## `eas channel:edit [NAME]`

Point a channel at a new branch.

```
USAGE
  $ eas channel:edit [NAME]

ARGUMENTS
  NAME  Name of the channel to edit

OPTIONS
  --branch=branch  Name of the branch to point to
  --json           print output as a JSON object with the channel ID, name and branch mapping.
```

_See code: [src/commands/channel/edit.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/channel/edit.ts)_

## `eas channel:list`

List all channels on the current project.

```
USAGE
  $ eas channel:list

OPTIONS
  --json  print output as a JSON object with the channel ID, name and branch mapping.
```

_See code: [src/commands/channel/list.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/channel/list.ts)_

## `eas channel:view [NAME]`

View a channel on the current project.

```
USAGE
  $ eas channel:view [NAME]

ARGUMENTS
  NAME  Name of the channel to view

OPTIONS
  --json  print output as a JSON object with the channel ID, name and branch mapping.
```

_See code: [src/commands/channel/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/channel/view.ts)_

## `eas config`

show the eas.json config

```
USAGE
  $ eas config

OPTIONS
  -p, --platform=(android|ios)
  --profile=profile
```

_See code: [src/commands/config.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/config.ts)_

## `eas credentials`

manage your credentials

```
USAGE
  $ eas credentials
```

_See code: [src/commands/credentials.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/credentials.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

_See code: [src/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/device/create.ts)_

## `eas device:list`

list all registered devices for your account

```
USAGE
  $ eas device:list

OPTIONS
  --apple-team-id=apple-team-id
```

_See code: [src/commands/device/list.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/device/list.ts)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]
```

_See code: [src/commands/device/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/device/view.ts)_

## `eas diagnostics`

log environment info to the console

```
USAGE
  $ eas diagnostics
```

_See code: [src/commands/diagnostics.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/diagnostics.ts)_

## `eas help [COMMAND]`

display help for eas

```
USAGE
  $ eas help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.5/src/commands/help.ts)_

## `eas project:info`

information about the current project

```
USAGE
  $ eas project:info
```

_See code: [src/commands/project/info.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/project/info.ts)_

## `eas project:init`

create or link an EAS project

```
USAGE
  $ eas project:init

ALIASES
  $ eas init
```

_See code: [src/commands/project/init.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/project/init.ts)_

## `eas secret:create`

Create an environment secret on the current project or owner account.

```
USAGE
  $ eas secret:create

OPTIONS
  --force                    Delete and recreate existing secrets
  --name=name                Name of the secret
  --scope=(account|project)  [default: project] Scope for the secret
  --value=value              Value of the secret
```

_See code: [src/commands/secret/create.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/secret/create.ts)_

## `eas secret:delete`

Delete an environment secret by ID.

```
USAGE
  $ eas secret:delete

OPTIONS
  --id=id  ID of the secret to delete

DESCRIPTION
  Unsure where to find the secret's ID? Run eas secret:list
```

_See code: [src/commands/secret/delete.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/secret/delete.ts)_

## `eas secret:list`

Lists environment secrets available for your current app

```
USAGE
  $ eas secret:list
```

_See code: [src/commands/secret/list.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/secret/list.ts)_

## `eas submit`

Submit build archive to App Store Connect

```
USAGE
  $ eas submit

OPTIONS
  -p, --platform=(android|ios|all)
  --id=id                           ID of the build to submit
  --latest                          Submit the latest build for specified platform
  --non-interactive                 Run command in non-interactive mode
  --path=path                       Path to the .apk/.aab/.ipa file

  --profile=profile                 Name of the submit profile from eas.json. Defaults to "production" if defined in
                                    eas.json.

  --url=url                         App archive url

  --verbose                         Always print logs from Submission Service

  --[no-]wait                       Wait for submission to complete

DESCRIPTION
  See how to configure submits with eas.json: 
  https://docs.expo.dev/submit/eas-json/

ALIASES
  $ eas build:submit
```

_See code: [src/commands/submit.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/submit.ts)_

## `eas update`

Publish an update group.

```
USAGE
  $ eas update

OPTIONS
  -p, --platform=(android|ios|all)  [default: all]
  --auto                            Use the current git branch and commit message for the EAS branch and update message
  --branch=branch                   Branch to publish the update group on
  --group=group                     Update group to republish
  --input-dir=input-dir             [default: dist] Location of the bundle
  --json                            Enable JSON output, non-JSON messages will be printed to stderr
  --message=message                 A short message describing the update
  --republish                       Republish an update group
  --skip-bundler                    Skip running Expo CLI to bundle the app before publishing
```

_See code: [src/commands/update/index.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/update/index.ts)_

## `eas update:configure`

Configure the project to support EAS Update.

```
USAGE
  $ eas update:configure
```

_See code: [src/commands/update/configure.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/update/configure.ts)_

## `eas update:delete GROUPID`

Delete all the updates in an update Group.

```
USAGE
  $ eas update:delete GROUPID

ARGUMENTS
  GROUPID  The ID of an update group to delete.

OPTIONS
  --json  Return a json with the group ID of the deleted updates.
```

_See code: [src/commands/update/delete.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/update/delete.ts)_

## `eas update:view GROUPID`

Update group details.

```
USAGE
  $ eas update:view GROUPID

ARGUMENTS
  GROUPID  The ID of an update group.

OPTIONS
  --json  Return a json with the updates belonging to the group.
```

_See code: [src/commands/update/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/update/view.ts)_

## `eas webhook:create`

Create a webhook on the current project.

```
USAGE
  $ eas webhook:create

OPTIONS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook

  --secret=secret         Secret used to create a hash signature of the request payload, provided in the
                          'Expo-Signature' header.

  --url=url               Webhook URL
```

_See code: [src/commands/webhook/create.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/webhook/create.ts)_

## `eas webhook:delete [ID]`

Delete a webhook on the current project.

```
USAGE
  $ eas webhook:delete [ID]

ARGUMENTS
  ID  ID of the webhook to delete
```

_See code: [src/commands/webhook/delete.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/webhook/delete.ts)_

## `eas webhook:list`

List webhooks on the current project.

```
USAGE
  $ eas webhook:list

OPTIONS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
```

_See code: [src/commands/webhook/list.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/webhook/list.ts)_

## `eas webhook:update`

Create a webhook on the current project.

```
USAGE
  $ eas webhook:update

OPTIONS
  --event=(BUILD|SUBMIT)  Event type that triggers the webhook
  --id=id                 (required) Webhook ID

  --secret=secret         Secret used to create a hash signature of the request payload, provided in the
                          'Expo-Signature' header.

  --url=url               Webhook URL
```

_See code: [src/commands/webhook/update.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/webhook/update.ts)_

## `eas webhook:view ID`

View a webhook on the current project.

```
USAGE
  $ eas webhook:view ID

ARGUMENTS
  ID  ID of the webhook to view
```

_See code: [src/commands/webhook/view.ts](https://github.com/expo/eas-cli/blob/v0.41.1/packages/eas-cli/src/commands/webhook/view.ts)_
<!-- commandsstop -->

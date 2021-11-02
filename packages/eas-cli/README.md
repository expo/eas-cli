# eas-cli

EAS command line tool

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![Downloads/week](https://img.shields.io/npm/dw/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![License](https://img.shields.io/npm/l/eas-cli.svg)](https://github.com/expo/eas-cli/blob/main/package.json)

* [Installation](#installation)
* [Usage](#usage)
* [Commands](#commands)

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
* [`eas build`](#eas-build)
* [`eas build:cancel [BUILD_ID]`](#eas-buildcancel-build_id)
* [`eas build:configure`](#eas-buildconfigure)
* [`eas build:list`](#eas-buildlist)
* [`eas build:view [BUILD_ID]`](#eas-buildview-build_id)
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

_See code: [src/commands/account/login.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/account/login.js)_

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

ALIASES
  $ eas logout
```

_See code: [src/commands/account/logout.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/account/logout.js)_

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

ALIASES
  $ eas whoami
```

_See code: [src/commands/account/view.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/account/view.js)_

## `eas analytics [STATUS]`

view or change analytics settings

```
USAGE
  $ eas analytics [STATUS]
```

_See code: [src/commands/analytics.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/analytics.js)_

## `eas build`

start a build

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

_See code: [src/commands/build/index.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/build/index.js)_

## `eas build:cancel [BUILD_ID]`

Cancel a build.

```
USAGE
  $ eas build:cancel [BUILD_ID]
```

_See code: [src/commands/build/cancel.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/build/cancel.js)_

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure

OPTIONS
  -p, --platform=(android|ios|all)  Platform to configure
```

_See code: [src/commands/build/configure.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/build/configure.js)_

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

_See code: [src/commands/build/list.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/build/list.js)_

## `eas build:view [BUILD_ID]`

view a build for your project

```
USAGE
  $ eas build:view [BUILD_ID]

OPTIONS
  --json  Enable JSON output, non-JSON messages will be printed to stderr
```

_See code: [src/commands/build/view.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/build/view.js)_

## `eas config`

show the eas.json config

```
USAGE
  $ eas config

OPTIONS
  -p, --platform=(android|ios)
  --profile=profile
```

_See code: [src/commands/config.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/config.js)_

## `eas credentials`

manage your credentials

```
USAGE
  $ eas credentials
```

_See code: [src/commands/credentials.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/credentials.js)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

_See code: [src/commands/device/create.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/device/create.js)_

## `eas device:list`

list all registered devices for your account

```
USAGE
  $ eas device:list

OPTIONS
  --apple-team-id=apple-team-id
```

_See code: [src/commands/device/list.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/device/list.js)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]
```

_See code: [src/commands/device/view.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/device/view.js)_

## `eas diagnostics`

log environment info to the console

```
USAGE
  $ eas diagnostics
```

_See code: [src/commands/diagnostics.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/diagnostics.js)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.3/src/commands/help.ts)_

## `eas project:info`

information about the current project

```
USAGE
  $ eas project:info
```

_See code: [src/commands/project/info.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/project/info.js)_

## `eas project:init`

create or link an EAS project

```
USAGE
  $ eas project:init

ALIASES
  $ eas init
```

_See code: [src/commands/project/init.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/project/init.js)_

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

_See code: [src/commands/secret/create.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/secret/create.js)_

## `eas secret:delete`

Delete an environment secret by ID.

```
USAGE
  $ eas secret:delete

OPTIONS
  --id=id  ID of the secret to delete

DESCRIPTION
  Unsure where to find the secret's ID? Run eas secrets:list
```

_See code: [src/commands/secret/delete.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/secret/delete.js)_

## `eas secret:list`

Lists environment secrets available for your current app

```
USAGE
  $ eas secret:list
```

_See code: [src/commands/secret/list.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/secret/list.js)_

## `eas submit`

submit build archive to app store

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

_See code: [src/commands/submit.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/submit.js)_

## `eas webhook:create`

Create a webhook on the current project.

```
USAGE
  $ eas webhook:create

OPTIONS
  --event=(BUILD)  [default: BUILD] Event type that triggers the webhook

  --secret=secret  Secret used to create a hash signature of the request payload, provided in the 'Expo-Signature'
                   header.

  --url=url        Webhook URL
```

_See code: [src/commands/webhook/create.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/webhook/create.js)_

## `eas webhook:delete [ID]`

Delete a webhook on the current project.

```
USAGE
  $ eas webhook:delete [ID]

ARGUMENTS
  ID  ID of the webhook to delete
```

_See code: [src/commands/webhook/delete.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/webhook/delete.js)_

## `eas webhook:list`

List webhooks on the current project.

```
USAGE
  $ eas webhook:list

OPTIONS
  --event=(BUILD)  Event type that triggers the webhook
```

_See code: [src/commands/webhook/list.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/webhook/list.js)_

## `eas webhook:update`

Create a webhook on the current project.

```
USAGE
  $ eas webhook:update

OPTIONS
  --event=(BUILD)  [default: BUILD] Event type that triggers the webhook
  --id=id          (required) Webhook ID

  --secret=secret  Secret used to create a hash signature of the request payload, provided in the 'Expo-Signature'
                   header.

  --url=url        Webhook URL
```

_See code: [src/commands/webhook/update.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/webhook/update.js)_

## `eas webhook:view ID`

View a webhook on the current project.

```
USAGE
  $ eas webhook:view ID

ARGUMENTS
  ID  ID of the webhook to view
```

_See code: [src/commands/webhook/view.js](https://github.com/expo/eas-cli/blob/v0.34.1/packages/eas-cli/src/commands/webhook/view.js)_
<!-- commandsstop -->

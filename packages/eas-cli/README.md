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
* [`eas credentials`](#eas-credentials)
* [`eas device:create`](#eas-devicecreate)
* [`eas device:list`](#eas-devicelist)
* [`eas device:view [UDID]`](#eas-deviceview-udid)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas secret:create`](#eas-secretcreate)
* [`eas secret:delete`](#eas-secretdelete)
* [`eas secret:list`](#eas-secretlist)
* [`eas submit --platform=(android|ios)`](#eas-submit---platformandroidios)
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

_See code: [build/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/account/login.ts)_

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

ALIASES
  $ eas logout
```

_See code: [build/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/account/logout.ts)_

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

ALIASES
  $ eas whoami
```

_See code: [build/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/account/view.ts)_

## `eas analytics [STATUS]`

View or change analytics settings

```
USAGE
  $ eas analytics [STATUS]
```

_See code: [build/commands/analytics.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/analytics.ts)_

## `eas build`

Start a build

```
USAGE
  $ eas build

OPTIONS
  -p, --platform=(android|ios|all)
  --local                           Run build locally [experimental]
  --non-interactive                 Run command in --non-interactive mode
  --profile=profile                 [default: release] Name of the build profile from eas.json
  --skip-credentials-check          Skip validation of build credentials
  --skip-project-configuration      Skip project configuration
  --[no-]wait                       Wait for build(s) to complete
```

_See code: [build/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/build/index.ts)_

## `eas build:cancel [BUILD_ID]`

Cancel a build.

```
USAGE
  $ eas build:cancel [BUILD_ID]
```

_See code: [build/commands/build/cancel.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/build/cancel.ts)_

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure

OPTIONS
  -p, --platform=(android|ios|all)  Platform to configure
  --allow-experimental              Enable experimental configuration steps.
```

_See code: [build/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/build/configure.ts)_

## `eas build:list`

list all builds for your project

```
USAGE
  $ eas build:list

OPTIONS
  --limit=limit
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished|canceled)
```

_See code: [build/commands/build/list.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/build/list.ts)_

## `eas build:view [BUILD_ID]`

view a build for your project

```
USAGE
  $ eas build:view [BUILD_ID]
```

_See code: [build/commands/build/view.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/build/view.ts)_

## `eas credentials`

Manage your credentials

```
USAGE
  $ eas credentials
```

_See code: [build/commands/credentials.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/credentials.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

_See code: [build/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/device/create.ts)_

## `eas device:list`

list all registered devices for your account

```
USAGE
  $ eas device:list

OPTIONS
  --apple-team-id=apple-team-id
```

_See code: [build/commands/device/list.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/device/list.ts)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]
```

_See code: [build/commands/device/view.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/device/view.ts)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.0/src/commands/help.ts)_

## `eas secret:create`

Create an environment secret on the current project or owner account.

```
USAGE
  $ eas secret:create

OPTIONS
  --name=name                Name of the secret
  --scope=(account|project)  [default: project] Scope for the secret
  --value=value              Value of the secret
```

_See code: [build/commands/secret/create.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/secret/create.ts)_

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

_See code: [build/commands/secret/delete.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/secret/delete.ts)_

## `eas secret:list`

Lists environment secrets available for your current app

```
USAGE
  $ eas secret:list
```

_See code: [build/commands/secret/list.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/secret/list.ts)_

## `eas submit --platform=(android|ios)`

Submits build artifact to app store

```
USAGE
  $ eas submit --platform=(android|ios)

OPTIONS
  -p, --platform=(android|ios)                                       For which platform you want to submit a build

  Android specific options=android-package                           Android package name (default: expo.android.package
                                                                     from app config)

  iOS specific options=app-name                                      The name of your app as it will appear on the App
                                                                     Store (default: expo.name from app config)

  iOS specific options=apple-id                                      Your Apple ID username (you can also set
                                                                     EXPO_APPLE_ID env variable)

  iOS specific options=apple-team-id                                 Your Apple Developer Team ID

  iOS specific options=asc-app-id                                    App Store Connect unique application Apple ID
                                                                     number. Providing this param results in skipping
                                                                     app creation step. Learn more:
                                                                     https://expo.fyi/asc-app-id

  iOS specific options=bundle-identifier                             Your iOS Bundle Identifier (default:
                                                                     expo.ios.bundleIdentifier from app config)

  iOS specific options=company-name                                  The name of your company, needed only for the first
                                                                     upload of any app to App Store

  --id=id                                                            ID of the build to submit

  Android specific options=key                                       Path to the JSON key used to authenticate with
                                                                     Google Play

  iOS specific options=language                                      [default: en-US] Primary language (e.g. English,
                                                                     German, ...)

  --latest                                                           Submit the latest build for specified platform

  --path=path                                                        Path to the .apk/.aab file

  Android specific options=(completed|draft|halted|inProgress)       [default: completed] Release status (used when
                                                                     uploading new APKs/AABs)

  iOS specific options=sku                                           An unique ID for your app that is not visible on
                                                                     the App Store, will be generated unless provided

  Android specific options=(production|beta|alpha|internal|rollout)  [default: internal] The track of the application to
                                                                     use

  Android specific options=(apk|aab)                                 Android archive type

  --url=url                                                          App archive url

  --verbose                                                          Always print logs from Submission Service

ALIASES
  $ eas build:submit

EXAMPLES
  $ eas submit --platform=ios
       - Fully interactive iOS submission

  $ eas submit --platform=android
       - Fully interactive Android submission

  $ eas submit -p android --latest --key=/path/to/google-services.json
       - Minimal non-interactive Android submission, however it can ask you for other params if not specified

  $ EXPO_APPLE_APP_SPECIFIC_PASSWORD=xxx eas submit -p ios --latest --apple-id=user@example.com --asc-app-id=1234567890,
       - Minimal non-interactive iOS submission, assuming you already have an app in App Store Connect
         and provide its App ID
```

_See code: [build/commands/submit.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/submit.ts)_

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

_See code: [build/commands/webhook/create.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/webhook/create.ts)_

## `eas webhook:delete [ID]`

Delete a webhook on the current project.

```
USAGE
  $ eas webhook:delete [ID]

ARGUMENTS
  ID  ID of the webhook to delete
```

_See code: [build/commands/webhook/delete.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/webhook/delete.ts)_

## `eas webhook:list`

List webhooks on the current project.

```
USAGE
  $ eas webhook:list

OPTIONS
  --event=(BUILD)  Event type that triggers the webhook
```

_See code: [build/commands/webhook/list.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/webhook/list.ts)_

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

_See code: [build/commands/webhook/update.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/webhook/update.ts)_

## `eas webhook:view ID`

View a webhook on the current project.

```
USAGE
  $ eas webhook:view ID

ARGUMENTS
  ID  ID of the webhook to view
```

_See code: [build/commands/webhook/view.ts](https://github.com/expo/eas-cli/blob/v0.11.0/build/commands/webhook/view.ts)_
<!-- commandsstop -->

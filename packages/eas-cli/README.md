# eas-cli

EAS command line tool

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![Downloads/week](https://img.shields.io/npm/dw/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![License](https://img.shields.io/npm/l/eas-cli.svg)](https://github.com/expo/eas-cli/blob/main/package.json)

<!-- toc -->
* [eas-cli](#eas-cli)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->
```sh-session
$ npm install -g eas-cli
$ eas COMMAND
running command...
$ eas (-v|--version|version)
eas-cli/0.1.0-alpha.23 darwin-x64 node-v14.15.0
$ eas --help [COMMAND]
USAGE
  $ eas COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`eas account:login`](#eas-accountlogin)
* [`eas account:logout`](#eas-accountlogout)
* [`eas account:view`](#eas-accountview)
* [`eas build`](#eas-build)
* [`eas build:configure`](#eas-buildconfigure)
* [`eas build:list`](#eas-buildlist)
* [`eas build:view [BUILDID]`](#eas-buildview-buildid)
* [`eas credentials`](#eas-credentials)
* [`eas device:create`](#eas-devicecreate)
* [`eas device:list`](#eas-devicelist)
* [`eas device:view [UDID]`](#eas-deviceview-udid)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas submit --platform=(android|ios)`](#eas-submit---platformandroidios)

## `eas account:login`

log in with your Expo account

```
USAGE
  $ eas account:login

ALIASES
  $ eas login
```

_See code: [build/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/account/login.ts)_

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

ALIASES
  $ eas logout
```

_See code: [build/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/account/logout.ts)_

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

ALIASES
  $ eas whoami
```

_See code: [build/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/account/view.ts)_

## `eas build`

Start a build

```
USAGE
  $ eas build

OPTIONS
  -p, --platform=(android|ios|all)
  --non-interactive                 Run command in --non-interactive mode
  --profile=profile                 [default: release] Name of the build profile from eas.json
  --skip-credentials-check          Skip validation of build credentials
  --skip-project-configuration      Skip project configuration
  --wait                            Wait for build(s) to complete
```

_See code: [build/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/build/index.ts)_

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure

OPTIONS
  -p, --platform=(android|ios|all)  Platform to configure
  --allow-experimental              Enable experimental configuration steps.
```

_See code: [build/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/build/configure.ts)_

## `eas build:list`

list all builds for your project

```
USAGE
  $ eas build:list

OPTIONS
  --limit=limit
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished)
```

_See code: [build/commands/build/list.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/build/list.ts)_

## `eas build:view [BUILDID]`

view a build for your project

```
USAGE
  $ eas build:view [BUILDID]
```

_See code: [build/commands/build/view.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/build/view.ts)_

## `eas credentials`

Manage your credentials

```
USAGE
  $ eas credentials
```

_See code: [build/commands/credentials.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/credentials.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

_See code: [build/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/device/create.ts)_

## `eas device:list`

list all registered devices for your account

```
USAGE
  $ eas device:list

OPTIONS
  --apple-team-id=apple-team-id
```

_See code: [build/commands/device/list.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/device/list.ts)_

## `eas device:view [UDID]`

view a device for your project

```
USAGE
  $ eas device:view [UDID]
```

_See code: [build/commands/device/view.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/device/view.ts)_

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

_See code: [build/commands/submit.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.23/build/commands/submit.ts)_
<!-- commandsstop -->

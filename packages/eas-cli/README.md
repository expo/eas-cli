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
eas-cli/0.1.0-alpha.7 darwin-x64 node-v12.13.0
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
* [`eas build:create`](#eas-buildcreate)
* [`eas build:status`](#eas-buildstatus)
* [`eas build:submit`](#eas-buildsubmit)
* [`eas credentials`](#eas-credentials)
* [`eas device:create`](#eas-devicecreate)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas release:create [RELEASENAME]`](#eas-releasecreate-releasename)
* [`eas update:show`](#eas-updateshow)

## `eas account:login`

log in with your EAS account

```
USAGE
  $ eas account:login

ALIASES
  $ eas login
```

_See code: [build/commands/account/login.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/account/login.ts)_

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

ALIASES
  $ eas logout
```

_See code: [build/commands/account/logout.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/account/logout.ts)_

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

ALIASES
  $ eas whoami
```

_See code: [build/commands/account/view.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/account/view.ts)_

## `eas build`

build an app binary for your project

```
USAGE
  $ eas build
```

_See code: [build/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/build/index.ts)_

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure

OPTIONS
  -p, --platform=(android|ios|all)  [default: all] Platform to configure
```

_See code: [build/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/build/configure.ts)_

## `eas build:create`

Start a build

```
USAGE
  $ eas build:create

OPTIONS
  -p, --platform=(android|ios|all)  (required)
  --non-interactive                 Run command in --non-interactive mode
  --profile=profile                 [default: release] Name of the build profile from eas.json
  --skip-credentials-check          Skip validation of build credentials
  --skip-project-configuration      Skip project configuration
  --wait                            Wait for build(s) to complete
```

_See code: [build/commands/build/create.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/build/create.ts)_

## `eas build:status`

get the status of the latest builds for your project

```
USAGE
  $ eas build:status

OPTIONS
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished)
```

_See code: [build/commands/build/status.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/build/status.ts)_

## `eas build:submit`

Submits build artifact to app store

```
USAGE
  $ eas build:submit

OPTIONS
  -p, --platform=(android|ios)                                       (required) For which platform you want to submit a
                                                                     build

  Android specific options=android-package                           Android package name (using expo.android.package
                                                                     from app.json by default)

  iOS specific options=app-apple-id                                  App Store Connect unique application Apple ID
                                                                     number.

  iOS specific options=apple-app-specific-password                   Your Apple ID app-specific password. You can also
                                                                     set EXPO_APPLE_APP_SPECIFIC_PASSWORD env variable.

  iOS specific options=apple-id                                      Your Apple ID username (you can also set
                                                                     EXPO_APPLE_ID env variable)

  --id=id                                                            ID of the build to submit

  Android specific options=key                                       Path to the JSON key used to authenticate with
                                                                     Google Play

  --latest                                                           Submit the latest build

  --path=path                                                        Path to the .apk/.aab file

  Android specific options=(completed|draft|halted|inProgress)       [default: completed] Release status (used when
                                                                     uploading new apks/aabs), choose from: completed,
                                                                     draft, halted, inProgress

  Android specific options=(production|beta|alpha|internal|rollout)  [default: internal] The track of the application to
                                                                     use, choose from: production, beta, alpha,
                                                                     internal, rollout

  Android specific options=(apk|aab)                                 Android archive type

  --url=url                                                          App archive url

  --verbose                                                          Always print logs from Submission Service
```

_See code: [build/commands/build/submit.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/build/submit.ts)_

## `eas credentials`

Manage your credentials

```
USAGE
  $ eas credentials
```

_See code: [build/commands/credentials.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/credentials.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

_See code: [build/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/device/create.ts)_

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

## `eas release:create [RELEASENAME]`

Create a release on the current project.

```
USAGE
  $ eas release:create [RELEASENAME]

ARGUMENTS
  RELEASENAME  Name of the release to create

OPTIONS
  --json  return a json with the new release ID and name.
```

_See code: [build/commands/release/create.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/release/create.ts)_

## `eas update:show`

details about a particular revision

```
USAGE
  $ eas update:show
```

_See code: [build/commands/update/show.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.7/build/commands/update/show.ts)_
<!-- commandsstop -->

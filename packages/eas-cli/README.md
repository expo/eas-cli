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
eas-cli/0.1.0-alpha.4 darwin-x64 node-v12.16.2
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
* [`eas release:publish`](#eas-releasepublish)
* [`eas update:show`](#eas-updateshow)

## `eas account:login`

log in with your EAS account

```
USAGE
  $ eas account:login

ALIASES
  $ eas login
```

## `eas account:logout`

log out

```
USAGE
  $ eas account:logout

ALIASES
  $ eas logout
```

## `eas account:view`

show the username you are logged in as

```
USAGE
  $ eas account:view

ALIASES
  $ eas whoami
```

## `eas build`

build an app binary for your project

```
USAGE
  $ eas build
```

## `eas build:configure`

Configure the project to support EAS Build.

```
USAGE
  $ eas build:configure

OPTIONS
  -p, --platform=(android|ios|all)  [default: all] Platform to configure
```

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

## `eas build:status`

get the status of the latest builds for your project

```
USAGE
  $ eas build:status

OPTIONS
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished)
```

## `eas build:submit`

Submits build artifact to app store

```
USAGE
  $ eas build:submit

OPTIONS
  -p, --platform=(android|ios)                               (required) For which platform you want to submit a build

  --android-package=android-package                          Android package name (using expo.android.package from
                                                             app.json by default)

  --app-apple-id=app-apple-id                                App Store Connect unique application Apple ID number.

  --apple-app-specific-password=apple-app-specific-password  Your Apple ID app-specific password. You can also set
                                                             EXPO_APPLE_APP_SPECIFIC_PASSWORD env variable.

  --apple-id=apple-id                                        Your Apple ID username (you can also set EXPO_APPLE_ID env
                                                             variable)

  --id=id                                                    ID of the build to submit

  --key=key                                                  Path to the JSON key used to authenticate with Google Play

  --latest                                                   Submit the latest build

  --path=path                                                Path to the .apk/.aab file

  --release-status=(completed|draft|halted|inProgress)       [default: completed] Release status (used when uploading
                                                             new apks/aabs), choose from: completed, draft, halted,
                                                             inProgress

  --track=(production|beta|alpha|internal|rollout)           [default: internal] The track of the application to use,
                                                             choose from: production, beta, alpha, internal, rollout

  --type=(apk|aab)                                           Android archive type

  --url=url                                                  App archive url

  --verbose                                                  Always print logs from Submission Service
```

## `eas credentials`

Manage your credentials

```
USAGE
  $ eas credentials
```

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

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
```

## `eas release:publish`

Publish an updateGroup on a release.

```
USAGE
  $ eas release:publish
```

## `eas update:show`

details about a particular revision

```
USAGE
  $ eas update:show
```
<!-- commandsstop -->

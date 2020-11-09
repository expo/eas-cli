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
eas-cli/0.1.0-alpha.0 darwin-x64 node-v12.13.0
$ eas --help [COMMAND]
USAGE
  $ eas COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`eas build`](#eas-build)
* [`eas build:configure`](#eas-buildconfigure)
* [`eas build:create`](#eas-buildcreate)
* [`eas build:status`](#eas-buildstatus)
* [`eas build:submit`](#eas-buildsubmit)
* [`eas credentials`](#eas-credentials)
* [`eas device:create`](#eas-devicecreate)
* [`eas help [COMMAND]`](#eas-help-command)
* [`eas login`](#eas-login)
* [`eas logout`](#eas-logout)
* [`eas update`](#eas-update)
* [`eas update:show`](#eas-updateshow)
* [`eas whoami`](#eas-whoami)

## `eas build`

build an app binary for your project

```
USAGE
  $ eas build
```

_See code: [build/commands/build/index.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/build/index.ts)_

## `eas build:configure`

Start a build

```
USAGE
  $ eas build:configure
```

_See code: [build/commands/build/configure.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/build/configure.ts)_

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

_See code: [build/commands/build/create.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/build/create.ts)_

## `eas build:status`

get the status of the latest builds for your project

```
USAGE
  $ eas build:status

OPTIONS
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished)
```

_See code: [build/commands/build/status.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/build/status.ts)_

## `eas build:submit`

Submits build artifact to app store

```
USAGE
  $ eas build:submit

OPTIONS
  -p, --platform=(android|ios)                          (required) For which platform you want to submit a build

  --android-package=android-package                     Android package name (using expo.android.package from app.json
                                                        by default)

  --id=id                                               ID of the build to submit

  --key=key                                             Path to the JSON key used to authenticate with Google Play

  --latest                                              Submit the latest build

  --path=path                                           Path to the .apk/.aab file

  --release-status=(completed|draft|halted|inProgress)  [default: completed] Release status (used when uploading new
                                                        apks/aabs), choose from: completed, draft, halted, inProgress

  --track=(production|beta|alpha|internal|rollout)      [default: internal] The track of the application to use, choose
                                                        from: production, beta, alpha, internal, rollout

  --type=(apk|aab)                                      Android archive type

  --url=url                                             App archive url

  --verbose                                             Always print logs from Submission Service
```

_See code: [build/commands/build/submit.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/build/submit.ts)_

## `eas credentials`

Manage your credentials

```
USAGE
  $ eas credentials
```

_See code: [build/commands/credentials.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/credentials.ts)_

## `eas device:create`

register new Apple Devices to use for internal distribution

```
USAGE
  $ eas device:create
```

_See code: [build/commands/device/create.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/device/create.ts)_

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

## `eas login`

log in with your EAS account

```
USAGE
  $ eas login
```

_See code: [build/commands/login.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/login.ts)_

## `eas logout`

log out

```
USAGE
  $ eas logout
```

_See code: [build/commands/logout.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/logout.ts)_

## `eas update`

create a revision for given channel

```
USAGE
  $ eas update

ALIASES
  $ eas update:publish
```

_See code: [build/commands/update/index.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/update/index.ts)_

## `eas update:show`

details about a particular revision

```
USAGE
  $ eas update:show
```

_See code: [build/commands/update/show.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/update/show.ts)_

## `eas whoami`

show the username you are logged in as

```
USAGE
  $ eas whoami
```

_See code: [build/commands/whoami.ts](https://github.com/expo/eas-cli/blob/v0.1.0-alpha.0/build/commands/whoami.ts)_
<!-- commandsstop -->

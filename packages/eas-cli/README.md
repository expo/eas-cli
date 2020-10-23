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
eas-cli/0.0.0 darwin-x64 node-v12.13.0
$ eas --help [COMMAND]
USAGE
  $ eas COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`eas build`](#eas-build)
* [`eas build:status`](#eas-buildstatus)
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

## `eas build:status`

get the status of the latest builds for your project

```
USAGE
  $ eas build:status

OPTIONS
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished)
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

## `eas login`

log in with your EAS account

```
USAGE
  $ eas login
```

## `eas logout`

log out

```
USAGE
  $ eas logout
```

## `eas update`

create a revision for given channel

```
USAGE
  $ eas update

ALIASES
  $ eas update:publish
```

## `eas update:show`

details about a particular revision

```
USAGE
  $ eas update:show
```

## `eas whoami`

show the username you are logged in as

```
USAGE
  $ eas whoami
```
<!-- commandsstop -->

# eas-cli

EAS command line tool

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![CircleCI](https://circleci.com/gh/expo/eas-cli/tree/master.svg?style=shield)](https://circleci.com/gh/expo/eas-cli/tree/master)
[![Appveyor CI](https://ci.appveyor.com/api/projects/status/github/expo/eas-cli?branch=master&svg=true)](https://ci.appveyor.com/project/expo/eas-cli/branch/master)
[![Codecov](https://codecov.io/gh/expo/eas-cli/branch/master/graph/badge.svg)](https://codecov.io/gh/expo/eas-cli)
[![Downloads/week](https://img.shields.io/npm/dw/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![License](https://img.shields.io/npm/l/eas-cli.svg)](https://github.com/expo/eas-cli/blob/master/package.json)

<!-- toc -->

- [Usage](#usage)
- [Commands](#commands)
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

- [`eas build`](#eas-build)
- [`eas build:status`](#eas-buildstatus)
- [`eas help [COMMAND]`](#eas-help-command)
- [`eas login`](#eas-login)
- [`eas logout`](#eas-logout)
- [`eas update`](#eas-update)
- [`eas update:show`](#eas-updateshow)
- [`eas webhook:add`](#eas-webhookadd)
- [`eas webhook:list`](#eas-webhooklist)
- [`eas webhook:remove`](#eas-webhookremove)
- [`eas webhook:update`](#eas-webhookupdate)
- [`eas whoami`](#eas-whoami)

## `eas build`

build an app binary for your project

```
USAGE
  $ eas build
```

_See code: [@eas-cli/plugin-builds](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/build/index.ts)_

## `eas build:status`

get the status of the latest builds for your project

```
USAGE
  $ eas build:status

OPTIONS
  --platform=(all|android|ios)
  --status=(in-queue|in-progress|errored|finished)
```

_See code: [@eas-cli/plugin-builds](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/build/status.ts)_

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

_See code: [src/commands/login.ts](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/login.ts)_

## `eas logout`

log out

```
USAGE
  $ eas logout
```

_See code: [src/commands/logout.ts](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/logout.ts)_

## `eas update`

create a revision for given channel

```
USAGE
  $ eas update

ALIASES
  $ eas update:publish
```

_See code: [@eas-cli/plugin-updates](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/update/index.ts)_

## `eas update:show`

details about a particular revision

```
USAGE
  $ eas update:show
```

_See code: [@eas-cli/plugin-updates](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/update/show.ts)_

## `eas webhook:add`

add webhook to a project

```
USAGE
  $ eas webhook:add

OPTIONS
  --event=(build)
  --url=url        name to print

EXAMPLE
  $ eas webhook:add
  ✅ Adding webhook to @expo/example
```

_See code: [@eas-cli/plugin-webhooks](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/webhook/add.ts)_

## `eas webhook:list`

list all webhooks for a project

```
USAGE
  $ eas webhook:list

EXAMPLE
  $ eas webhook:list
```

_See code: [@eas-cli/plugin-webhooks](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/webhook/list.ts)_

## `eas webhook:remove`

delete a webhook

```
USAGE
  $ eas webhook:remove
```

_See code: [@eas-cli/plugin-webhooks](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/webhook/remove.ts)_

## `eas webhook:update`

update a webhook for a project

```
USAGE
  $ eas webhook:update

OPTIONS
  --event=(build)
  --url=url        name to print

EXAMPLE
  $ eas webhook:update
```

_See code: [@eas-cli/plugin-webhooks](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/webhook/update.ts)_

## `eas whoami`

show the username you are logged in as

```
USAGE
  $ eas whoami
```

_See code: [src/commands/whoami.ts](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/whoami.ts)_

<!-- commandsstop -->

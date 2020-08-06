eas-cli
=======

EAS command line tool

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![CircleCI](https://circleci.com/gh/expo/eas-cli/tree/master.svg?style=shield)](https://circleci.com/gh/expo/eas-cli/tree/master)
[![Appveyor CI](https://ci.appveyor.com/api/projects/status/github/expo/eas-cli?branch=master&svg=true)](https://ci.appveyor.com/project/expo/eas-cli/branch/master)
[![Codecov](https://codecov.io/gh/expo/eas-cli/branch/master/graph/badge.svg)](https://codecov.io/gh/expo/eas-cli)
[![Downloads/week](https://img.shields.io/npm/dw/eas-cli.svg)](https://npmjs.org/package/eas-cli)
[![License](https://img.shields.io/npm/l/eas-cli.svg)](https://github.com/expo/eas-cli/blob/master/package.json)

<!-- toc -->
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
* [`eas hello [FILE]`](#eas-hello-file)
* [`eas help [COMMAND]`](#eas-help-command)

## `eas hello [FILE]`

describe the command here

```
USAGE
  $ eas hello [FILE]

OPTIONS
  -f, --force
  -h, --help       show CLI help
  -n, --name=name  name to print

EXAMPLE
  $ eas hello
  hello world from ./src/hello.ts!
```

_See code: [src/commands/hello.ts](https://github.com/expo/eas-cli/blob/v0.0.0/src/commands/hello.ts)_

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
<!-- commandsstop -->

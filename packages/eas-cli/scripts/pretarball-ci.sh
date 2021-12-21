#!/usr/bin/env bash

set -eo pipefail

EAS_CLI_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
PACKAGE_JSON_PATH="$EAS_CLI_DIR/package.json"

if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\\\"@expo\/eas-json\\\": \\\".*\\\"/\\\"@expo\/eas-json\\\": \\\"file:..\/..\/..\/eas-json\\\"/g" $PACKAGE_JSON_PATH
else
  sed -i  "s/\\\"@expo\/eas-json\\\": \\\".*\\\"/\\\"@expo\/eas-json\\\": \\\"file:..\/..\/..\/eas-json\\\"/g" $PACKAGE_JSON_PATH
fi

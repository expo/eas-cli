#!/usr/bin/env bash

SED_INPLACE_OPT=(-i '')
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  SED_INPLACE_OPT=(-i)
fi

set -eo pipefail

if [[ "$npm_lifecycle_event" == "prepack" ]]; then
  echo 'Removing "dist_commonjs" and "dist_esm" folders...'
  rm -rf dist_commonjs dist_esm
fi

echo 'Compiling TypeScript to JavaScript...'
node_modules/.bin/tsc --project tsconfig.build.json

echo 'Compiling TypeScript to CommonJS JavaScript...'
node_modules/.bin/tsc --project tsconfig.build.commonjs.json

echo 'Renaming CommonJS file extensions to .cjs...'
find dist_commonjs -type f -name '*.js' -exec bash -c 'mv "$0" "${0%.*}.cjs"' {} \;

echo 'Rewriting module specifiers to .cjs...'
find dist_commonjs -type f -name '*.cjs' -exec sed "${SED_INPLACE_OPT[@]}" 's/require("\(\.[^"]*\)\.js")/require("\1.cjs")/g' {} \;

echo 'Finished compiling'

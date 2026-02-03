#!/usr/bin/env bash

set -eo pipefail
set -x

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/../.. && pwd )"
WORKER_DIR=$( dirname "${BASH_SOURCE[0]}" )

OUTPUT_FILE=$1
PLATFORM=$2

if [[ -z "$OUTPUT_FILE" || -z "$PLATFORM" ]]; then
  echo "Please specify the output file and target platform (.tar.gz)"
  echo "Usage: ./package.sh OUTPUT_FILE (ios|android)"
  echo "Example: ./package.sh worker.tar.gz ios"
  exit -1
fi

if [[ "$OUTPUT_FILE" != *.tar.gz ]]; then
  OUTPUT_FILE="$OUTPUT_FILE.tar.gz"
fi

echo "Building $OUTPUT_FILE"

tmp_dir=$(mktemp -d)
target_root_dir="$tmp_dir"
target_worker_dir="$tmp_dir/packages/worker"

mkdir -p "$target_worker_dir"

copy_package() {
  src=$1
  dst=$2
  mkdir -p $dst
  cp "$src/package.json" "$dst/package.json"
  if [[ -f "$src/tsconfig.json" ]]; then
    cp "$src/tsconfig.json" "$dst/tsconfig.json"
  fi
  if [[ -f "$src/tsconfig.build.json" ]]; then
    cp "$src/tsconfig.build.json" "$dst/tsconfig.build.json"
  fi
  cp -r "$src/src" "$dst/src"
  if [[ -d "$src/bin" ]]; then
    cp -r "$src/bin" "$dst/bin"
  fi
}

cp "$ROOT_DIR/yarn.lock" $target_root_dir
cp "$ROOT_DIR/package.json" $target_root_dir
cp "$ROOT_DIR/lerna.json" $target_root_dir

copy_package $WORKER_DIR $target_worker_dir
while IFS= read -r package_dir; do
  package_name=$(basename "$package_dir")
  copy_package "$package_dir" "$target_root_dir/packages/$package_name"
done <<< "$(yarn --silent lerna list --scope "@expo/worker" --include-dependencies --parseable --loglevel silent)"


pushd $target_root_dir >/dev/null 2>&1
yarn install --silent --frozen-lockfile
yarn build
yarn install --silent --production=true --frozen-lockfile
rm -rf tsconfig.json tsconfig.build.json
popd >/dev/null 2>&1

if [[ "$PLATFORM" == "ios" ]]; then
  # build plugin
  pushd "$ROOT_DIR/packages/expo-cocoapods-proxy" >/dev/null 2>&1
  if command -v brew &> /dev/null; then
    eval "$(brew shellenv)"
  else
    echo "Error: brew command not found in PATH. Please ensure Homebrew is installed and in your PATH." >&2
    exit 1
  fi
  bundle install
  gem build expo-cocoapods-proxy.gemspec
  mv expo-cocoapods-proxy-*.gem "$target_worker_dir/expo-cocoapods-proxy.gem"
  popd >/dev/null 2>&1
fi
rm -rf $target_root_dir/.volta/

# Create backward-compatible symlink for orchestrator
# The orchestrator expects ./src/services/worker/dist/main.js
# but the new structure has ./packages/worker/dist/main.js
# We're only symlinking the specific file to discover any other legacy path usage
mkdir -p "$target_root_dir/src/services/worker/dist"
ln -s ../../../../packages/worker/dist/main.js "$target_root_dir/src/services/worker/dist/main.js"

tar zcf $OUTPUT_FILE -C $target_root_dir .

echo "Tarball is ready: $OUTPUT_FILE"

rm -rf $tmp_dir

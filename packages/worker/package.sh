#!/usr/bin/env bash

set -eo pipefail
set -x

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/../../.. && pwd )"
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
target_worker_dir="$tmp_dir/src/services/worker"

mkdir -p "$target_worker_dir"

copy_package() {
  src=$1
  dst=$2
  mkdir -p $dst
  cp "$src/package.json" "$dst/package.json"
  cp "$src/tsconfig.json" "$dst/tsconfig.json"
  cp "$src/tsconfig.build.json" "$dst/tsconfig.build.json"
  cp -r "$src/src" "$dst/src"
}

cp "$ROOT_DIR/tsconfig.json" $target_root_dir
cp "$ROOT_DIR/yarn.lock" $target_root_dir
cp "$ROOT_DIR/package.json" $target_root_dir
cp -R "$ROOT_DIR/.volta" $target_root_dir
copy_package $WORKER_DIR $target_worker_dir
copy_package "$ROOT_DIR/src/libs/gcs" "$target_root_dir/src/libs/gcs"
copy_package "$ROOT_DIR/src/libs/turtle-common" "$target_root_dir/src/libs/turtle-common"

pushd $target_root_dir >/dev/null 2>&1
yarn install --silent
yarn build
yarn install --silent --production=true
rm -rf tsconfig.json tsconfig.build.json
popd >/dev/null 2>&1

if [[ "$PLATFORM" == "ios" ]]; then
  # build plugin
  pushd "$ROOT_DIR/src/cocoapods-plugins/expo-cocoapods-proxy" >/dev/null 2>&1
  eval $(/usr/local/bin/brew shellenv)
  bundle install
  gem build expo-cocoapods-proxy.gemspec
  mv expo-cocoapods-proxy-*.gem "$target_worker_dir/expo-cocoapods-proxy.gem"
  popd >/dev/null 2>&1
fi

rm -rf $target_root_dir/.volta/
tar zcf $OUTPUT_FILE -C $target_root_dir .

echo "Tarball is ready: $OUTPUT_FILE"

rm -rf $tmp_dir

#!/bin/bash

yarn build 
yarn workspace eas-cli pretarball-ci 
cp yarn-releases/*.cjs .yarn/releases
yarn set version 1.22.22
CLI_SIZE_CHECK=1 .yarn/releases/yarn-1.22.22.cjs workspace eas-cli oclif pack tarballs --no-xz --targets linux-x64 
cp yarn-releases/*.cjs .yarn/releases
yarn set version 4.9.1
rm -rf packages/eas-cli/tmp/eas/.yarnrc.yml packages/eas-cli/tmp/eas/.yarn/releases
cp -r .yarn/releases packages/eas-cli/tmp/eas/.yarn
cp -r .yarnrc.yml packages/eas-cli/tmp/eas
cd packages/eas-cli/tmp/eas
yarn
cd ..
tar zcf ../dist/eas*.tar.gz eas

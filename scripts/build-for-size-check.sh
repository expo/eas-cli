#!/bin/bash

yarn build 
yarn workspace eas-cli pretarball-ci 
cp yarn-releases/*.cjs .yarn/releases
yarn set version 1.22.22
CLI_SIZE_CHECK=1 .yarn/releases/yarn-1.22.22.cjs workspace eas-cli oclif pack tarballs --no-xz --targets linux-x64 
cp yarn-releases/*.cjs .yarn/releases
yarn set version 4.9.1

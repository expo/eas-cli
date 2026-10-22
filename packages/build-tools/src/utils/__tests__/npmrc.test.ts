import { vol } from 'memfs';
import os from 'os';

import { createMockLogger } from '../../__tests__/utils/logger';
import { NpmrcAuthTokenLine, NpmrcTemplate } from '../../templates/npmrc';
import { setUpNpmrcAsync } from '../npmrc';

jest.mock('fs');

const projectTargetDirectory = '/workingdir/build';
const homeDirectory = '/home/expo';

describe(setUpNpmrcAsync, () => {
  beforeEach(async () => {
    vol.reset();
    await vol.promises.mkdir(projectTargetDirectory, { recursive: true });
    await vol.promises.mkdir(homeDirectory, { recursive: true });
    jest.spyOn(os, 'homedir').mockReturnValue(homeDirectory);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds the NPM_TOKEN placeholder to ~/.npmrc on EAS Build and leaves the project .npmrc alone', async () => {
    const projectContents = '//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}\n';
    await vol.promises.writeFile(`${projectTargetDirectory}/.npmrc`, projectContents);
    await vol.promises.writeFile(`${homeDirectory}/.npmrc`, 'fund=false');

    await setUpNpmrcAsync({
      projectTargetDirectory,
      workingDirectory: projectTargetDirectory,
      env: { NPM_TOKEN: 'npm_secret_token', EAS_BUILD_RUNNER: 'eas-build' },
      logger: createMockLogger(),
    });

    expect(await vol.promises.readFile(`${homeDirectory}/.npmrc`, 'utf8')).toBe(
      `fund=false\n${NpmrcAuthTokenLine}\n`
    );
    expect(await vol.promises.readFile(`${projectTargetDirectory}/.npmrc`, 'utf8')).toBe(
      projectContents
    );
  });

  it('creates the project .npmrc on local builds', async () => {
    await setUpNpmrcAsync({
      projectTargetDirectory,
      workingDirectory: projectTargetDirectory,
      env: { NPM_TOKEN: 'npm_secret_token', EAS_BUILD_RUNNER: 'local-build-plugin' },
      logger: createMockLogger(),
    });

    expect(await vol.promises.readFile(`${projectTargetDirectory}/.npmrc`, 'utf8')).toBe(
      NpmrcTemplate
    );
    expect(vol.existsSync(`${homeDirectory}/.npmrc`)).toBe(false);
  });

  it('leaves an existing project .npmrc untouched on local builds', async () => {
    const existingContents = 'registry=https://registry.example.com/\n';
    await vol.promises.writeFile(`${projectTargetDirectory}/.npmrc`, existingContents);

    await setUpNpmrcAsync({
      projectTargetDirectory,
      workingDirectory: projectTargetDirectory,
      env: { NPM_TOKEN: 'npm_secret_token', EAS_BUILD_RUNNER: 'local-build-plugin' },
      logger: createMockLogger(),
    });

    expect(await vol.promises.readFile(`${projectTargetDirectory}/.npmrc`, 'utf8')).toBe(
      existingContents
    );
  });

  it('reports an existing .npmrc when NPM_TOKEN is not set', async () => {
    const logger = createMockLogger();
    await vol.promises.writeFile(
      `${projectTargetDirectory}/.npmrc`,
      'registry=https://registry.example.com/\n'
    );

    await setUpNpmrcAsync({
      projectTargetDirectory,
      workingDirectory: projectTargetDirectory,
      env: { EAS_BUILD_RUNNER: 'eas-build' },
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith('.npmrc found at .npmrc');
    expect(vol.existsSync(`${homeDirectory}/.npmrc`)).toBe(false);
  });
});

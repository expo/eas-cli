import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';

import { createMockLogger } from '../../__tests__/utils/logger';
import { NpmrcAuthTokenLine, NpmrcTemplate } from '../../templates/npmrc';
import { setUpNpmrcAsync } from '../npmrc';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const projectTargetDirectory = '/workingdir/build';
const homeDirectory = '/home/expo';

describe(setUpNpmrcAsync, () => {
  beforeEach(async () => {
    vol.reset();
    await vol.promises.mkdir(projectTargetDirectory, { recursive: true });
    await vol.promises.mkdir(homeDirectory, { recursive: true });
    jest.mocked(spawn).mockResolvedValue({ stdout: `${homeDirectory}/.npmrc\n` } as never);
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

  it('adds the NPM_TOKEN placeholder to the user config file npm resolves from the build env', async () => {
    await vol.promises.mkdir(`${homeDirectory}/npm`, { recursive: true });
    jest.mocked(spawn).mockResolvedValueOnce({ stdout: `${homeDirectory}/npm/npmrc\n` } as never);
    const env = {
      NPM_TOKEN: 'npm_secret_token',
      EAS_BUILD_RUNNER: 'eas-build',
      NPM_CONFIG_USERCONFIG: '~/npm/npmrc',
    };

    await setUpNpmrcAsync({
      projectTargetDirectory,
      workingDirectory: projectTargetDirectory,
      env,
      logger: createMockLogger(),
    });

    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['config', 'get', 'userconfig'],
      expect.objectContaining({ cwd: projectTargetDirectory, env })
    );
    expect(await vol.promises.readFile(`${homeDirectory}/npm/npmrc`, 'utf8')).toBe(
      `\n${NpmrcAuthTokenLine}\n`
    );
    expect(vol.existsSync(`${homeDirectory}/.npmrc`)).toBe(false);
  });

  it('creates the project .npmrc and leaves the user npmrc alone on local builds', async () => {
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

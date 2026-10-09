// @ts-nocheck
import { RuntimeSettings } from '@expo/build-tools';
import { Android, Ios, Job } from '@expo/eas-build-job';
import templateFile from '@expo/template-file';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import { mkdirp, pathExists } from 'fs-extra';

import config from '../config';
import {
  prepareRuntimeEnvironment,
  prepareRuntimeEnvironmentConfigFiles,
} from '../runtimeEnvironment';

jest.mock('fs-extra');
jest.mock('@expo/template-file');
jest.mock('@expo/turtle-spawn');

const spawnResult: SpawnResult = {
  output: ['stdout'],
  status: 0,
  signal: null,
  stdout: '',
  stderr: '',
};
const ctx = {
  workingdir: '/tmp/workingdir',
  env: {
    ...process.env,
    EAS_BUILD_ID: 'build-id',
  },
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(),
  },
  job: {} as Job,
};
const builderConfig: Ios.BuilderEnvironment | Android.BuilderEnvironment = {};

describe('prepareRuntimeEnvironment', () => {
  const originalEnvironment = config.env;
  const originalPlatform = process.platform;
  const originalCacheUrls = {
    EAS_NPM_CACHE_URL: process.env.EAS_NPM_CACHE_URL,
    EAS_MAVEN_CACHE_URL: process.env.EAS_MAVEN_CACHE_URL,
  };

  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  afterEach(() => {
    config.env = originalEnvironment;
    restoreEnv('EAS_NPM_CACHE_URL', originalCacheUrls.EAS_NPM_CACHE_URL);
    restoreEnv('EAS_MAVEN_CACHE_URL', originalCacheUrls.EAS_MAVEN_CACHE_URL);
    mockProcessPlatform(originalPlatform);
    jest.restoreAllMocks();
  });

  describe(prepareRuntimeEnvironmentConfigFiles.name, () => {
    beforeEach(() => {
      config.env = 'production';
      process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
      process.env.EAS_MAVEN_CACHE_URL = 'https://maven.example';
    });

    it('does not prepare disabled Linux cache config files', async () => {
      mockProcessPlatform('linux');
      jest.spyOn(RuntimeSettings, 'getNpmCacheUrl').mockReturnValue(null);
      jest.spyOn(RuntimeSettings, 'getMavenCacheUrl').mockReturnValue(null);

      await prepareRuntimeEnvironmentConfigFiles();

      expect(spawn).not.toHaveBeenCalledWith('npm', [
        'config',
        'set',
        'registry',
        'https://npm.example',
      ]);
      expect(templateFile).not.toHaveBeenCalled();
      expect(mkdirp).not.toHaveBeenCalled();
    });

    it('prepares enabled Linux cache config files', async () => {
      mockProcessPlatform('linux');
      jest.spyOn(RuntimeSettings, 'getNpmCacheUrl').mockReturnValue('https://npm.example');
      jest.spyOn(RuntimeSettings, 'getMavenCacheUrl').mockReturnValue('https://maven.example');

      await prepareRuntimeEnvironmentConfigFiles();

      expect(spawn).not.toHaveBeenCalledWith('npm', [
        'config',
        'set',
        'registry',
        'https://npm.example',
      ]);
      expect(templateFile).toHaveBeenCalledWith(
        expect.stringContaining('yarnrc.yml'),
        { URL: 'https://npm.example' },
        expect.stringContaining('.yarnrc.yml')
      );
      expect(templateFile).toHaveBeenCalledWith(
        expect.stringContaining('init.gradle'),
        { URL: 'https://maven.example' },
        expect.stringContaining('init.gradle')
      );
    });
  });

  describe('installNode', () => {
    describe('prepareRuntimeEnvironment', () => {
      beforeEach(() => {
        jest.mocked(pathExists).mockResolvedValue(true);

        jest.mocked(spawn).mockImplementation((cmd, _args, opts) => {
          if (cmd === 'bash') {
            return Promise.resolve({
              ...spawnResult,
              stdout:
                'Downloading and installing node v16.20.1...\nNow using node v16.20.1 (npm v8.19.4)\n',
            });
          }
          return Promise.resolve(spawnResult);
        });
        jest.mocked(spawn).mockResolvedValue(spawnResult);
      });

      it('should install the specified version of Node.js', async () => {
        const version = '16.20.1';
        builderConfig.node = version;
        await prepareRuntimeEnvironment(ctx, builderConfig, false);
        expect(spawn).toHaveBeenCalledWith(
          'bash',
          expect.arrayContaining([expect.stringContaining(`nvm install ${version}`)]),
          expect.anything()
        );
      });

      it('handles non-semver version of node', async () => {
        const version = 'v16';
        builderConfig.node = version;
        await prepareRuntimeEnvironment(ctx, builderConfig, false);
        expect(spawn).toHaveBeenCalledWith(
          'bash',
          expect.arrayContaining([expect.stringContaining(`nvm install ${version}`)]),
          expect.anything()
        );
      });

      it('uses Corepack to install package managers after installing custom Node.js', async () => {
        const testCtx = { ...ctx, env: { ...ctx.env } };
        mockRuntimeEnvironmentVersions();

        await prepareRuntimeEnvironment(
          testCtx,
          {
            node: '22.20.0',
            corepack: true,
            pnpm: '9.15.5',
            yarn: '1.22.22',
          },
          false
        );

        expect(spawn).toHaveBeenCalledWith('corepack', ['enable'], expect.anything());
        expect(spawn).toHaveBeenCalledWith(
          'corepack',
          ['prepare', 'pnpm@9.15.5', '--activate'],
          expect.anything()
        );
        expect(spawn).toHaveBeenCalledWith(
          'corepack',
          ['prepare', 'yarn@1.22.22', '--activate'],
          expect.anything()
        );
        expect(spawn).not.toHaveBeenCalledWith(
          'npm',
          ['-g', 'install', 'pnpm@9.15.5'],
          expect.anything()
        );
        expect(spawn).not.toHaveBeenCalledWith(
          'npm',
          ['-g', 'install', 'yarn@1.22.22'],
          expect.anything()
        );
      });

      it('uses npm to install package managers when Corepack is disabled', async () => {
        const testCtx = { ...ctx, env: { ...ctx.env } };
        mockRuntimeEnvironmentVersions();

        await prepareRuntimeEnvironment(
          testCtx,
          {
            node: '22.20.0',
            pnpm: '9.15.5',
            yarn: '1.22.22',
          },
          false
        );

        expect(spawn).toHaveBeenCalledWith(
          'npm',
          ['-g', 'install', 'pnpm@9.15.5'],
          expect.anything()
        );
        expect(spawn).toHaveBeenCalledWith(
          'npm',
          ['-g', 'install', 'yarn@1.22.22'],
          expect.anything()
        );
        expect(spawn).not.toHaveBeenCalledWith(
          'corepack',
          expect.arrayContaining(['prepare']),
          expect.anything()
        );
      });

      it('installs Bun when a specified version is different from installed version', async () => {
        let isFirstTimeCheckingBunVersion = true;
        jest.mocked(spawn).mockImplementation((cmd, _args, _opts) => {
          if (cmd === 'bun') {
            const stdout = isFirstTimeCheckingBunVersion ? '1.0.0' : '2.0.0';
            isFirstTimeCheckingBunVersion = false;
            return Promise.resolve({
              ...spawnResult,
              stdout,
            });
          }
          return Promise.resolve(spawnResult);
        });

        await prepareRuntimeEnvironment(ctx, { bun: '2.0.0' }, false);

        expect(spawn).toHaveBeenCalledWith(
          'yarn',
          ['--version'],
          expect.objectContaining({ stdio: 'pipe', cwd: expect.any(String) })
        );
        expect(spawn).toHaveBeenCalledWith(
          'pnpm',
          ['--version'],
          expect.objectContaining({ stdio: 'pipe', cwd: expect.any(String) })
        );
        expect(spawn).toHaveBeenCalledWith(
          'bun',
          ['--version'],
          expect.objectContaining({ stdio: 'pipe', cwd: expect.any(String) })
        );

        expect(spawn).toHaveBeenCalledWith(
          'curl',
          ['-fsSL', 'https://bun.sh/install', '-o', expect.anything()],
          expect.anything()
        );

        expect(spawn).toHaveBeenCalledWith(
          'bash',
          [expect.anything(), 'bun-v2.0.0'],
          expect.anything()
        );

        expect(spawn).toHaveBeenCalledWith('rm', [expect.anything()], expect.anything());

        expect(spawn).toHaveBeenCalledWith('bun', ['--version'], expect.anything());
      });

      it('does not install Bun when a specified version is the same as the installed version', async () => {
        jest.mocked(spawn).mockImplementation((cmd, _args, _opts) => {
          if (cmd === 'bun') {
            return Promise.resolve({
              ...spawnResult,
              stdout: '2.0.0',
            });
          }
          return Promise.resolve(spawnResult);
        });

        await prepareRuntimeEnvironment(ctx, { bun: '2.0.0' }, false);

        expect(spawn).toHaveBeenCalledWith(
          'yarn',
          ['--version'],
          expect.objectContaining({ stdio: 'pipe', cwd: expect.any(String) })
        );
        expect(spawn).toHaveBeenCalledWith(
          'pnpm',
          ['--version'],
          expect.objectContaining({ stdio: 'pipe', cwd: expect.any(String) })
        );
        expect(spawn).toHaveBeenCalledWith(
          'bun',
          ['--version'],
          expect.objectContaining({ stdio: 'pipe', cwd: expect.any(String) })
        );

        expect(spawn).not.toHaveBeenCalledWith(
          'curl',
          ['-fsSL', 'https://bun.sh/install', '-o', expect.anything()],
          expect.anything()
        );
      });
    });

    it('should throw an error if installation fails', async () => {
      const version = 'invalid-version';
      builderConfig.node = version;

      jest.mocked(spawn).mockImplementation((cmd, _args, _opts) => {
        if (cmd === 'bash') {
          return Promise.resolve({
            ...spawnResult,
            output: [
              '',
              "Version 'invalid-version' not found - try `nvm ls-remote` to browse available versions.\n",
            ],
            stdout: '',
            stderr:
              "Version 'invalid-version' not found - try `nvm ls-remote` to browse available versions.\n",
            status: 3,
          });
        }
        return Promise.resolve(spawnResult);
      });
      jest.mocked(pathExists).mockResolvedValue(false);
      await expect(prepareRuntimeEnvironment(ctx, builderConfig, false)).rejects.toThrow(
        'Failed to install Node.js'
      );
    });
  });
});

function mockProcessPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

function mockRuntimeEnvironmentVersions(): void {
  jest.mocked(spawn).mockImplementation((cmd, args) => {
    if (cmd === 'bash' && args[1]?.includes('nvm install')) {
      return Promise.resolve({
        ...spawnResult,
        stdout: 'Now using node v22.20.0 (npm v10.9.3)\n',
      });
    } else if (cmd === 'pnpm') {
      return Promise.resolve({ ...spawnResult, stdout: '9.15.5\n' });
    } else if (cmd === 'yarn') {
      return Promise.resolve({ ...spawnResult, stdout: '1.22.22\n' });
    } else if (cmd === 'bun') {
      return Promise.resolve({ ...spawnResult, stdout: '1.2.23\n' });
    } else if (cmd === 'sharp') {
      return Promise.resolve({ ...spawnResult, stdout: '5.2.0\n' });
    }
    return Promise.resolve(spawnResult);
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

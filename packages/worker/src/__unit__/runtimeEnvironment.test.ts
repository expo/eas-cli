// @ts-nocheck
import { Android, Ios, Job } from '@expo/eas-build-job';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import { pathExists } from 'fs-extra';
import config from '../config';
import { prepareRuntimeEnvironment } from '../runtimeEnvironment';

jest.mock('fs-extra');
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
  beforeEach(() => {
    jest.mocked(spawn).mockReset();
    jest.mocked(spawn).mockResolvedValue(spawnResult);
    jest.clearAllMocks();
    ctx.job = {} as Job;
    ctx.env = {
      ...process.env,
      EAS_BUILD_ID: 'build-id',
    };
    delete ctx.env.GITHUB;
    builderConfig.node = undefined;
    builderConfig.bun = undefined;
    config.cocoapodsCacheUrl = null;
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

      it('proxies Bun install script and GitHub release ZIP downloads through CocoaPods cache on iOS', async () => {
        let isFirstTimeCheckingBunVersion = true;
        config.cocoapodsCacheUrl = 'https://cocoapods-cache.example.com';

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
          'curl',
          ['-fsSL', 'https://cocoapods-cache.example.com/bun.sh/install', '-o', expect.anything()],
          expect.anything()
        );
        expect(spawn).toHaveBeenCalledWith(
          'bash',
          [expect.anything(), 'bun-v2.0.0'],
          expect.objectContaining({
            env: expect.objectContaining({
              GITHUB: 'https://cocoapods-cache.example.com/github.com',
            }),
          })
        );
      });

      it('retries Bun install script download without proxy when CocoaPods cache request fails', async () => {
        let isFirstTimeCheckingBunVersion = true;
        let bunInstallScriptCurlAttempts = 0;
        config.cocoapodsCacheUrl = 'https://cocoapods-cache.example.com';

        jest.mocked(spawn).mockImplementation((cmd, args, _opts) => {
          if (cmd === 'bun') {
            const stdout = isFirstTimeCheckingBunVersion ? '1.0.0' : '2.0.0';
            isFirstTimeCheckingBunVersion = false;
            return Promise.resolve({
              ...spawnResult,
              stdout,
            });
          }
          if (cmd === 'curl' && args[1] === 'https://cocoapods-cache.example.com/bun.sh/install') {
            bunInstallScriptCurlAttempts += 1;
            return Promise.reject(new Error('proxy download failed'));
          }
          return Promise.resolve(spawnResult);
        });

        await prepareRuntimeEnvironment(ctx, { bun: '2.0.0' }, false);

        expect(bunInstallScriptCurlAttempts).toBe(1);
        expect(spawn).toHaveBeenCalledWith(
          'curl',
          ['-fsSL', 'https://bun.sh/install', '-o', expect.anything()],
          expect.anything()
        );
        expect(ctx.logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Failed to download Bun install script through proxy, retrying directly.'
        );
      });

      it('retries Bun installation without proxy when proxied release ZIP download fails', async () => {
        let isFirstTimeCheckingBunVersion = true;
        let proxiedInstallAttempted = false;
        config.cocoapodsCacheUrl = 'https://cocoapods-cache.example.com';

        jest.mocked(spawn).mockImplementation((cmd, _args, opts) => {
          if (cmd === 'bun') {
            const stdout = isFirstTimeCheckingBunVersion ? '1.0.0' : '2.0.0';
            isFirstTimeCheckingBunVersion = false;
            return Promise.resolve({
              ...spawnResult,
              stdout,
            });
          }
          if (
            cmd === 'bash' &&
            opts?.env?.GITHUB === 'https://cocoapods-cache.example.com/github.com'
          ) {
            proxiedInstallAttempted = true;
            return Promise.reject(new Error('proxied bun install failed'));
          }
          return Promise.resolve(spawnResult);
        });

        await prepareRuntimeEnvironment(ctx, { bun: '2.0.0' }, false);

        expect(proxiedInstallAttempted).toBe(true);
        expect(spawn).toHaveBeenCalledWith(
          'bash',
          [expect.anything(), 'bun-v2.0.0'],
          expect.objectContaining({
            env: expect.not.objectContaining({
              GITHUB: expect.anything(),
            }),
          })
        );
        expect(ctx.logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Failed to install Bun through proxy, retrying directly.'
        );
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

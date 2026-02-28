// @ts-nocheck
import { BuildContext } from '@expo/build-tools';
import { Android, Ios, Job } from '@expo/eas-build-job';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import { pathExists } from 'fs-extra';

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
const ctx: BuildContext<Job> = {
  env: process.env,
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
    jest.mocked(pathExists).mockReset();
    jest.mocked(ctx.logger.info).mockReset();
    jest.mocked(ctx.logger.warn).mockReset();
    jest.mocked(ctx.logger.error).mockReset();
    ctx.env = { ...process.env };
    builderConfig.node = undefined;
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

    it('logs nvm ls-remote output after install failure', async () => {
      const version = 'invalid-version';
      builderConfig.node = version;

      jest.mocked(spawn).mockImplementation((cmd, args, _opts) => {
        if (cmd === 'bash' && args?.[1]?.includes('nvm install')) {
          return Promise.reject(new Error('nvm install failed'));
        }
        if (cmd === 'bash' && args?.[1]?.includes('nvm ls-remote')) {
          return Promise.resolve({
            ...spawnResult,
            stdout: 'v20.18.0\nv20.18.1\n',
          });
        }
        return Promise.resolve(spawnResult);
      });
      jest.mocked(pathExists).mockResolvedValue(true);

      await expect(prepareRuntimeEnvironment(ctx, builderConfig, false)).rejects.toThrow(
        'Failed to install Node.js'
      );
      expect(spawn).toHaveBeenCalledWith(
        'bash',
        ['-c', 'source ~/.nvm/nvm.sh && nvm ls-remote'],
        expect.objectContaining({ stdio: 'pipe', env: ctx.env })
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('nvm ls-remote output'));
    });

    it('retries node install without NVM_NODEJS_ORG_MIRROR', async () => {
      const version = '20.18.1';
      builderConfig.node = version;
      ctx.env.NVM_NODEJS_ORG_MIRROR = 'https://example-mirror.invalid';

      let installAttempt = 0;
      jest.mocked(spawn).mockImplementation((cmd, args, _opts) => {
        if (cmd === 'bash' && args?.[1]?.includes('nvm install')) {
          installAttempt += 1;
          if (installAttempt === 1) {
            return Promise.reject(new Error('first install failed'));
          }
          return Promise.resolve({
            ...spawnResult,
            stdout:
              'Downloading and installing node v20.18.1...\nNow using node v20.18.1 (npm v10.8.2)\n',
          });
        }
        if (cmd === 'bash' && args?.[1]?.includes('nvm ls-remote')) {
          return Promise.resolve({
            ...spawnResult,
            stdout: 'v20.18.0\nv20.18.1\n',
          });
        }
        return Promise.resolve(spawnResult);
      });
      jest.mocked(pathExists).mockResolvedValue(true);

      await expect(prepareRuntimeEnvironment(ctx, builderConfig, false)).resolves.toBeUndefined();

      const installCalls = jest
        .mocked(spawn)
        .mock.calls.filter(([cmd, args]) => cmd === 'bash' && args?.[1]?.includes('nvm install'));
      expect(installCalls).toHaveLength(2);

      const firstAttemptEnv = installCalls[0][2].env;
      const secondAttemptEnv = installCalls[1][2].env;
      expect(firstAttemptEnv.NVM_NODEJS_ORG_MIRROR).toBe('https://example-mirror.invalid');
      expect(secondAttemptEnv.NVM_NODEJS_ORG_MIRROR).toBeUndefined();
    });

    it('throws when retry also fails', async () => {
      const version = 'invalid-version';
      builderConfig.node = version;
      ctx.env.NVM_NODEJS_ORG_MIRROR = 'https://example-mirror.invalid';

      let installAttempt = 0;
      jest.mocked(spawn).mockImplementation((cmd, args, _opts) => {
        if (cmd === 'bash' && args?.[1]?.includes('nvm install')) {
          installAttempt += 1;
          return Promise.reject(new Error(`nvm install failed on attempt ${installAttempt}`));
        }
        if (cmd === 'bash' && args?.[1]?.includes('nvm ls-remote')) {
          return Promise.resolve({
            ...spawnResult,
            stdout: 'v20.18.0\n',
          });
        }
        return Promise.resolve(spawnResult);
      });
      jest.mocked(pathExists).mockResolvedValue(true);

      await expect(prepareRuntimeEnvironment(ctx, builderConfig, false)).rejects.toThrow(
        'Failed to install Node.js'
      );

      const installCalls = jest
        .mocked(spawn)
        .mock.calls.filter(([cmd, args]) => cmd === 'bash' && args?.[1]?.includes('nvm install'));
      const lsRemoteCalls = jest
        .mocked(spawn)
        .mock.calls.filter(([cmd, args]) => cmd === 'bash' && args?.[1]?.includes('nvm ls-remote'));
      expect(installCalls).toHaveLength(2);
      expect(lsRemoteCalls).toHaveLength(2);
    });
  });
});

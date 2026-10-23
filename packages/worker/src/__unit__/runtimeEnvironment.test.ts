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

  it.each([
    { name: 'default', flag: undefined, sessionId: undefined, skip: false },
    { name: 'disabled', flag: '1', sessionId: undefined, skip: true },
    { name: 'zero', flag: '0', sessionId: undefined, skip: false },
    { name: 'other value', flag: 'true', sessionId: undefined, skip: false },
    { name: 'session ID only', flag: undefined, sessionId: 'session-id', skip: false },
  ])(
    'skips the CocoaPods proxy only with an explicit flag: $name',
    async ({ flag, sessionId, skip }) => {
      mockProcessPlatform('darwin');
      jest.mocked(spawn).mockResolvedValue(spawnResult);
      const builderEnvironment = {
        env: {
          ...(flag !== undefined ? { EAS_BUILD_DISABLE_COCOAPODS_CACHE_PLUGIN: flag } : {}),
          ...(sessionId ? { DEVICE_RUN_SESSION_ID: sessionId } : {}),
        },
      };

      await prepareRuntimeEnvironment(
        { ...ctx, job: { builderEnvironment } },
        builderEnvironment,
        false /* skipIfTest */
      );

      const proxyInstalls = jest
        .mocked(spawn)
        .mock.calls.filter(
          ([command, args]) =>
            command === 'sudo' &&
            args.some(argument => argument.endsWith('expo-cocoapods-proxy.gem'))
        );
      expect(proxyInstalls).toHaveLength(skip ? 0 : 1);
      expect(spawn).toHaveBeenCalledWith('bun', ['--version'], expect.anything());
    }
  );

  it('queries package-manager versions in parallel before applying tool overrides', async () => {
    mockProcessPlatform('linux');
    const resolveVersion = new Map<string, (value: SpawnResult) => void>();
    jest.mocked(spawn).mockImplementation((command, args) => {
      if (['yarn', 'pnpm', 'bun'].includes(command) && args[0] === '--version') {
        return new Promise(resolve => resolveVersion.set(command, resolve));
      }
      return Promise.resolve(spawnResult);
    });

    const preparing = prepareRuntimeEnvironment(ctx, { corepack: true }, false /* skipIfTest */);
    expect([...resolveVersion.keys()]).toEqual(['yarn', 'pnpm', 'bun']);
    expect(spawn).not.toHaveBeenCalledWith('corepack', ['enable'], expect.anything());

    resolveVersion.get('pnpm')!({ ...spawnResult, stdout: '9.0.0\n' });
    resolveVersion.get('bun')!({ ...spawnResult, stdout: '1.0.0\n' });
    await Promise.resolve();
    expect(spawn).not.toHaveBeenCalledWith('corepack', ['enable'], expect.anything());
    resolveVersion.get('yarn')!({ ...spawnResult, stdout: '1.22.0\n' });
    await preparing;
    expect(spawn).toHaveBeenCalledWith('corepack', ['enable'], expect.anything());
  });

  describe('installNode', () => {
    describe('prepareRuntimeEnvironment', () => {
      beforeEach(() => {
        jest.spyOn(RuntimeSettings, 'getNodeJsCacheUrl').mockReturnValue('https://node.example');
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

      it.each([
        {
          mirror: 'https://node.example',
          failures: 0,
          attempts: ['https://node.example'],
          succeeds: true,
        },
        {
          mirror: 'https://node.example',
          failures: 1,
          attempts: ['https://node.example', undefined],
          succeeds: true,
        },
        {
          mirror: 'https://node.example',
          failures: 2,
          attempts: ['https://node.example', undefined],
          succeeds: false,
        },
        {
          mirror: 'https://private.example',
          failures: 1,
          attempts: ['https://private.example'],
          succeeds: false,
        },
        {
          mirror: 'https://node.example',
          cacheUrl: null,
          failures: 1,
          attempts: ['https://node.example'],
          succeeds: false,
        },
        { mirror: undefined, failures: 1, attempts: [undefined], succeeds: false },
        { mirror: '', failures: 1, attempts: [''], succeeds: false },
      ])(
        'handles Node.js install with mirror=$mirror and failures=$failures',
        async ({ mirror, failures, attempts, succeeds, cacheUrl = 'https://node.example' }) => {
          jest.mocked(RuntimeSettings.getNodeJsCacheUrl).mockReturnValue(cacheUrl);
          const buildContext = {
            ...ctx,
            env: { ...ctx.env, PATH: '/usr/bin', NVM_NODEJS_ORG_MIRROR: mirror },
          };
          const installMirrors: (string | undefined)[] = [];
          jest.mocked(spawn).mockImplementation(async (cmd, args, opts) => {
            if (cmd === 'bash' && args[1].includes('nvm install')) {
              installMirrors.push(opts?.env?.NVM_NODEJS_ORG_MIRROR);
              if (installMirrors.length <= failures) {
                throw new Error('Node.js download failed');
              }
              return { ...spawnResult, stdout: 'Now using node v16.20.1 (npm v8.19.4)' };
            }
            return spawnResult;
          });

          const preparation = prepareRuntimeEnvironment(buildContext, { node: 'v16' }, false);
          if (succeeds) {
            await preparation;
            expect(buildContext.env.PATH).toMatch(
              /\/\.nvm\/versions\/node\/v16\.20\.1\/bin:\/usr\/bin$/
            );
            expect(spawn).toHaveBeenCalledWith(
              'bash',
              ['-c', 'source ~/.nvm/nvm.sh && nvm alias default 16.20.1'],
              expect.anything()
            );
            expect(ctx.logger.error).not.toHaveBeenCalled();
          } else {
            await expect(preparation).rejects.toThrow('Failed to install Node.js.');
            expect(buildContext.env.PATH).toBe('/usr/bin');
          }
          expect(installMirrors).toStrictEqual(attempts);
          expect(buildContext.env.NVM_NODEJS_ORG_MIRROR).toBe(attempts[attempts.length - 1]);
        }
      );

      it('does not retry Node.js installation when setting the default alias fails', async () => {
        const buildContext = {
          ...ctx,
          env: { ...ctx.env, NVM_NODEJS_ORG_MIRROR: 'https://node.example' },
        };
        let installCount = 0;
        jest.mocked(spawn).mockImplementation(async (cmd, args) => {
          if (cmd === 'bash' && args[1].includes('nvm install')) {
            installCount++;
          }
          if (cmd === 'bash' && args[1].includes('nvm alias')) {
            throw new Error('Cannot write default alias');
          }
          return spawnResult;
        });

        await expect(
          prepareRuntimeEnvironment(buildContext, { node: '16.20.1' }, false)
        ).rejects.toThrow('Failed to install Node.js.');
        expect(installCount).toBe(1);
        expect(buildContext.env.NVM_NODEJS_ORG_MIRROR).toBe('https://node.example');
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

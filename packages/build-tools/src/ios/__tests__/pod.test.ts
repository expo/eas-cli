import { Ios } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { installPods } from '../pod';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const WORKING_DIR = '/workingdir';
const PROJECT_DIR = path.join(WORKING_DIR, 'build');
const IOS_DIR = path.join(PROJECT_DIR, 'ios');

function makeIosBuildContext({
  expoVersion,
  usePrecompiledModules = true,
}: {
  expoVersion?: string;
  usePrecompiledModules?: boolean;
}): BuildContext<Ios.Job> {
  vol.fromJSON({
    [path.join(IOS_DIR, '.keep')]: '',
    ...(expoVersion
      ? {
          [path.join(PROJECT_DIR, 'node_modules/expo/package.json')]: JSON.stringify({
            version: expoVersion,
          }),
        }
      : {}),
  });

  const job: Ios.Job = {
    ...createTestIosJob(),
    builderEnvironment: {
      env: {
        ...(usePrecompiledModules ? { EAS_USE_PRECOMPILED_MODULES: '1' } : {}),
      },
    },
  };

  return new BuildContext(job, {
    workingdir: WORKING_DIR,
    logger: createMockLogger(),
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    env: { __API_SERVER_URL: 'http://api.expo.test' },
    uploadArtifact: jest.fn(),
  });
}

describe(installPods, () => {
  beforeEach(() => {
    vol.reset();
    (spawn as jest.Mock).mockImplementation(command => {
      if (command === 'node') {
        return Promise.resolve({
          stdout: Buffer.from(path.join(PROJECT_DIR, 'node_modules/expo/package.json')),
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it('adds precompiled modules env var for Expo versions that support them', async () => {
    const ctx = makeIosBuildContext({ expoVersion: '55.0.18' });

    await installPods(ctx, {});

    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['--print', "require.resolve('expo/package.json')"],
      expect.objectContaining({
        cwd: PROJECT_DIR,
        env: expect.objectContaining({
          __API_SERVER_URL: 'http://api.expo.test',
        }),
        stdio: 'pipe',
      })
    );
    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({
        cwd: IOS_DIR,
        env: expect.objectContaining({
          EXPO_USE_PRECOMPILED_MODULES: '1',
        }),
      })
    );
    expect(
      (spawn as jest.Mock).mock.calls[1][2].env.EXPO_PRECOMPILED_MODULES_BASE_URL
    ).toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Detected expo=55.0.18; enabling precompiled modules use. Installing pods with additional environment variables.\nEXPO_USE_PRECOMPILED_MODULES=1\nPrecompiled modules pod install environment is configured.'
    );
  });

  it('does not add precompiled modules env vars below the minimum Expo version', async () => {
    const ctx = makeIosBuildContext({ expoVersion: '55.0.17' });

    await installPods(ctx, {});

    expect((spawn as jest.Mock).mock.calls[1][2].env.EXPO_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Detected expo=55.0.17; not enabling precompiled modules use because precompiled modules require expo>=55.0.18.'
    );
  });

  it('does not add precompiled modules env vars when Expo version is invalid', async () => {
    const ctx = makeIosBuildContext({ expoVersion: 'invalid-version' });

    await installPods(ctx, {});

    expect((spawn as jest.Mock).mock.calls[1][2].env.EXPO_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Detected expo=invalid-version; not enabling precompiled modules use because the installed Expo package version is not a valid semver version.'
    );
  });

  it('does not add precompiled modules env vars when Expo version detection fails', async () => {
    const ctx = makeIosBuildContext({});

    await installPods(ctx, {});

    expect((spawn as jest.Mock).mock.calls[1][2].env.EXPO_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ code: 'ENOENT' }) }),
      'Failed to detect installed Expo package version; not enabling precompiled modules use.'
    );
  });

  it('does not add precompiled modules env vars without the builder flag', async () => {
    const ctx = makeIosBuildContext({
      expoVersion: '55.0.18',
      usePrecompiledModules: false,
    });

    await installPods(ctx, {});

    expect((spawn as jest.Mock).mock.calls[0][2].env.EAS_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect((spawn as jest.Mock).mock.calls[0][2].env.EXPO_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect(ctx.logger.info).not.toHaveBeenCalled();
  });
});

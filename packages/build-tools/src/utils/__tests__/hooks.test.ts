import { BuildJob } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';

import { BuildContext } from '../../context';
import { Hook, runHookIfPresent } from '../hooks';
import { PackageManager } from '../packageManager';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const loggerMock = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  child: () => loggerMock,
};

let ctx: BuildContext<BuildJob>;

describe(runHookIfPresent, () => {
  beforeEach(() => {
    vol.reset();
    (spawn as jest.Mock).mockReset();

    ctx = new BuildContext({ projectRootDirectory: '.', platform: 'android' } as BuildJob, {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: loggerMock as any,
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });
  });

  it('runs the hook if present in package.json', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          scripts: {
            [Hook.PRE_INSTALL]: 'echo pre_install',
            [Hook.POST_INSTALL]: 'echo post_install',
            [Hook.PRE_UPLOAD_ARTIFACTS]: 'echo pre_upload_artifacts',
          },
        }),
      },
      '/workingdir/build'
    );

    await runHookIfPresent(ctx, Hook.PRE_INSTALL);

    expect(spawn).toBeCalledWith(PackageManager.NPM, ['run', Hook.PRE_INSTALL], expect.anything());
  });

  it('runs the hook with npm even if yarn.lock exists', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          scripts: {
            [Hook.PRE_INSTALL]: 'echo pre_install',
            [Hook.POST_INSTALL]: 'echo post_install',
            [Hook.PRE_UPLOAD_ARTIFACTS]: 'echo pre_upload_artifacts',
          },
        }),
        './yarn.lock': 'fakelockfile',
      },
      '/workingdir/build'
    );

    await runHookIfPresent(ctx, Hook.PRE_INSTALL);

    expect(spawn).toBeCalledWith(PackageManager.NPM, ['run', Hook.PRE_INSTALL], expect.anything());
  });

  it('runs the PRE_INSTALL hook using npm when the project uses yarn 2', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          scripts: {
            [Hook.PRE_INSTALL]: 'echo pre_install',
            [Hook.POST_INSTALL]: 'echo post_install',
            [Hook.PRE_UPLOAD_ARTIFACTS]: 'echo pre_upload_artifacts',
          },
        }),
        './yarn.lock': 'fakelockfile',
        './.yarnrc.yml': 'fakeyarn2config',
      },
      '/workingdir/build'
    );

    await runHookIfPresent(ctx, Hook.PRE_INSTALL);

    expect(spawn).toBeCalledWith(PackageManager.NPM, ['run', Hook.PRE_INSTALL], expect.anything());
    expect(true).toBe(true);
  });

  it('does not run the hook if not present in package.json', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          scripts: {
            [Hook.POST_INSTALL]: 'echo post_install',
            [Hook.PRE_UPLOAD_ARTIFACTS]: 'echo pre_upload_artifacts',
          },
        }),
      },
      '/workingdir/build'
    );

    await runHookIfPresent(ctx, Hook.PRE_INSTALL);

    expect(spawn).not.toBeCalled();
  });

  it('runs ON_BUILD_CANCEL hook if present', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          scripts: {
            [Hook.ON_BUILD_CANCEL]: 'echo build_cancel',
          },
        }),
      },
      '/workingdir/build'
    );

    await runHookIfPresent(ctx, Hook.ON_BUILD_CANCEL);

    expect(spawn).toBeCalledWith(
      ctx.packageManager,
      ['run', 'eas-build-on-cancel'],
      expect.anything()
    );
  });

  it('does not run ON_BUILD_CANCEL hook if not present', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          scripts: {},
        }),
      },
      '/workingdir/build'
    );

    await runHookIfPresent(ctx, Hook.ON_BUILD_CANCEL);

    expect(spawn).not.toHaveBeenCalled();
  });
});

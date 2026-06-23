import { Platform } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';

import { runGradleCommand } from '../gradle';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('fs-extra', () => ({
  chmod: jest.fn().mockResolvedValue(undefined),
}));

describe(runGradleCommand, () => {
  beforeEach(() => {
    const spawnPromise = Promise.resolve(undefined) as any;
    spawnPromise.child = { pid: 123 };
    (spawn as jest.Mock).mockReturnValue(spawnPromise);
    (fs.chmod as unknown as jest.Mock).mockClear();
    (spawn as jest.Mock).mockClear();
  });

  it('allows Sentry upload failures by default', async () => {
    await runGradleCommand(
      {
        env: { EAS_BUILD_RUNNER: 'eas-build' },
        job: {
          platform: Platform.ANDROID,
        },
      } as any,
      {
        logger: { info: jest.fn() } as any,
        gradleCommand: ':app:bundleRelease',
        androidDir: '/app/android',
      }
    );

    expect(spawn).toHaveBeenCalledWith(
      'bash',
      ['-c', './gradlew :app:bundleRelease --profile '],
      expect.objectContaining({
        env: expect.objectContaining({
          SENTRY_ALLOW_FAILURE: 'true',
        }),
      })
    );
  });
});

import downloadFile from '@expo/downloader';
import spawn from '@expo/turtle-spawn';
import { mkdirp, mkdtemp, remove } from 'fs-extra';
import StreamZip from 'node-stream-zip';

import { createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import {
  startPreparingPrecompiledDependencies,
  PRECOMPILED_MODULES_PATH,
} from '../../utils/precompiledModules';
import { installPods } from '../pod';

jest.mock('@expo/downloader');
jest.mock('fs-extra');
jest.mock('@expo/turtle-spawn');
jest.mock('node-stream-zip', () => ({
  __esModule: true,
  default: {
    async: jest.fn(),
  },
}));

describe(installPods.name, () => {
  const extract = jest.fn();
  const close = jest.fn();

  beforeEach(() => {
    jest.mocked(remove).mockImplementation(async () => undefined as any);
    jest.mocked(mkdirp).mockImplementation(async () => undefined as any);
    jest.mocked(mkdtemp).mockImplementation(async () => '/tmp/precompiled-modules-test' as any);
    extract.mockReset().mockResolvedValue(undefined);
    close.mockReset().mockResolvedValue(undefined);
    jest.mocked(StreamZip.async).mockImplementation(
      () =>
        ({
          extract,
          close,
        }) as any
    );
  });

  it('waits for precompiled dependencies before running pod install', async () => {
    let resolvePreparation: (() => void) | undefined;
    const preparationPromise = new Promise<void>(resolve => {
      resolvePreparation = resolve;
    });
    jest.mocked(downloadFile).mockReturnValue(preparationPromise);
    const ctx = new BuildContext(
      createTestIosJob({
        buildCredentials: undefined,
      }),
      {
        workingdir: '/workingdir',
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        logger: createMockLogger(),
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        uploadArtifact: jest.fn(),
      }
    );
    startPreparingPrecompiledDependencies(ctx, [
      'https://example.com/precompiled-modules-0.zip',
      'https://example.com/precompiled-modules-1.zip',
    ]);

    jest.mocked(spawn).mockResolvedValue({} as any);

    const installPodsPromise = installPods(ctx, {});
    await Promise.resolve();

    expect(spawn).not.toHaveBeenCalled();

    resolvePreparation?.();
    await installPodsPromise;

    expect(spawn).toHaveBeenCalledWith(
      'pod',
      ['install'],
      expect.objectContaining({
        cwd: '/workingdir/build/ios',
      })
    );
    expect(mkdirp).toHaveBeenCalledWith(PRECOMPILED_MODULES_PATH);
  });
});

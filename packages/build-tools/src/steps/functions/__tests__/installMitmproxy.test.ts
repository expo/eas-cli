import downloadFile from '@expo/downloader';
import { SystemError } from '@expo/eas-build-job';
import { BuildRuntimePlatform, BuildStep } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createInstallMitmproxyBuildFunction } from '../installMitmproxy';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@expo/downloader', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedDownloadFile = jest.mocked(downloadFile);

describe('createInstallMitmproxyBuildFunction', () => {
  let homeDirectory: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedDownloadFile.mockResolvedValue(undefined);
    homeDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install-mitmproxy-test'));
  });

  afterEach(async () => {
    await fs.promises.rm(homeDirectory, { force: true, recursive: true });
  });

  function createStep(env: Record<string, string>): BuildStep {
    const globalCtx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN });
    globalCtx.updateEnv({ HOME: homeDirectory, ...env });
    return createInstallMitmproxyBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {},
    });
  }

  it('does not download when mitmdump is already on PATH', async () => {
    mockedSpawn.mockResolvedValueOnce({} as never);

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith('mitmdump', ['--version'], expect.anything());
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedDownloadFile).not.toHaveBeenCalled();
  });

  it('warns instead of installing outside EAS Build VMs', async () => {
    mockedSpawn.mockRejectedValueOnce(new Error('not found'));

    await createStep({}).executeAsync();

    expect(mockedDownloadFile).not.toHaveBeenCalled();
  });

  it('downloads the pinned artifact from the turtle-v2 bucket and extracts it', async () => {
    mockedSpawn
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never);

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedDownloadFile).toHaveBeenCalledWith(
      'https://storage.googleapis.com/turtle-v2/mitmproxy-12.2.3-macos-arm64.tar.gz',
      expect.stringContaining('mitmproxy.tar.gz'),
      { retry: 3, timeout: 5 * 60 * 1000 }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'tar',
      [
        '-xzf',
        expect.stringContaining('mitmproxy.tar.gz'),
        '-C',
        path.join(homeDirectory, '.eas-mitmproxy'),
      ],
      expect.anything()
    );
  });

  it('prepends the extracted binaries to PATH for later steps', async () => {
    mockedSpawn
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never);

    const step = createStep({ EAS_BUILD_RUNNER: 'eas-build', PATH: '/usr/bin' });
    await step.executeAsync();

    expect(step.ctx.global.env.PATH).toBe(
      `${path.join(homeDirectory, '.eas-mitmproxy', 'mitmproxy.app', 'Contents', 'MacOS')}:/usr/bin`
    );
  });

  it('explains where to look when the artifact cannot be downloaded', async () => {
    mockedSpawn.mockRejectedValueOnce(new Error('not found'));
    mockedDownloadFile.mockRejectedValue(new Error('404'));

    await expect(createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()).rejects.toThrow(
      /Check that the artifact exists in the turtle-v2 bucket/
    );
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('throws when mitmdump is still not runnable after the install', async () => {
    mockedSpawn
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('not found'));

    await expect(createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()).rejects.toThrow(
      SystemError
    );
  });
});

import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { decompressTarAsync } from '../../../utils/files';
import { createInstallMitmproxyBuildFunction } from '../installMitmproxy';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/files', () => ({
  decompressTarAsync: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedDecompressTarAsync = jest.mocked(decompressTarAsync);

function spawnResolved(): ReturnType<typeof spawn> {
  return Promise.resolve({}) as unknown as ReturnType<typeof spawn>;
}

function spawnRejected(): ReturnType<typeof spawn> {
  return Promise.reject(new Error('not found')) as unknown as ReturnType<typeof spawn>;
}

describe('createInstallMitmproxyBuildFunction', () => {
  let homeDirectory: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedDecompressTarAsync.mockResolvedValue(undefined);
    homeDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install-mitmproxy-test'));
  });

  afterEach(async () => {
    await fs.promises.rm(homeDirectory, { force: true, recursive: true });
  });

  function createStep(
    env: Record<string, string>
  ): ReturnType<
    ReturnType<typeof createInstallMitmproxyBuildFunction>['createBuildStepFromFunctionCall']
  > {
    const globalCtx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN });
    globalCtx.updateEnv({ ...globalCtx.env, HOME: homeDirectory, ...env });
    return createInstallMitmproxyBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {},
    });
  }

  it('does not download when mitmdump is already on PATH', async () => {
    mockedSpawn.mockReturnValueOnce(spawnResolved());

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedDecompressTarAsync).not.toHaveBeenCalled();
  });

  it('does not touch the machine outside EAS Build VMs', async () => {
    mockedSpawn.mockReturnValueOnce(spawnRejected());

    await createStep({}).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedDecompressTarAsync).not.toHaveBeenCalled();
  });

  it('downloads the pinned artifact from the turtle-v2 bucket and extracts it', async () => {
    mockedSpawn
      .mockReturnValueOnce(spawnRejected())
      .mockReturnValueOnce(spawnResolved())
      .mockReturnValueOnce(spawnResolved());

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'curl',
      [
        '--fail',
        '--location',
        '--output',
        expect.stringContaining('mitmproxy.tar.gz'),
        'https://storage.googleapis.com/turtle-v2/mitmproxy-12.2.3-macos-arm64.tar.gz',
      ],
      expect.anything()
    );
    expect(mockedDecompressTarAsync).toHaveBeenCalledWith({
      archivePath: expect.stringContaining('mitmproxy.tar.gz'),
      destinationDirectory: path.join(homeDirectory, '.eas-mitmproxy'),
    });
  });

  it('puts the extracted binaries on PATH for later steps', async () => {
    mockedSpawn
      .mockReturnValueOnce(spawnRejected())
      .mockReturnValueOnce(spawnResolved())
      .mockReturnValueOnce(spawnResolved());

    const step = createStep({ EAS_BUILD_RUNNER: 'eas-build' });
    await step.executeAsync();

    expect(step.ctx.global.env.PATH).toContain(
      path.join(homeDirectory, '.eas-mitmproxy', 'mitmproxy.app', 'Contents', 'MacOS')
    );
  });

  it('throws when mitmdump is still not runnable after the install', async () => {
    mockedSpawn
      .mockReturnValueOnce(spawnRejected())
      .mockReturnValueOnce(spawnResolved())
      .mockReturnValueOnce(spawnRejected());

    await expect(createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()).rejects.toThrow(
      /mitmdump is still not runnable/
    );
  });
});

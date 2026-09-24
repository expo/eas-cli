import { BuildRuntimePlatform, BuildStep } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createInstallMitmproxyBuildFunction } from '../installMitmproxy';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

describe('createInstallMitmproxyBuildFunction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createStep(env: Record<string, string>): BuildStep {
    const globalCtx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN });
    globalCtx.updateEnv(env);
    return createInstallMitmproxyBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {},
    });
  }

  it('does not install when mitmdump is already on PATH', async () => {
    mockedSpawn.mockResolvedValueOnce({} as never);

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith('mitmdump', ['--version'], expect.anything());
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('warns instead of installing outside EAS Build VMs', async () => {
    mockedSpawn.mockRejectedValueOnce(new Error('not found'));

    await createStep({}).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('installs the cask with Homebrew and leaves auto-update off', async () => {
    mockedSpawn
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never);

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'brew',
      ['install', '--cask', 'mitmproxy'],
      expect.objectContaining({ env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }) })
    );
  });

  it('does not fail the job when mitmdump is still not runnable', async () => {
    mockedSpawn
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('not found'));

    await expect(
      createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()
    ).resolves.toBeUndefined();
  });
});

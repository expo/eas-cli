import { BuildRuntimePlatform, BuildStep } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createInstallMitmproxyBuildFunction } from '../installMitmproxy';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

/** Each `mitmdump --version` call takes the next result; other commands succeed. */
function mockMitmdumpRuns(...runs: boolean[]): void {
  mockedSpawn.mockImplementation((async (command: string) => {
    if (command === 'mitmdump' && !runs.shift()) {
      throw new Error('not found');
    }
    return {};
  }) as never);
}

function spawnedCommands(): string[] {
  return mockedSpawn.mock.calls.map(([command]) => command);
}

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

  it('takes an installed cask out of quarantine before running mitmdump', async () => {
    mockMitmdumpRuns(true);

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'xattr',
      ['-dr', 'com.apple.quarantine', expect.stringMatching(/\/Caskroom\/mitmproxy$/)],
      expect.anything()
    );
    expect(spawnedCommands()).toEqual(['xattr', 'mitmdump']);
  });

  it('does not change quarantine outside EAS Build VMs', async () => {
    mockMitmdumpRuns(false);

    await createStep({}).executeAsync();

    expect(spawnedCommands()).toEqual(['mitmdump']);
  });

  it('installs the cask with Homebrew and takes it out of quarantine', async () => {
    mockMitmdumpRuns(false, true);

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'brew',
      ['install', '--cask', 'mitmproxy'],
      expect.objectContaining({ env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }) })
    );
    expect(spawnedCommands()).toEqual(['xattr', 'mitmdump', 'brew', 'xattr', 'mitmdump']);
  });

  it('does not fail the job when removing quarantine fails', async () => {
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'xattr') {
        throw new Error('No such file');
      }
      return {};
    }) as never);

    await expect(
      createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()
    ).resolves.toBeUndefined();
  });

  it('does not fail the job when mitmdump is still not runnable', async () => {
    mockMitmdumpRuns(false, false);

    await expect(
      createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()
    ).resolves.toBeUndefined();
  });
});

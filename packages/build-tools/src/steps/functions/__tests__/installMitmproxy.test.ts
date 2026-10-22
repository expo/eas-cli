import { BuildRuntimePlatform, BuildStep } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { fs, vol } from 'memfs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createInstallMitmproxyBuildFunction } from '../installMitmproxy';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

// An x86 Homebrew prefix, to check that the app is found from PATH and not from process.arch.
const APP = '/usr/local/Caskroom/mitmproxy/12.2.3/mitmproxy.app';
const LINK = '/usr/local/bin/mitmdump';

function installCask(): void {
  vol.fromJSON({ [`${APP}/Contents/MacOS/mitmdump`]: '', '/usr/local/bin': null });
  fs.symlinkSync(`${APP}/Contents/MacOS/mitmdump`, LINK);
}

/**
 * `which` finds mitmdump once the cask is installed, `brew` installs it, `xattr -p` reports
 * quarantine while `stuck` is set, and each `mitmdump --version` takes the next result.
 */
function mockCommands({
  installed = false,
  stuck = false,
  runs = [],
}: {
  installed?: boolean;
  stuck?: boolean;
  runs?: boolean[];
}): void {
  if (installed) {
    installCask();
  }
  mockedSpawn.mockImplementation((async (command: string, args: string[]) => {
    if (command === 'which' && !installed) {
      throw new Error('not found');
    }
    if (command === 'which') {
      return { stdout: `${LINK}\n` };
    }
    if (command === 'brew' && !installed) {
      installed = true;
      installCask();
    }
    if (command === 'xattr' && args[0] === '-p' && !stuck) {
      throw new Error('No such xattr: com.apple.quarantine');
    }
    if (command === 'mitmdump' && !runs.shift()) {
      throw new Error('not found');
    }
    return { stdout: '' };
  }) as never);
}

function spawnedCommands(): string[] {
  return mockedSpawn.mock.calls.map(([command, args]) =>
    command === 'xattr' ? `xattr ${args?.[0]}` : command
  );
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

  it('takes the app behind mitmdump on PATH out of quarantine before running it', async () => {
    mockCommands({ installed: true, runs: [true] });

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'xattr',
      ['-dr', 'com.apple.quarantine', APP],
      expect.anything()
    );
    expect(spawnedCommands()).toEqual(['which', 'xattr -dr', 'xattr -p', 'mitmdump']);
  });

  it('kills a mitmdump --version that does not return', async () => {
    mockCommands({ installed: true, runs: [true] });

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'mitmdump',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', timeout: 60_000, killSignal: 'SIGKILL' })
    );
  });

  it('does not run a mitmdump that stays quarantined', async () => {
    mockCommands({ installed: true, stuck: true });

    await expect(
      createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()
    ).resolves.toBeUndefined();

    expect(spawnedCommands()).not.toContain('mitmdump');
  });

  it('does not change quarantine outside EAS Build VMs', async () => {
    mockCommands({ installed: true, stuck: true, runs: [true] });

    await createStep({}).executeAsync();

    expect(spawnedCommands()).toEqual(['mitmdump']);
  });

  it('installs the cask with Homebrew and takes it out of quarantine', async () => {
    mockCommands({ runs: [false, true] });

    await createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'brew',
      ['install', '--cask', 'mitmproxy'],
      expect.objectContaining({ env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }) })
    );
    expect(spawnedCommands()).toEqual([
      'which',
      'mitmdump',
      'brew',
      'which',
      'xattr -dr',
      'xattr -p',
      'mitmdump',
    ]);
  });

  it('does not fail the job when mitmdump is still not runnable', async () => {
    mockCommands({ runs: [false, false] });

    await expect(
      createStep({ EAS_BUILD_RUNNER: 'eas-build' }).executeAsync()
    ).resolves.toBeUndefined();
  });
});

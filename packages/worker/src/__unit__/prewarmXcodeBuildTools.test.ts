import type { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';

jest.mock('@expo/turtle-spawn');
jest.mock('fs-extra');

const spawnResult: SpawnResult = {
  output: [],
  status: 0,
  signal: null,
  stdout: '',
  stderr: '',
};

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
};

function createSpawnPromise(result: Promise<SpawnResult>): SpawnPromise<SpawnResult> {
  return Object.assign(result, {
    child: { kill: jest.fn() },
  }) as unknown as SpawnPromise<SpawnResult>;
}

function setProcessPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

async function loadModule(): Promise<{
  module: typeof import('../ios/prewarmXcodeBuildTools');
  spawnMock: jest.MockedFunction<typeof import('@expo/turtle-spawn').default>;
  fsMock: any;
}> {
  jest.resetModules();
  const spawnMock = jest.mocked((await import('@expo/turtle-spawn')).default);
  const fsMock = jest.mocked((await import('fs-extra')).default);
  const module = await import('../ios/prewarmXcodeBuildTools');
  return { module, spawnMock, fsMock };
}

function prepareFsMock(fsMock: any): void {
  fsMock.mkdtemp.mockResolvedValue('/tmp/eas-xcode-build-tool-prewarm-test');
  fsMock.outputFile.mockResolvedValue(undefined);
  fsMock.ensureDir.mockResolvedValue(undefined);
  fsMock.remove.mockResolvedValue(undefined);
}

describe('Xcode build tool prewarming', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  afterEach(() => {
    setProcessPlatform(originalPlatform);
  });

  it('does nothing outside macOS', async () => {
    setProcessPlatform('linux');
    const { module, spawnMock } = await loadModule();

    await module.startXcodeBuildToolsPrewarming({ env: process.env, logger: logger as any });

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('prewarms ibtool and actool once and removes its temporary files', async () => {
    setProcessPlatform('darwin');
    const { module, spawnMock, fsMock } = await loadModule();
    prepareFsMock(fsMock);
    spawnMock.mockImplementation(() => createSpawnPromise(Promise.resolve(spawnResult)));

    await module.startXcodeBuildToolsPrewarming({ env: process.env, logger: logger as any });
    await module.startXcodeBuildToolsPrewarming({ env: process.env, logger: logger as any });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining(['ibtool']),
      expect.objectContaining({ env: process.env, stdio: 'pipe' })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining(['actool']),
      expect.objectContaining({ env: process.env, stdio: 'pipe' })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Xcode interface and asset build tools were prewarmed')
    );

    expect(fsMock.remove).toHaveBeenCalledWith('/tmp/eas-xcode-build-tool-prewarm-test');
  });

  it('continues when a prewarm command fails', async () => {
    setProcessPlatform('darwin');
    const { module, spawnMock, fsMock } = await loadModule();
    prepareFsMock(fsMock);
    spawnMock
      .mockImplementationOnce(() => createSpawnPromise(Promise.reject(new Error('failed'))))
      .mockImplementationOnce(() => createSpawnPromise(Promise.resolve(spawnResult)));

    await expect(
      module.startXcodeBuildToolsPrewarming({ env: process.env, logger: logger as any })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errors: [expect.any(Error)] }),
      expect.stringContaining('continuing the build')
    );
  });
});

import { Job, Metadata } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';

import { runLocalBuildAsync } from '../local';

jest.mock('@expo/spawn-async');

const mockSpawnAsync = jest.mocked(spawnAsync);

function decodeInput(base64: string): unknown {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

describe(runLocalBuildAsync, () => {
  const job = { type: 'test-job', secrets: { buildCredentials: 'super-secret' } } as unknown as Job;
  const metadata = { appName: 'test' } as unknown as Metadata;

  const originalPluginPath = process.env.EAS_LOCAL_BUILD_PLUGIN_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    // Use the plugin-path branch so the test doesn't shell out to `npm --version`.
    process.env.EAS_LOCAL_BUILD_PLUGIN_PATH = '/path/to/plugin';
    mockSpawnAsync.mockReturnValue(
      Object.assign(Promise.resolve({} as any), { child: {} }) as any
    );
  });

  afterAll(() => {
    if (originalPluginPath === undefined) {
      delete process.env.EAS_LOCAL_BUILD_PLUGIN_PATH;
    } else {
      process.env.EAS_LOCAL_BUILD_PLUGIN_PATH = originalPluginPath;
    }
  });

  it('passes the job/metadata via EAS_LOCAL_BUILD_PLUGIN_INPUT, never as a command-line argument', async () => {
    await runLocalBuildAsync(job, metadata, { verbose: true }, {});

    expect(mockSpawnAsync).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = mockSpawnAsync.mock.calls[0];

    expect(command).toBe('/path/to/plugin');
    // The credentials-bearing payload must not appear in argv.
    expect(args).toEqual([]);
    expect(JSON.stringify(args)).not.toContain('super-secret');

    const input = (spawnOptions?.env as Record<string, string>).EAS_LOCAL_BUILD_PLUGIN_INPUT;
    expect(input).toBeDefined();
    expect(decodeInput(input)).toEqual({ job, metadata });
  });
});

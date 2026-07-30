import { Job, Metadata } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';

import Log from '../../log';
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

  it('logs a non-secret build context summary and re-throws on failure', async () => {
    const richJob = {
      type: 'managed',
      platform: 'ios',
      projectRootDirectory: 'apps/mobile',
      secrets: { buildCredentials: 'super-secret' },
    } as unknown as Job;
    const richMetadata = {
      buildProfile: 'production',
      cliVersion: '21.2.0',
      sdkVersion: '57.0.0',
      gitCommitHash: '2c9137d8',
      isGitWorkingTreeDirty: true,
      requiredPackageManager: 'pnpm',
      trackingContext: { tracking_id: 'track-123', project_id: 'proj-456' },
    } as unknown as Metadata;

    const buildError = new Error('build failed');
    const rejected = Promise.reject(buildError);
    rejected.catch(() => {}); // avoid an unhandled-rejection warning before it's awaited
    mockSpawnAsync.mockReturnValue(Object.assign(rejected, { child: {} }) as any);

    const logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});

    await expect(runLocalBuildAsync(richJob, richMetadata, { verbose: true }, {})).rejects.toBe(
      buildError
    );

    const output = logSpy.mock.calls.flat().join('\n');
    // Useful debugging context is surfaced...
    expect(output).toContain('ios');
    expect(output).toContain('production');
    expect(output).toContain('apps/mobile');
    expect(output).toContain('pnpm');
    expect(output).toContain('2c9137d8');
    expect(output).toContain('track-123');
    // ...but secrets are never included.
    expect(output).not.toContain('super-secret');

    logSpy.mockRestore();
  });
});

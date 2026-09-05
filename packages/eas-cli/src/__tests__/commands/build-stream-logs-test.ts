import Build from '../../commands/build';
import { getError, getErrorAsync, getMockOclifConfig } from './utils';
import { RequestedPlatform } from '../../platform';

describe(Build, () => {
  function sanitizeFlags(overrides: Record<string, unknown>) {
    const command = new Build([], getMockOclifConfig()) as any;
    return command.sanitizeFlags({
      platform: 'android',
      wait: true,
      'stream-logs': true,
      ...overrides,
    } as any);
  }

  test('rejects --stream-logs with --no-wait', () => {
    const error = getError(() => sanitizeFlags({ wait: false })) as Error;
    expect(error.message).toContain('--stream-logs cannot be used with --no-wait');
  });

  test('rejects --stream-logs with --json', () => {
    const error = getError(() => sanitizeFlags({ json: true })) as Error;
    expect(error.message).toContain('--stream-logs cannot be used with --json');
  });

  test('rejects --stream-logs for local builds', async () => {
    const command = new Build([], getMockOclifConfig()) as any;
    const flags = sanitizeFlags({ local: true });

    const error = await getErrorAsync(() =>
      command.ensurePlatformSelectedAsync({
        ...flags,
        requestedPlatform: RequestedPlatform.Android,
      })
    );

    expect((error as Error).message).toContain('--stream-logs is not supported for local builds');
  });

  test('allows --stream-logs for all-platform builds', async () => {
    const command = new Build([], getMockOclifConfig()) as any;
    const flags = sanitizeFlags({ platform: 'all' });

    await expect(
      command.ensurePlatformSelectedAsync({
        ...flags,
        requestedPlatform: RequestedPlatform.All,
      })
    ).resolves.toMatchObject({
      requestedPlatform: RequestedPlatform.All,
      isBuildLogStreamingEnabled: true,
    });
  });
});

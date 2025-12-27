import childProcess from 'child_process';
import fs from 'fs-extra';

import { AppStoreConnectApiKeyQuery } from '../../../graphql/queries/AppStoreConnectApiKeyQuery';
import { getAscApiKeyResultAsync } from '../../ios/AscApiKeySource';
import submitLocalIosAsync from '../local';

jest.mock('child_process', () => ({ spawn: jest.fn(), spawnSync: jest.fn() }));
jest.mock('../../ios/AscApiKeySource', () => ({
  getAscApiKeyResultAsync: jest.fn(),
  AscApiKeySourceType: { path: 'path', prompt: 'prompt', credentialsService: 'credentialsService' },
}));
jest.mock('../../../graphql/queries/AppStoreConnectApiKeyQuery', () => ({
  AppStoreConnectApiKeyQuery: { getByIdAsync: jest.fn() },
}));

describe('submitLocalIosAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('throws when archive path is missing', async () => {
    const ctx: any = {
      archiveFlags: {},
      profile: {},
      nonInteractive: false,
      graphqlClient: {},
      isVerboseFastlaneEnabled: false,
    };

    await expect(submitLocalIosAsync(ctx)).rejects.toThrow('--local currently requires --path');
  });

  test('throws when ipa file does not exist', async () => {
    const ctx: any = {
      archiveFlags: { path: '/nonexistent.ipa' },
      profile: {},
      nonInteractive: false,
      graphqlClient: {},
      isVerboseFastlaneEnabled: false,
    };
    jest.spyOn(fs as any, 'pathExists').mockResolvedValue(false);

    await expect(submitLocalIosAsync(ctx)).rejects.toThrow('does not exist');
  });

  test('throws when fastlane is missing', async () => {
    const ctx: any = {
      archiveFlags: { path: '/existing.ipa' },
      profile: {},
      nonInteractive: false,
      graphqlClient: {},
      isVerboseFastlaneEnabled: false,
    };
    jest.spyOn(fs as any, 'pathExists').mockResolvedValue(true);
    jest.spyOn(fs as any, 'mkdtemp').mockResolvedValue('/tmp/eas-asc-123' as any);
    jest.spyOn(fs as any, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'chmod').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'remove').mockResolvedValue(undefined);

    jest.mocked(childProcess.spawnSync as any).mockReturnValue({ status: 1 });

    jest.mocked(getAscApiKeyResultAsync as jest.Mock).mockResolvedValue({
      result: { keyP8: 'p8', keyId: 'kid', issuerId: 'iss' },
      summary: { source: 'local', keyId: 'kid' },
    });

    await expect(submitLocalIosAsync(ctx)).rejects.toThrow('fastlane is not installed');
  });

  test('throws when ASC key lookup via App Store Connect fails', async () => {
    const ctx: any = {
      archiveFlags: { path: '/existing.ipa' },
      profile: {},
      nonInteractive: false,
      graphqlClient: {},
      isVerboseFastlaneEnabled: false,
    };
    jest.spyOn(fs as any, 'pathExists').mockResolvedValue(true);
    jest.spyOn(fs as any, 'mkdtemp').mockResolvedValue('/tmp/eas-asc-123' as any);
    jest.spyOn(fs as any, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'chmod').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'remove').mockResolvedValue(undefined);

    jest.mocked(childProcess.spawnSync as any).mockReturnValue({ status: 0 });

    // Simulate that AscApiKeySource returned an ascApiKeyId which triggers AppStoreConnect lookup
    jest.mocked(getAscApiKeyResultAsync as jest.Mock).mockResolvedValue({
      result: { ascApiKeyId: 'nonexistent' },
      summary: { source: 'EAS servers', keyId: 'unknown' },
    });

    jest
      .mocked(AppStoreConnectApiKeyQuery.getByIdAsync as jest.Mock)
      .mockRejectedValue(new Error('not found'));

    await expect(submitLocalIosAsync(ctx)).rejects.toThrow('not found');
  });

  test('rejects when fastlane upload fails (non-zero exit)', async () => {
    const ctx: any = {
      archiveFlags: { path: '/existing.ipa' },
      profile: {},
      nonInteractive: false,
      graphqlClient: {},
      isVerboseFastlaneEnabled: false,
    };
    jest.spyOn(fs as any, 'pathExists').mockResolvedValue(true);
    jest.spyOn(fs as any, 'mkdtemp').mockResolvedValue('/tmp/eas-asc-123' as any);
    jest.spyOn(fs as any, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'chmod').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'remove').mockResolvedValue(undefined);

    jest.mocked(childProcess.spawnSync as any).mockReturnValue({ status: 0 });

    jest.mocked(getAscApiKeyResultAsync as jest.Mock).mockResolvedValue({
      result: { keyP8: 'p8', keyId: 'kid', issuerId: 'iss' },
      summary: { source: 'local', keyId: 'kid' },
    });

    // Mock spawn to call the 'close' callback with non-zero code
    const mockChild = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'close') {
          cb(1);
        }
        return mockChild;
      }),
    } as any;
    jest.mocked(childProcess.spawn as any).mockReturnValue(mockChild);

    await expect(submitLocalIosAsync(ctx)).rejects.toThrow('fastlane exited with code 1');
  });

  test('resolves when fastlane upload succeeds', async () => {
    const ctx: any = {
      archiveFlags: { path: '/existing.ipa' },
      profile: {},
      nonInteractive: false,
      graphqlClient: {},
      isVerboseFastlaneEnabled: false,
    };
    jest.spyOn(fs as any, 'pathExists').mockResolvedValue(true);
    jest.spyOn(fs as any, 'mkdtemp').mockResolvedValue('/tmp/eas-asc-123' as any);
    jest.spyOn(fs as any, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'chmod').mockResolvedValue(undefined);
    jest.spyOn(fs as any, 'remove').mockResolvedValue(undefined);

    jest.mocked(childProcess.spawnSync as any).mockReturnValue({ status: 0 });

    jest.mocked(getAscApiKeyResultAsync as jest.Mock).mockResolvedValue({
      result: { keyP8: 'p8', keyId: 'kid', issuerId: 'iss' },
      summary: { source: 'local', keyId: 'kid' },
    });

    const mockChild = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'close') {
          cb(0);
        }
        return mockChild;
      }),
    } as any;
    jest.mocked(childProcess.spawn as any).mockReturnValue(mockChild);

    await expect(submitLocalIosAsync(ctx)).resolves.toBeUndefined();
  });
});

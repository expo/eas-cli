import { UploadBuildCacheProps, getPackageJson } from '@expo/config';
import spawnAsync from '@expo/spawn-async';
import fs from 'fs-extra';

import EASBuildCacheProvider from '../index';

// The plugin type is a union of the current and the deprecated shape; this
// package implements the current one.
const provider = EASBuildCacheProvider as {
  uploadBuildCache: (props: UploadBuildCacheProps, options: unknown) => Promise<string | null>;
  resolveBuildCache: (props: UploadBuildCacheProps, options: unknown) => Promise<string | null>;
};

jest.mock('@expo/spawn-async');
jest.mock('fs-extra');
jest.mock('@expo/config', () => ({ getPackageJson: jest.fn() }));

describe('uploadBuildCache', () => {
  function uploadProps(): UploadBuildCacheProps {
    return {
      projectRoot: '/app',
      buildPath: '/app/android/app/build/outputs/apk/debug/app-debug.apk',
      fingerprintHash: 'abc123',
      platform: 'android',
      runOptions: { variant: 'debug' },
    } as UploadBuildCacheProps;
  }

  function uploadArgs(): string[] {
    return jest.mocked(spawnAsync).mock.calls[0][1] as string[];
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(fs.exists).mockResolvedValue(true as never);
    jest
      .mocked(spawnAsync)
      .mockResolvedValue({ stdout: '{"url":"https://expo.dev/build"}' } as never);
  });

  it('records the build as a dev client when the project builds one', async () => {
    jest.mocked(getPackageJson).mockReturnValue({ dependencies: { 'expo-dev-client': '^6.0.0' } });

    await provider.uploadBuildCache(uploadProps(), undefined);

    // resolveBuildCache searches with --dev-client for this same project, so an
    // upload recorded under the other value can never be found again.
    expect(uploadArgs()).toContain('--dev-client');
  });

  it('records a plain build when the project has no dev client', async () => {
    jest.mocked(getPackageJson).mockReturnValue({});

    await provider.uploadBuildCache(uploadProps(), undefined);

    expect(uploadArgs()).toContain('--no-dev-client');
  });

  it('agrees with the lookup it will be searched by', async () => {
    jest.mocked(getPackageJson).mockReturnValue({ dependencies: { 'expo-dev-client': '^6.0.0' } });

    await provider.uploadBuildCache(uploadProps(), undefined);
    await provider.resolveBuildCache(uploadProps(), undefined);

    const [uploadArgv, resolveArgv] = jest
      .mocked(spawnAsync)
      .mock.calls.map(call => call[1] as string[]);
    const devClientArg = (argv: string[]): string | undefined =>
      argv.find(arg => arg === '--dev-client' || arg === '--no-dev-client');

    expect(devClientArg(uploadArgv)).toBe(devClientArg(resolveArgv));
  });
});

import { Platform } from '@expo/eas-build-job';

import * as expoUpdates from '../../steps/utils/expoUpdates';
import { uploadEmbeddedBundleAsync } from '../expoUpdatesEmbedded';
import * as easCli from '../easCli';
import * as artifacts from '../artifacts';
import { createMockLogger } from '../../__tests__/utils/logger';

jest.mock('../../steps/utils/expoUpdates');
jest.mock('../easCli');
jest.mock('../artifacts');

const mockZipEntries = jest.fn();
const mockZipExtract = jest.fn();
const mockZipClose = jest.fn();

jest.mock('node-stream-zip', () => ({
  __esModule: true,
  default: {
    async: jest.fn(() => ({
      entries: mockZipEntries,
      extract: mockZipExtract,
      close: mockZipClose,
    })),
  },
}));

function zipEntryMap(entries: Record<string, true>): Record<string, { name: string }> {
  return Object.fromEntries(Object.keys(entries).map(name => [name, { name }]));
}

function makeArgs(overrides: {
  platform: Platform;
  simulator?: boolean;
  developmentClient?: boolean;
  channel?: string;
  env?: Record<string, string>;
}): Parameters<typeof uploadEmbeddedBundleAsync>[0] {
  const job =
    overrides.platform === Platform.IOS
      ? {
          platform: Platform.IOS,
          simulator: overrides.simulator ?? false,
          developmentClient: overrides.developmentClient ?? false,
          updates: overrides.channel ? { channel: overrides.channel } : undefined,
        }
      : {
          platform: Platform.ANDROID,
          developmentClient: overrides.developmentClient ?? false,
          updates: overrides.channel ? { channel: overrides.channel } : undefined,
        };

  return {
    job,
    env: overrides.env ?? {},
    appConfig: {
      name: 'my-app',
      slug: 'my-app',
      updates: { url: 'https://u.expo.dev/project-id' },
    },
    logger: createMockLogger(),
    projectDir: '/project',
  } as Parameters<typeof uploadEmbeddedBundleAsync>[0];
}

describe('uploadEmbeddedBundleAsync', () => {
  beforeEach(() => {
    jest.mocked(expoUpdates.isEASUpdateConfigured).mockReturnValue(true);
    jest.mocked(easCli.runEasCliCommand).mockResolvedValue({} as any);
    jest.mocked(artifacts.findArtifacts).mockResolvedValue([]);
    mockZipEntries.mockResolvedValue({});
    mockZipExtract.mockResolvedValue(undefined);
    mockZipClose.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('skips when EAS Update is not configured', async () => {
    jest.mocked(expoUpdates.isEASUpdateConfigured).mockReturnValue(false);
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('skipped');
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('warns when no channel is configured and does not look for the archive', async () => {
    const args = makeArgs({ platform: Platform.ANDROID });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(args.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: no channel configured for this build profile.'
    );
    expect(status).toBe('failed');
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('warns for an unsupported platform', async () => {
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });
    (args.job as { platform: string }).platform = 'web';

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('failed');
    expect(args.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: the web platform is not supported.'
    );
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('uploads from Android APK archives', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.apk']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'assets/index.android.bundle': true,
        'assets/app.manifest': true,
      })
    );
    const args = makeArgs({
      platform: Platform.ANDROID,
      channel: 'production',
      env: { EAS_BUILD_ID: 'build-123' },
    });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('uploaded');
    expect(artifacts.findArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ patternOrPath: 'android/app/build/outputs/**/*.{apk,aab}' })
    );
    expect(mockZipExtract).toHaveBeenCalledWith(
      'assets/index.android.bundle',
      expect.stringContaining('index.android.bundle')
    );
    expect(easCli.runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'update:embedded:upload',
          '--platform',
          Platform.ANDROID,
          '--channel',
          'production',
          '--build-id',
          'build-123',
        ]),
      })
    );
  });

  it('uses applicationArchivePath to find the archive', async () => {
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync({
      ...args,
      job: { ...args.job, applicationArchivePath: 'custom/app.aab' },
    });

    expect(artifacts.findArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ patternOrPath: 'custom/app.aab' })
    );
  });

  it('uploads from Android AAB archives', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.aab']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'base/assets/index.android.bundle': true,
        'base/assets/app.manifest': true,
      })
    );
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('uploaded');
    expect(mockZipExtract).toHaveBeenCalledWith(
      'base/assets/index.android.bundle',
      expect.stringContaining('index.android.bundle')
    );
    expect(easCli.runEasCliCommand).toHaveBeenCalled();
  });

  it('uploads from iOS IPA archives', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/App.ipa']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'Payload/App.app/main.jsbundle': true,
        'Payload/App.app/EXUpdates.bundle/app.manifest': true,
      })
    );
    const args = makeArgs({ platform: Platform.IOS, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('uploaded');
    expect(artifacts.findArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ patternOrPath: 'ios/build/*.ipa' })
    );
    expect(easCli.runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--platform', Platform.IOS]),
      })
    );
  });

  it('skips simulator builds', async () => {
    const args = makeArgs({ platform: Platform.IOS, simulator: true, channel: 'preview' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('skipped');
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('skips development client builds', async () => {
    const args = makeArgs({
      platform: Platform.ANDROID,
      developmentClient: true,
      channel: 'development',
    });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('skipped');
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('warns when bundle or manifest is missing from the archive', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.apk']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'assets/app.manifest': true,
      })
    );
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(status).toBe('failed');
    expect(args.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: bundle or manifest not found in archive.'
    );
    expect(easCli.runEasCliCommand).not.toHaveBeenCalled();
  });

  it('warns when build archive is not found', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue([]);
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(args.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: build archive not found.'
    );
    expect(status).toBe('failed');
    expect(easCli.runEasCliCommand).not.toHaveBeenCalled();
  });

  it('treats findArtifacts errors as no archive found', async () => {
    jest.mocked(artifacts.findArtifacts).mockRejectedValue(new Error('glob failed'));
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(args.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: build archive not found.'
    );
    expect(status).toBe('failed');
    expect(easCli.runEasCliCommand).not.toHaveBeenCalled();
  });

  it('warns and continues when CLI upload throws', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.apk']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'assets/index.android.bundle': true,
        'assets/app.manifest': true,
      })
    );
    jest.mocked(easCli.runEasCliCommand).mockRejectedValue(new Error('upload failed'));
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    const { status } = await uploadEmbeddedBundleAsync(args);

    expect(args.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to upload embedded bundle.'
    );
    expect(status).toBe('failed');
  });

  it('swallows zip.close() failures so they do not mask the upload result', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.apk']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'assets/index.android.bundle': true,
        'assets/app.manifest': true,
      })
    );
    mockZipClose.mockRejectedValue(new Error('close failed'));
    const args = makeArgs({ platform: Platform.ANDROID, channel: 'production' });

    await expect(uploadEmbeddedBundleAsync(args)).resolves.toEqual({ status: 'uploaded' });
    expect(easCli.runEasCliCommand).toHaveBeenCalled();
    expect(mockZipClose).toHaveBeenCalled();
  });
});

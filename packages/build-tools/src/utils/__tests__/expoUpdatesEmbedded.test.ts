import { Platform } from '@expo/eas-build-job';

import { BuildContext } from '../../context';
import * as expoUpdates from '../expoUpdates';
import { uploadEmbeddedBundleAsync } from '../expoUpdatesEmbedded';
import * as easCli from '../easCli';
import * as artifacts from '../artifacts';

jest.mock('../expoUpdates');
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

function makeCtx(overrides: {
  platform: Platform;
  simulator?: boolean;
  developmentClient?: boolean;
  channel?: string;
  env?: Record<string, string>;
}): BuildContext<any> {
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
    appConfig: Promise.resolve({
      updates: { url: 'https://u.expo.dev/project-id' },
    }),
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
    },
    markBuildPhaseSkipped: jest.fn(),
    markBuildPhaseHasWarnings: jest.fn(),
    getReactNativeProjectDirectory: () => '/project',
  } as any;
}

describe('uploadEmbeddedBundleAsync', () => {
  beforeEach(() => {
    jest.mocked(expoUpdates.isEASUpdateConfigured).mockResolvedValue(true);
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
    jest.mocked(expoUpdates.isEASUpdateConfigured).mockResolvedValue(false);
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.markBuildPhaseSkipped).toHaveBeenCalled();
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('warns when no channel is configured and does not look for the archive', async () => {
    const ctx = makeCtx({ platform: Platform.ANDROID });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: no channel configured for this build profile.'
    );
    expect(ctx.markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('throws for an unsupported platform', async () => {
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });
    (ctx.job as { platform: string }).platform = 'web';

    await expect(uploadEmbeddedBundleAsync(ctx)).rejects.toThrow(
      'Uploading embedded updates is not supported for the web platform.'
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
    const ctx = makeCtx({
      platform: Platform.ANDROID,
      channel: 'production',
      env: { EAS_BUILD_ID: 'build-123' },
    });

    await uploadEmbeddedBundleAsync(ctx);

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

  it('uploads from Android AAB archives', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.aab']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'base/assets/index.android.bundle': true,
        'base/assets/app.manifest': true,
      })
    );
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

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
    const ctx = makeCtx({ platform: Platform.IOS, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(easCli.runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--platform', Platform.IOS]),
      })
    );
  });

  it('skips simulator builds', async () => {
    const ctx = makeCtx({ platform: Platform.IOS, simulator: true, channel: 'preview' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.markBuildPhaseSkipped).toHaveBeenCalled();
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('skips development client builds', async () => {
    const ctx = makeCtx({
      platform: Platform.ANDROID,
      developmentClient: true,
      channel: 'development',
    });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.markBuildPhaseSkipped).toHaveBeenCalled();
    expect(ctx.markBuildPhaseHasWarnings).not.toHaveBeenCalled();
    expect(artifacts.findArtifacts).not.toHaveBeenCalled();
  });

  it('warns when bundle or manifest is missing from the archive', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue(['/tmp/app-release.apk']);
    mockZipEntries.mockResolvedValue(
      zipEntryMap({
        'assets/app.manifest': true,
      })
    );
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: bundle or manifest not found in archive.'
    );
    expect(easCli.runEasCliCommand).not.toHaveBeenCalled();
  });

  it('warns when build archive is not found', async () => {
    jest.mocked(artifacts.findArtifacts).mockResolvedValue([]);
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: build archive not found.'
    );
    expect(ctx.markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(easCli.runEasCliCommand).not.toHaveBeenCalled();
  });

  it('treats findArtifacts errors as no archive found', async () => {
    jest.mocked(artifacts.findArtifacts).mockRejectedValue(new Error('glob failed'));
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Skipping embedded bundle upload: build archive not found.'
    );
    expect(ctx.markBuildPhaseHasWarnings).toHaveBeenCalled();
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
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await uploadEmbeddedBundleAsync(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to upload embedded bundle.'
    );
    expect(ctx.markBuildPhaseHasWarnings).toHaveBeenCalled();
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
    const ctx = makeCtx({ platform: Platform.ANDROID, channel: 'production' });

    await expect(uploadEmbeddedBundleAsync(ctx)).resolves.toBeUndefined();
    expect(easCli.runEasCliCommand).toHaveBeenCalled();
    expect(mockZipClose).toHaveBeenCalled();
  });
});

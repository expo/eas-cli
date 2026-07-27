import { uploadMetadataAsync } from '../upload';
import { MetadataValidationError } from '../errors';
import Log from '../../log';

jest.mock('../auth', () => ({
  getAppStoreAuthAsync: jest.fn(() => ({
    app: { id: '123', attributes: { primaryLocale: 'en-US' } },
    auth: { context: { token: 'mock' } },
  })),
}));

jest.mock('../apple/tasks', () => ({
  createAppleTasks: jest.fn(() => []),
}));

jest.mock('../config/resolve', () => ({
  createAppleReader: jest.fn(() => ({
    getVersion: jest.fn(() => ({ versionString: '1.0.0' })),
    getLocales: jest.fn(() => ['en-US']),
  })),
  loadConfigAsync: jest.fn(() => ({ configVersion: 0 })),
}));

jest.mock('../utils/telemetry', () => ({
  subscribeTelemetryAsync: jest.fn(() => ({
    unsubscribeTelemetry: jest.fn(),
    executionId: 'exec-123',
  })),
}));

jest.mock('../../log');

jest.mock('../../prompts', () => ({
  confirmAsync: jest.fn(),
}));

const { confirmAsync } = require('../../prompts') as jest.Mocked<typeof import('../../prompts')>;

function createArgs(overrides: Record<string, any> = {}) {
  return {
    projectDir: '/app',
    profile: { metadataPath: 'store.config.json', bundleIdentifier: 'com.example.app' } as any,
    exp: { slug: 'my-app', name: 'My App' } as any,
    analytics: {} as any,
    credentialsCtx: { appStore: { ensureAuthenticatedAsync: jest.fn() }, vcsClient: {} } as any,
    nonInteractive: false,
    graphqlClient: {} as any,
    projectId: 'test-project-id',
    ...overrides,
  };
}

const { getAppStoreAuthAsync } = require('../auth') as jest.Mocked<typeof import('../auth')>;
const { createAppleReader, loadConfigAsync } = require('../config/resolve') as jest.Mocked<
  typeof import('../config/resolve')
>;

function mockApp(primaryLocale?: string) {
  (getAppStoreAuthAsync as jest.Mock).mockResolvedValueOnce({
    app: { id: '123', attributes: { primaryLocale } },
    auth: { context: { token: 'mock' } },
  });
}

function mockConfigLocales(locales: string[]) {
  (createAppleReader as jest.Mock).mockReturnValueOnce({
    getVersion: jest.fn(() => ({ versionString: '1.0.0' })),
    getLocales: jest.fn(() => locales),
  });
}

describe(uploadMetadataAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadConfigAsync as jest.Mock).mockResolvedValue({ configVersion: 0 });
  });

  it('throws MetadataValidationError directly in non-interactive mode without prompting', async () => {
    (loadConfigAsync as jest.Mock).mockRejectedValue(
      new MetadataValidationError('validation errors found')
    );

    await expect(uploadMetadataAsync(createArgs({ nonInteractive: true }))).rejects.toThrow(
      MetadataValidationError
    );
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('prompts user about validation errors in interactive mode', async () => {
    (loadConfigAsync as jest.Mock).mockRejectedValueOnce(
      new MetadataValidationError('validation errors found')
    );
    (confirmAsync as jest.Mock).mockResolvedValue(true);
    // Second call (with skipValidation) succeeds
    (loadConfigAsync as jest.Mock).mockResolvedValueOnce({ configVersion: 0 });

    await uploadMetadataAsync(createArgs({ nonInteractive: false }));

    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('still want to push') })
    );
  });

  it('re-throws validation error when user declines to continue in interactive mode', async () => {
    (loadConfigAsync as jest.Mock).mockRejectedValue(
      new MetadataValidationError('validation errors found')
    );
    (confirmAsync as jest.Mock).mockResolvedValue(false);

    await expect(uploadMetadataAsync(createArgs({ nonInteractive: false }))).rejects.toThrow(
      MetadataValidationError
    );
  });

  it('uploads successfully when config is valid', async () => {
    const result = await uploadMetadataAsync(createArgs());

    expect(result).toHaveProperty('appleLink');
    expect(result.appleLink).toContain('appstoreconnect.apple.com');
  });

  describe('locales', () => {
    it('warns the user when the store config omits the app primary locale', async () => {
      mockApp('en-GB');
      mockConfigLocales(['en-US', 'fr-FR']);

      await uploadMetadataAsync(createArgs());


      expect(jest.mocked(Log.warn)).toHaveBeenCalledTimes(1);
      const warn = jest.mocked(Log.warn);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Your store configuration includes "en-US", "fr-FR", but not the app's primary locale "en-GB".`
        )
      );
      
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`App Store Connect displays the primary locale by default`)
      );
      
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`Add a "en-GB" entry to your store.config.json.`)
      );
    });

    it('does not warn when the primary locale is included in the store config', async () => {
      mockApp('en-US');
      mockConfigLocales(['en-US', 'en-GB']);

      await uploadMetadataAsync(createArgs());

      expect(jest.mocked(Log.warn)).not.toHaveBeenCalled();
    });

    it('does not warn when the primary locale is the only configured locale', async () => {
      mockApp('en-US');
      mockConfigLocales(['en-US']);

      await uploadMetadataAsync(createArgs());

      expect(jest.mocked(Log.warn)).not.toHaveBeenCalled();
    });

    it('does not warn when the store config has no locales', async () => {
      mockApp('en-GB');
      mockConfigLocales([]);

      await uploadMetadataAsync(createArgs());

      expect(jest.mocked(Log.warn)).not.toHaveBeenCalled();
    });

    it('does not warn when the app has no primary locale', async () => {
      mockApp();
      mockConfigLocales(['en-US', 'en-GB']);

      await uploadMetadataAsync(createArgs());

      expect(jest.mocked(Log.warn)).not.toHaveBeenCalled();
    });
  });
});

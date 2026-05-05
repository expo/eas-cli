import { uploadMetadataAsync } from '../upload';
import { MetadataValidationError } from '../errors';

jest.mock('../auth', () => ({
  getAppStoreAuthAsync: jest.fn(() => ({
    app: { id: '123' },
    auth: { context: { token: 'mock' } },
  })),
}));

jest.mock('../apple/tasks', () => ({
  createAppleTasks: jest.fn(() => []),
}));

jest.mock('../config/resolve', () => ({
  createAppleReader: jest.fn(() => ({
    getVersion: jest.fn(() => ({ versionString: '1.0.0' })),
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

const { loadConfigAsync } = require('../config/resolve') as jest.Mocked<
  typeof import('../config/resolve')
>;
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
});

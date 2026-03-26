import fs from 'fs-extra';

import { downloadMetadataAsync } from '../download';
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
  createAppleWriter: jest.fn(() => ({
    toSchema: jest.fn(() => ({ configVersion: 0 })),
  })),
  getStaticConfigFilePath: jest.fn(() => '/app/store.config.json'),
}));

jest.mock('../utils/telemetry', () => ({
  subscribeTelemetryAsync: jest.fn(() => ({
    unsubscribeTelemetry: jest.fn(),
    executionId: 'exec-123',
  })),
}));

jest.mock('fs-extra', () => ({
  pathExists: jest.fn(() => false),
  writeJSON: jest.fn(),
}));

jest.mock('../../log');

jest.mock('../../prompts', () => ({
  confirmAsync: jest.fn(),
}));

const { confirmAsync } = require('../../prompts') as jest.Mocked<typeof import('../../prompts')>;

function createArgs(overrides: Record<string, any> = {}) {
  return {
    projectDir: '/app',
    profile: { bundleIdentifier: 'com.example.app' } as any,
    exp: { slug: 'my-app', name: 'My App' } as any,
    analytics: {} as any,
    credentialsCtx: { appStore: { ensureAuthenticatedAsync: jest.fn() }, vcsClient: {} } as any,
    nonInteractive: false,
    graphqlClient: {} as any,
    projectId: 'test-project-id',
    ...overrides,
  };
}

describe(downloadMetadataAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.pathExists as jest.Mock).mockResolvedValue(false);
  });

  it('skips overwrite prompt and auto-overwrites in non-interactive mode', async () => {
    (fs.pathExists as jest.Mock).mockResolvedValue(true);

    await downloadMetadataAsync(createArgs({ nonInteractive: true }));

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(fs.writeJSON).toHaveBeenCalled();
  });

  it('prompts for overwrite in interactive mode when file exists', async () => {
    (fs.pathExists as jest.Mock).mockResolvedValue(true);
    (confirmAsync as jest.Mock).mockResolvedValue(true);

    await downloadMetadataAsync(createArgs({ nonInteractive: false }));

    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('overwrite') })
    );
  });

  it('throws MetadataValidationError when user declines overwrite in interactive mode', async () => {
    (fs.pathExists as jest.Mock).mockResolvedValue(true);
    (confirmAsync as jest.Mock).mockResolvedValue(false);

    await expect(downloadMetadataAsync(createArgs({ nonInteractive: false }))).rejects.toThrow(
      MetadataValidationError
    );
  });

  it('does not prompt when file does not exist', async () => {
    (fs.pathExists as jest.Mock).mockResolvedValue(false);

    await downloadMetadataAsync(createArgs({ nonInteractive: false }));

    expect(confirmAsync).not.toHaveBeenCalled();
  });
});

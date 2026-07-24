import { Config } from '@oclif/core';
import { vol } from 'memfs';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppUploadSessionType } from '../../../../graphql/generated';
import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { uploadAppScopedFileAtPathToGCSAsync } from '../../../../uploads';
import { sleepAsync } from '../../../../utils/promise';
import ProjectIconSet from '../set';

jest.mock('fs');
jest.mock('../../../../graphql/queries/AppQuery');
jest.mock('../../../../log');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      succeed: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../../uploads');
jest.mock('../../../../utils/promise');

const mockByIdAsync = jest.mocked(AppQuery.byIdAsync);
const mockByIdProfileImageUrlAsync = jest.mocked(AppQuery.byIdProfileImageUrlAsync);
const mockUploadAsync = jest.mocked(uploadAppScopedFileAtPathToGCSAsync);
const mockSleepAsync = jest.mocked(sleepAsync);

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(ProjectIconSet, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'project-123';

  let now: number;

  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();

    now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockSleepAsync.mockImplementation(async ms => {
      now += ms;
    });

    mockByIdAsync.mockResolvedValue({
      id: projectId,
      fullName: '@test-account/test-project',
      slug: 'test-project',
      ownerAccount: { name: 'test-account' },
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createCommand(argv: string[]): ProjectIconSet {
    const command = new ProjectIconSet(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('uploads the icon and polls until the icon URL changes', async () => {
    vol.fromJSON({ '/app/icon.png': 'fake-png-bytes' });
    mockByIdProfileImageUrlAsync
      .mockResolvedValueOnce('https://example.com/old.png')
      .mockResolvedValueOnce('https://example.com/old.png')
      .mockResolvedValueOnce('https://example.com/new.png');

    const command = createCommand(['/app/icon.png']);
    await command.runAsync();

    expect(mockUploadAsync).toHaveBeenCalledWith(graphqlClient, {
      type: AppUploadSessionType.ProfileImageUpload,
      appId: projectId,
      path: '/app/icon.png',
    });
    expect(mockByIdProfileImageUrlAsync).toHaveBeenCalledTimes(3);
  });

  it('succeeds when the project had no icon before', async () => {
    vol.fromJSON({ '/app/icon.jpg': 'fake-jpg-bytes' });
    mockByIdProfileImageUrlAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://example.com/new.png');

    const command = createCommand(['/app/icon.jpg']);
    await command.runAsync();

    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  });

  it('throws when the file does not exist', async () => {
    const command = createCommand(['/app/missing.png']);
    await expect(command.runAsync()).rejects.toThrow('No file found at /app/missing.png');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('throws for an unsupported image format', async () => {
    vol.fromJSON({ '/app/icon.gif': 'fake-gif-bytes' });

    const command = createCommand(['/app/icon.gif']);
    await expect(command.runAsync()).rejects.toThrow('Unsupported image format ".gif"');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('throws for a file over the size limit', async () => {
    vol.fromJSON({ '/app/icon.png': 'x'.repeat(10 * 1024 * 1024 + 1) });

    const command = createCommand(['/app/icon.png']);
    await expect(command.runAsync()).rejects.toThrow('maximum allowed size is 10 MB');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('throws when the icon is not processed before the timeout', async () => {
    vol.fromJSON({ '/app/icon.png': 'fake-png-bytes' });
    mockByIdProfileImageUrlAsync.mockResolvedValue('https://example.com/old.png');

    const command = createCommand(['/app/icon.png']);
    await expect(command.runAsync()).rejects.toThrow(
      'Timed out waiting for the icon to be processed'
    );
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  });
});

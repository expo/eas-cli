import { Platform } from '@expo/eas-build-job';
import { Updates } from '@expo/config-plugins';
import { vol } from 'memfs';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { ChannelNotFoundError } from '../../../channel/errors';
import { EmbeddedUpdateAssetMutation } from '../../../graphql/mutations/EmbeddedUpdateAssetMutation';
import {
  EmbeddedUpdateMutation,
  isEmbeddedUpdateAssetNotReadyError,
  isEmbeddedUpdateConflictError,
} from '../../../graphql/mutations/EmbeddedUpdateMutation';
import { AppPlatform } from '../../../graphql/generated';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import Log from '../../../log';
import * as uploads from '../../../uploads';
import * as promise from '../../../utils/promise';
import UpdateUploadEmbedded from '../upload-embedded';

jest.mock('fs', () => jest.requireActual('memfs').fs);
jest.mock('@expo/config-plugins', () => ({
  Updates: { getRuntimeVersionNullableAsync: jest.fn() },
}));
jest.mock('../../../graphql/mutations/EmbeddedUpdateAssetMutation', () => ({
  EmbeddedUpdateAssetMutation: { getSignedUploadSpecAsync: jest.fn() },
}));
jest.mock('../../../graphql/mutations/EmbeddedUpdateMutation', () => ({
  EmbeddedUpdateMutation: { uploadEmbeddedUpdateAsync: jest.fn() },
  isEmbeddedUpdateAssetNotReadyError: jest.fn(),
  isEmbeddedUpdateConflictError: jest.fn(),
}));
jest.mock('../../../graphql/queries/ChannelQuery', () => ({
  ChannelQuery: { viewUpdateChannelBasicInfoAsync: jest.fn() },
}));
jest.mock('../../../uploads');
jest.mock('../../../log');
jest.mock('../../../utils/promise', () => ({
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockGetRuntimeVersion = jest.mocked(Updates.getRuntimeVersionNullableAsync);
const mockGetSignedUploadSpec = jest.mocked(EmbeddedUpdateAssetMutation.getSignedUploadSpecAsync);
const mockViewChannel = jest.mocked(ChannelQuery.viewUpdateChannelBasicInfoAsync);
const mockUpload = jest.mocked(uploads.uploadWithPresignedPostWithRetryAsync);
const mockLogLog = jest.mocked(Log.log);
const mockUploadEmbeddedUpdate = jest.mocked(EmbeddedUpdateMutation.uploadEmbeddedUpdateAsync);
const mockSleepAsync = jest.mocked(promise.sleepAsync);
const mockIsEmbeddedUpdateAssetNotReadyError = jest.mocked(isEmbeddedUpdateAssetNotReadyError);
const mockIsEmbeddedUpdateConflictError = jest.mocked(isEmbeddedUpdateConflictError);

const BUNDLE_PATH = '/project/app.bundle';
const MANIFEST_PATH = '/project/app.manifest';
const VALID_UUID = 'a1b2c3d4-1234-4000-8000-000000000000';
const VALID_MANIFEST = JSON.stringify({ id: VALID_UUID });

const BASE_ARGV = [
  '--platform',
  Platform.IOS,
  '--bundle',
  BUNDLE_PATH,
  '--manifest',
  MANIFEST_PATH,
  '--channel',
  'production',
];

const MOCK_CONTEXT = {
  loggedIn: { graphqlClient: {} as ExpoGraphqlClient },
  privateProjectConfig: {
    projectId: 'project-123',
    exp: { name: 'test', slug: 'test' },
    projectDir: '/project',
  },
};

const MOCK_EMBEDDED_UPDATE = {
  id: 'embedded-update-id-abc',
  platform: AppPlatform.Ios,
  runtimeVersion: '1.0.0',
  channelId: 'channel-id-123',
  createdAt: '2024-01-01T00:00:00Z',
};

describe(UpdateUploadEmbedded, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    vol.reset();
    vol.fromJSON({
      [BUNDLE_PATH]: 'bundle-bytes',
      [MANIFEST_PATH]: VALID_MANIFEST,
    });
    mockGetRuntimeVersion.mockResolvedValue('1.0.0');
    mockViewChannel.mockResolvedValue({ id: 'channel-id-123', name: 'production' } as any);
    mockGetSignedUploadSpec.mockResolvedValue({
      storageKey: 'storage-key-abc',
      presignedUrl: 'https://storage.googleapis.com/upload-bucket',
      fields: { key: 'obj-key', policy: 'abc123' },
    });
    mockUpload.mockResolvedValue(undefined as any);
    mockUploadEmbeddedUpdate.mockResolvedValue(MOCK_EMBEDDED_UPDATE);
    mockIsEmbeddedUpdateAssetNotReadyError.mockReturnValue(false);
    mockIsEmbeddedUpdateConflictError.mockReturnValue(false);
  });

  function createCommand(argv: string[]): UpdateUploadEmbedded {
    const command = new UpdateUploadEmbedded(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue(MOCK_CONTEXT);
    return command;
  }

  describe('file existence checks', () => {
    it('runs successfully when both files exist', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockLogLog).toHaveBeenCalledWith(expect.stringContaining('production'));
    });

    it('errors with message when bundle file does not exist', async () => {
      vol.reset();
      vol.fromJSON({ [MANIFEST_PATH]: VALID_MANIFEST });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/Bundle file not found/);
    });

    it('errors with message when manifest file does not exist', async () => {
      vol.reset();
      vol.fromJSON({ [BUNDLE_PATH]: 'bundle-bytes' });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/Manifest file not found/);
    });

    it('includes build-id in log when provided', async () => {
      const command = createCommand([...BASE_ARGV, '--build-id', 'build-uuid-123']);
      await command.runAsync();
      expect(mockLogLog).toHaveBeenCalledWith(expect.stringContaining('build-uuid-123'));
    });

    it('accepts android platform', async () => {
      const argv = [...BASE_ARGV];
      argv[1] = Platform.ANDROID;
      const command = createCommand(argv);
      await command.runAsync();
      expect(mockLogLog).toHaveBeenCalledWith(expect.stringContaining(Platform.ANDROID));
    });
  });

  describe('manifest parsing', () => {
    it('reads embeddedUpdateId from manifest and passes platform directly to getRuntimeVersion', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockGetRuntimeVersion).toHaveBeenCalledWith(
        MOCK_CONTEXT.privateProjectConfig.projectDir,
        MOCK_CONTEXT.privateProjectConfig.exp,
        Platform.IOS
      );
    });

    it('errors when manifest contains invalid JSON', async () => {
      vol.fromJSON({ [MANIFEST_PATH]: 'not-json', [BUNDLE_PATH]: 'bytes' });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/not valid JSON/);
    });

    it('errors when manifest id is missing', async () => {
      vol.fromJSON({ [MANIFEST_PATH]: JSON.stringify({ noId: true }), [BUNDLE_PATH]: 'bytes' });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/"id" field/);
    });

    it('errors when manifest id is not a valid UUID', async () => {
      vol.fromJSON({ [MANIFEST_PATH]: JSON.stringify({ id: 'not-a-uuid' }), [BUNDLE_PATH]: 'bytes' });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/is not a UUID/);
    });

    it('errors when runtimeVersion cannot be resolved', async () => {
      mockGetRuntimeVersion.mockResolvedValue(null);
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/runtimeVersion/);
    });
  });

  describe('channel resolution', () => {
    it('resolves channel by name and app id', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockViewChannel).toHaveBeenCalledWith(
        MOCK_CONTEXT.loggedIn.graphqlClient,
        { appId: MOCK_CONTEXT.privateProjectConfig.projectId, channelName: 'production' }
      );
    });

    it('propagates ChannelNotFoundError when channel does not exist', async () => {
      mockViewChannel.mockRejectedValue(new ChannelNotFoundError('Channel not found'));
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(ChannelNotFoundError);
    });
  });

  describe('bundle upload', () => {
    it('requests a presigned URL and uploads the bundle', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockGetSignedUploadSpec).toHaveBeenCalledWith(
        MOCK_CONTEXT.loggedIn.graphqlClient,
        expect.objectContaining({
          appId: MOCK_CONTEXT.privateProjectConfig.projectId,
          contentType: 'application/javascript',
        })
      );
      expect(mockUpload).toHaveBeenCalledWith(
        BUNDLE_PATH,
        { url: 'https://storage.googleapis.com/upload-bucket', fields: { key: 'obj-key', policy: 'abc123' } },
        expect.any(Function)
      );
    });

    it('propagates upload errors', async () => {
      mockUpload.mockRejectedValue(new Error('upload failed'));
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow('upload failed');
    });
  });

  describe('mutation registration', () => {
    it('calls uploadEmbeddedUpdateAsync with all collected inputs including AppPlatform enum', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledWith(
        MOCK_CONTEXT.loggedIn.graphqlClient,
        expect.objectContaining({
          appId: MOCK_CONTEXT.privateProjectConfig.projectId,
          platform: AppPlatform.Ios,
          runtimeVersion: '1.0.0',
          channelId: 'channel-id-123',
          embeddedUpdateId: VALID_UUID,
          launchAssetStorageKey: 'storage-key-abc',
        })
      );
    });

    it('logs the embedded update id on success', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockLogLog).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_EMBEDDED_UPDATE.id)
      );
    });

    it('passes build-id as turtleBuildId when provided', async () => {
      const command = createCommand([...BASE_ARGV, '--build-id', 'turtle-build-xyz']);
      await command.runAsync();
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ turtleBuildId: 'turtle-build-xyz' })
      );
    });

    it('retries on ASSET_NOT_READY: succeeds on second attempt, sleeps once with first delay', async () => {
      const assetNotReadyError = new Error('asset not ready');
      mockIsEmbeddedUpdateAssetNotReadyError.mockImplementation(e => e === assetNotReadyError);
      mockUploadEmbeddedUpdate
        .mockRejectedValueOnce(assetNotReadyError)
        .mockResolvedValueOnce(MOCK_EMBEDDED_UPDATE);

      const command = createCommand(BASE_ARGV);
      await command.runAsync();

      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(2);
      expect(mockSleepAsync).toHaveBeenCalledTimes(1);
      expect(mockSleepAsync).toHaveBeenCalledWith(3_000);
      expect(mockLogLog).toHaveBeenCalledWith(expect.stringContaining(MOCK_EMBEDDED_UPDATE.id));
    });

    it('exhausts all 10 attempts on ASSET_NOT_READY, sleeping 9 times then throwing', async () => {
      const assetNotReadyError = new Error('asset not ready');
      mockIsEmbeddedUpdateAssetNotReadyError.mockImplementation(e => e === assetNotReadyError);
      mockUploadEmbeddedUpdate.mockRejectedValue(assetNotReadyError);

      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow();
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(10);
      expect(mockSleepAsync).toHaveBeenCalledTimes(9);
    });

    it('throws a user-facing error on CONFLICT without retrying', async () => {
      const conflictError = new Error('conflict');
      mockIsEmbeddedUpdateConflictError.mockImplementation(e => e === conflictError);
      mockUploadEmbeddedUpdate.mockRejectedValue(conflictError);

      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/already registered/);
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(1);
      expect(mockSleepAsync).not.toHaveBeenCalled();
    });

    it('propagates unexpected mutation errors immediately without retrying', async () => {
      const unexpectedError = new Error('network timeout');
      mockUploadEmbeddedUpdate.mockRejectedValue(unexpectedError);

      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow('network timeout');
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(1);
    });
  });
});

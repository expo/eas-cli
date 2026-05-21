import { Platform } from '@expo/eas-build-job';
import { Updates } from '@expo/config-plugins';
import { vol } from 'memfs';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EmbeddedUpdateAssetMutation } from '../../../../graphql/mutations/EmbeddedUpdateAssetMutation';
import {
  EmbeddedUpdateMutation,
  isEmbeddedUpdateAlreadyExistsError,
  isEmbeddedUpdateAssetNotAvailableError,
} from '../../../../graphql/mutations/EmbeddedUpdateMutation';
import { AppPlatform } from '../../../../graphql/generated';
import Log from '../../../../log';
import { ora } from '../../../../ora';
import * as uploads from '../../../../uploads';
import * as json from '../../../../utils/json';
import * as promise from '../../../../utils/promise';
import UpdateEmbeddedUpload from '../upload';

jest.mock('fs', () => jest.requireActual('memfs').fs);
jest.mock('../../../../ora');
jest.mock('@expo/config-plugins', () => ({
  Updates: { getRuntimeVersionNullableAsync: jest.fn() },
}));
jest.mock('../../../../graphql/mutations/EmbeddedUpdateAssetMutation', () => ({
  EmbeddedUpdateAssetMutation: { getSignedUploadSpecAsync: jest.fn() },
}));
jest.mock('../../../../graphql/mutations/EmbeddedUpdateMutation', () => ({
  EmbeddedUpdateMutation: { uploadEmbeddedUpdateAsync: jest.fn() },
  isEmbeddedUpdateAssetNotAvailableError: jest.fn(),
  isEmbeddedUpdateAlreadyExistsError: jest.fn(),
}));
jest.mock('../../../../uploads');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../utils/promise', () => ({
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockGetRuntimeVersion = jest.mocked(Updates.getRuntimeVersionNullableAsync);
const mockGetSignedUploadSpec = jest.mocked(EmbeddedUpdateAssetMutation.getSignedUploadSpecAsync);
const mockUpload = jest.mocked(uploads.uploadWithPresignedPostWithRetryAsync);
const mockUploadEmbeddedUpdate = jest.mocked(EmbeddedUpdateMutation.uploadEmbeddedUpdateAsync);
const mockOra = jest.mocked(ora);
const mockUploadSpinnerSucceed = jest.fn();
const mockUploadSpinnerFail = jest.fn();
const mockRegisterSpinnerSucceed = jest.fn();
const mockRegisterSpinnerFail = jest.fn();
const mockSleepAsync = jest.mocked(promise.sleepAsync);
const mockIsEmbeddedUpdateAssetNotAvailableError = jest.mocked(
  isEmbeddedUpdateAssetNotAvailableError
);
const mockIsEmbeddedUpdateAlreadyExistsError = jest.mocked(isEmbeddedUpdateAlreadyExistsError);
const mockLogLog = jest.mocked(Log.log);
const mockLogWarn = jest.mocked(Log.warn);

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
  channel: 'production',
  createdAt: '2024-01-01T00:00:00Z',
};

describe(UpdateEmbeddedUpload, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    mockOra.mockImplementation(
      (text?: string | object) =>
        ({
          start: () =>
            text === 'Uploading bundle...'
              ? { succeed: mockUploadSpinnerSucceed, fail: mockUploadSpinnerFail }
              : { succeed: mockRegisterSpinnerSucceed, fail: mockRegisterSpinnerFail },
        }) as any
    );
    vol.reset();
    vol.fromJSON({
      [BUNDLE_PATH]: 'bundle-bytes',
      [MANIFEST_PATH]: VALID_MANIFEST,
    });
    mockGetRuntimeVersion.mockResolvedValue('1.0.0');
    mockGetSignedUploadSpec.mockResolvedValue({
      storageKey: 'storage-key-abc',
      presignedUrl: 'https://storage.googleapis.com/upload-bucket',
      fields: { key: 'obj-key', policy: 'abc123' },
    });
    mockUpload.mockImplementation(async (_path, _spec, onProgress) => {
      // Invoke the progress callback so the no-op arrow passed by the command is executed.
      (onProgress as () => void)();
      return undefined as any;
    });
    mockUploadEmbeddedUpdate.mockResolvedValue(MOCK_EMBEDDED_UPDATE);
    mockIsEmbeddedUpdateAssetNotAvailableError.mockReturnValue(false);
    mockIsEmbeddedUpdateAlreadyExistsError.mockReturnValue(false);
  });

  function createCommand(argv: string[]): UpdateEmbeddedUpload {
    const command = new UpdateEmbeddedUpload(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue(MOCK_CONTEXT);
    return command;
  }

  describe('file existence checks', () => {
    it('runs successfully when both files exist', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockUploadSpinnerSucceed).toHaveBeenCalledWith('Uploaded bundle');
      expect(mockRegisterSpinnerSucceed).toHaveBeenCalledWith(
        expect.stringContaining('production')
      );
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
      await expect(command.runAsync()).rejects.toThrow(/Could not read or parse manifest/);
    });

    it('includes build-id in log when provided', async () => {
      const command = createCommand([...BASE_ARGV, '--build-id', 'build-uuid-123']);
      await command.runAsync();
      expect(mockRegisterSpinnerSucceed).toHaveBeenCalledWith(
        expect.stringContaining('production')
      );
    });

    it('accepts android platform', async () => {
      const argv = [...BASE_ARGV];
      argv[1] = Platform.ANDROID;
      const command = createCommand(argv);
      await command.runAsync();
      expect(mockRegisterSpinnerSucceed).toHaveBeenCalledWith(
        expect.stringContaining(Platform.ANDROID)
      );
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
      await expect(command.runAsync()).rejects.toThrow(/Could not read or parse manifest/);
    });

    it('errors when manifest id is missing', async () => {
      vol.fromJSON({ [MANIFEST_PATH]: JSON.stringify({ noId: true }), [BUNDLE_PATH]: 'bytes' });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/"id" field/);
    });

    it('errors when manifest id is not a valid UUID', async () => {
      vol.fromJSON({
        [MANIFEST_PATH]: JSON.stringify({ id: 'not-a-uuid' }),
        [BUNDLE_PATH]: 'bytes',
      });
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/is not a UUID/);
    });

    it('errors when runtimeVersion cannot be resolved', async () => {
      mockGetRuntimeVersion.mockResolvedValue(null);
      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow(/runtimeVersion/);
    });
  });

  describe('bundle upload', () => {
    it('requests a presigned URL with embeddedUpdateId and uploads the bundle', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockGetSignedUploadSpec).toHaveBeenCalledWith(
        MOCK_CONTEXT.loggedIn.graphqlClient,
        expect.objectContaining({
          appId: MOCK_CONTEXT.privateProjectConfig.projectId,
          embeddedUpdateId: VALID_UUID,
          contentType: 'application/javascript',
        })
      );
      expect(mockUpload).toHaveBeenCalledWith(
        BUNDLE_PATH,
        {
          url: 'https://storage.googleapis.com/upload-bucket',
          fields: { key: 'obj-key', policy: 'abc123' },
        },
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
    it('calls uploadEmbeddedUpdateAsync with channel name and AppPlatform enum', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledWith(
        MOCK_CONTEXT.loggedIn.graphqlClient,
        expect.objectContaining({
          appId: MOCK_CONTEXT.privateProjectConfig.projectId,
          platform: AppPlatform.Ios,
          runtimeVersion: '1.0.0',
          channel: 'production',
          embeddedUpdateId: VALID_UUID,
        })
      );
    });

    it('logs the embedded update id on success', async () => {
      const command = createCommand(BASE_ARGV);
      await command.runAsync();
      expect(mockUploadSpinnerSucceed).toHaveBeenCalledWith('Uploaded bundle');
      expect(mockLogLog).toHaveBeenCalledWith(expect.stringContaining(MOCK_EMBEDDED_UPDATE.id));
    });

    it('passes build-id as turtleBuildId when provided', async () => {
      const command = createCommand([...BASE_ARGV, '--build-id', 'turtle-build-xyz']);
      await command.runAsync();
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ turtleBuildId: 'turtle-build-xyz' })
      );
    });

    it('retries on ASSET_NOT_AVAILABLE: succeeds on second attempt, sleeps once with first delay', async () => {
      const assetNotAvailableError = new Error('asset not available');
      mockIsEmbeddedUpdateAssetNotAvailableError.mockImplementation(
        e => e === assetNotAvailableError
      );
      mockUploadEmbeddedUpdate
        .mockRejectedValueOnce(assetNotAvailableError)
        .mockResolvedValueOnce(MOCK_EMBEDDED_UPDATE);

      const command = createCommand(BASE_ARGV);
      await command.runAsync();

      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(2);
      expect(mockSleepAsync).toHaveBeenCalledTimes(1);
      expect(mockSleepAsync).toHaveBeenCalledWith(3_000);
      expect(mockUploadSpinnerSucceed).toHaveBeenCalledWith('Uploaded bundle');
      expect(mockLogLog).toHaveBeenCalledWith(expect.stringContaining(MOCK_EMBEDDED_UPDATE.id));
    });

    it('exhausts all 10 attempts on ASSET_NOT_AVAILABLE, sleeping 9 times then throwing', async () => {
      const assetNotAvailableError = new Error('asset not available');
      mockIsEmbeddedUpdateAssetNotAvailableError.mockImplementation(
        e => e === assetNotAvailableError
      );
      mockUploadEmbeddedUpdate.mockRejectedValue(assetNotAvailableError);

      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow();
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(10);
      expect(mockSleepAsync).toHaveBeenCalledTimes(9);
    });

    it('propagates unexpected mutation errors immediately without retrying', async () => {
      const unexpectedError = new Error('network timeout');
      mockUploadEmbeddedUpdate.mockRejectedValue(unexpectedError);

      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toThrow('network timeout');
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(1);
      expect(mockRegisterSpinnerFail).toHaveBeenCalledWith('Failed to register embedded update');
    });

    it('warns with delete-and-re-upload hint when the server reports ALREADY_EXISTS', async () => {
      const alreadyExistsError = new Error('already exists');
      mockIsEmbeddedUpdateAlreadyExistsError.mockImplementation(e => e === alreadyExistsError);
      mockUploadEmbeddedUpdate.mockRejectedValue(alreadyExistsError);

      const command = createCommand(BASE_ARGV);
      await expect(command.runAsync()).rejects.toBe(alreadyExistsError);
      expect(mockUploadEmbeddedUpdate).toHaveBeenCalledTimes(1);
      expect(mockRegisterSpinnerFail).toHaveBeenCalledWith('Failed to register embedded update');
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('already registered'));
    });
  });

  describe('--json flag', () => {
    it('enables JSON output and prints the embedded update as JSON', async () => {
      const command = createCommand([...BASE_ARGV, '--json', '--non-interactive']);
      await command.runAsync();
      expect(jest.mocked(json.enableJsonOutput)).toHaveBeenCalled();
      expect(jest.mocked(json.printJsonOnlyOutput)).toHaveBeenCalledWith(MOCK_EMBEDDED_UPDATE);
    });
  });
});

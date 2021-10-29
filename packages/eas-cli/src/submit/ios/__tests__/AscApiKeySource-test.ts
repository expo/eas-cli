import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { getCredentialsFromUserAsync } from '../../../credentials/utils/promptForCredentials';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { promptAsync } from '../../../prompts';
import { SubmissionContext, createSubmissionContextAsync } from '../../context';
import {
  AscApiKeySource,
  AscApiKeySourceType,
  getAscApiKeyLocallyAsync,
  getAscApiKeyPathAsync,
} from '../AscApiKeySource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../credentials/utils/promptForCredentials');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/Account', () => ({
  findAccountByName: jest.fn(() => mockJester.accounts[0]),
}));

const testProject = createTestProject(mockJester, {
  android: {
    package: 'com.expo.test.project',
  },
});
const mockManifest = { exp: testProject.appJSON.expo };
jest.mock('@expo/config', () => ({
  getConfig: jest.fn(() => mockManifest),
}));
const projectId = uuidv4();

async function getIosSubmissionContextAsync(): Promise<SubmissionContext<Platform.IOS>> {
  return await createSubmissionContextAsync({
    platform: Platform.IOS,
    projectDir: testProject.projectRoot,
    projectId,
    archiveFlags: {
      url: 'http://expo.dev/fake.apk',
    },
    profile: {
      language: 'en-US',
    },
    nonInteractive: true,
  });
}

beforeAll(() => {
  vol.fromJSON({
    '/asc-api-key.p8': 'super secret',
    '/project_dir/subdir/asc-api-key.p8': 'super secret',
    '/project_dir/another-asc-api-key.p8': 'super secret',
  });
});
afterAll(() => {
  vol.reset();
});

afterEach(() => {
  asMock(promptAsync).mockClear();
});

describe(getAscApiKeyPathAsync, () => {
  describe('when source is AscApiKeySourceType.path', () => {
    it("prompts for path if the provided file doesn't exist", async () => {
      asMock(promptAsync).mockImplementationOnce(() => ({
        keyP8Path: '/asc-api-key.p8',
      }));
      asMock(getCredentialsFromUserAsync).mockImplementation(() => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/doesnt-exist.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).toHaveBeenCalled();
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });

    it("doesn't prompt for path if the provided file exists", async () => {
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('returns the provided file path if the file exists', async () => {
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(ascApiKeyPath).toEqual({
        issuerId: 'test-issuer-id',
        keyId: 'test-key-id',
        keyP8Path: '/asc-api-key.p8',
      });
    });
  });

  describe('when source is AscApiKeySourceType.prompt', () => {
    it('prompts for path', async () => {
      asMock(promptAsync).mockImplementationOnce(() => ({
        keyP8Path: '/asc-api-key.p8',
      }));
      asMock(getCredentialsFromUserAsync).mockImplementation(() => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.prompt,
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).toHaveBeenCalled();
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });

    it('prompts for path until the user provides an existing file', async () => {
      asMock(promptAsync)
        .mockImplementationOnce(() => ({
          keyP8Path: '/doesnt-exist.p8',
        }))
        .mockImplementationOnce(() => ({
          keyP8Path: '/blah.p8',
        }))
        .mockImplementationOnce(() => ({
          keyP8Path: '/asc-api-key.p8',
        }));
      asMock(getCredentialsFromUserAsync).mockImplementation(() => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.prompt,
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).toHaveBeenCalledTimes(3);
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });
  });
});

describe(getAscApiKeyLocallyAsync, () => {
  it('returns a local Asc Api Key file with a AscApiKeySourceType.path source', async () => {
    const ctx = await getIosSubmissionContextAsync();
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.path,
      path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
    };
    const ascApiKeyResult = await getAscApiKeyLocallyAsync(ctx, source);
    expect(ascApiKeyResult).toMatchObject({
      result: {
        keyP8: 'super secret',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      },
      summary: {
        source: 'local',
        path: '/asc-api-key.p8',
        keyId: 'test-key-id',
      },
    });
  });

  it('returns a local Asc Api Key file with a AscApiKeySourceType.prompt source', async () => {
    asMock(promptAsync).mockImplementationOnce(() => ({
      keyP8Path: '/asc-api-key.p8',
    }));
    asMock(getCredentialsFromUserAsync).mockImplementationOnce(() => ({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
    }));
    const ctx = await getIosSubmissionContextAsync();
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.prompt,
    };
    const serviceAccountResult = await getAscApiKeyLocallyAsync(ctx, source);
    expect(serviceAccountResult).toMatchObject({
      result: {
        keyP8: 'super secret',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      },
      summary: {
        source: 'local',
        path: '/asc-api-key.p8',
        keyId: 'test-key-id',
      },
    });
  });
});

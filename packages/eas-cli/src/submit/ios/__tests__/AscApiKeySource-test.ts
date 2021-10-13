import { vol } from 'memfs';

import { asMock } from '../../../__tests__/utils';
import { getCredentialsFromUserAsync } from '../../../credentials/utils/promptForCredentials';
import { promptAsync } from '../../../prompts';
import {
  AscApiKeySource,
  AscApiKeySourceType,
  getAscApiKeyLocallyAsync,
  getAscApiKeyPathAsync,
} from '../AscApiKeySource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../credentials/utils/promptForCredentials');

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
      asMock(getCredentialsFromUserAsync).mockImplementationOnce(() => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/doesnt-exist.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(source);
      expect(promptAsync).toHaveBeenCalled();
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });

    it("doesn't prompt for path if the provided file exists", async () => {
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      await getAscApiKeyPathAsync(source);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('returns the provided file path if the file exists', async () => {
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(source);
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
      asMock(getCredentialsFromUserAsync).mockImplementationOnce(() => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.prompt,
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(source);
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
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.prompt,
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(source);
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
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.path,
      path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
    };
    const ascApiKeyResult = await getAscApiKeyLocallyAsync(source);
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
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.prompt,
    };
    const serviceAccountResult = await getAscApiKeyLocallyAsync(source);
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

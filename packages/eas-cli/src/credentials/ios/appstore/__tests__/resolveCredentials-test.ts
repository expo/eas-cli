import { JsonFileCache } from '@expo/apple-utils';
import * as fs from 'fs-extra';
import { vol } from 'memfs';

import { promptAsync } from '../../../../prompts';
import { AppleTeamType } from '../authenticateTypes';
import * as Keychain from '../keychain';
import {
  resolveAppleTeamAsync,
  resolveAscApiKeyAsync,
  resolveUserCredentialsAsync,
} from '../resolveCredentials';

jest.mock('../../../../prompts');
jest.mock('fs');
jest.mock('@expo/apple-utils', () => {
  return {
    getCacheAsync: jest.fn(),
    usernameCachePath: jest.fn(),
    ...jest.requireActual('@expo/apple-utils'),
  };
});
jest.mock('../keychain');

const testAscApiKey = {
  keyP8: 'test-key-p8',
  keyId: 'test-key-id',
  issuerId: 'test-issuer-id',
};

beforeEach(() => {
  vol.reset();
  process.env = {};
  jest.mocked(promptAsync).mockReset();
});

describe(resolveAscApiKeyAsync, () => {
  it(`uses option overrides over environment variables`, async () => {
    process.env.EXPO_ASC_API_KEY_PATH = 'not supposed to be here';
    process.env.EXPO_ASC_KEY_ID = 'not supposed to be here';
    process.env.EXPO_ASC_ISSUER_ID = 'not supposed to be here';
    const ascApiKey = await resolveAscApiKeyAsync(testAscApiKey);
    expect(ascApiKey).toMatchObject(testAscApiKey);
  });
  it(`uses environment variables if no option overrides are provided`, async () => {
    vol.fromJSON({
      '/test-asc-key.p8': testAscApiKey.keyP8,
    });

    process.env.EXPO_ASC_API_KEY_PATH = '/test-asc-key.p8';
    process.env.EXPO_ASC_KEY_ID = testAscApiKey.keyId;
    process.env.EXPO_ASC_ISSUER_ID = testAscApiKey.issuerId;

    const ascApiKey = await resolveAscApiKeyAsync();
    expect(ascApiKey).toMatchObject(testAscApiKey);
  });
  it(`prompts the user if it can't find anything else`, async () => {
    vol.fromJSON({
      '/test-asc-key.p8': testAscApiKey.keyP8,
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      ascApiKeyPath: '/test-asc-key.p8',
      ascIssuerId: testAscApiKey.issuerId,
      ascApiKeyId: testAscApiKey.keyId,
    }));
    const ascApiKey = await resolveAscApiKeyAsync();
    expect(ascApiKey).toMatchObject(testAscApiKey);
  });
});

const testTeam = {
  teamId: 'test-id',
  teamName: 'test-name',
  teamType: AppleTeamType.IN_HOUSE,
};
describe(resolveAppleTeamAsync, () => {
  it(`uses option overrides over environment variables`, async () => {
    process.env.EXPO_APPLE_TEAM_ID = 'not supposed to be here';
    process.env.EXPO_APPLE_TEAM_TYPE = 'not supposed to be here';
    const team = await resolveAppleTeamAsync(testTeam);
    expect(team).toMatchObject({ id: testTeam.teamId, name: testTeam.teamName, inHouse: true });
  });
  it(`uses environment variables if no option overrides are provided`, async () => {
    process.env.EXPO_APPLE_TEAM_ID = testTeam.teamId;
    process.env.EXPO_APPLE_TEAM_TYPE = testTeam.teamType;

    const team = await resolveAppleTeamAsync();
    expect(team).toMatchObject({
      id: testTeam.teamId,
      name: undefined,
      inHouse: true,
    });
  });
  it(`prompts the user if it can't find anything else`, async () => {
    jest.mocked(promptAsync).mockImplementation(async () => ({
      appleTeamId: testTeam.teamId,
      appleTeamType: testTeam.teamType,
    }));
    const team = await resolveAppleTeamAsync();
    expect(team).toMatchObject({
      id: testTeam.teamId,
      name: undefined,
      inHouse: true,
    });
  });
});

describe(resolveUserCredentialsAsync, () => {
  let KeychainMock: any;
  beforeAll(() => {
    JsonFileCache.getCacheAsync = jest.fn().mockImplementation(async (filePath: string) => {
      const content = await fs.readFile(filePath, 'utf-8');
      return content ? JSON.parse(content) : null;
    });
    KeychainMock = jest.mocked(Keychain);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    KeychainMock.EXPO_NO_KEYCHAIN = '';
  });

  it('uses credentials resolved from options', async () => {
    const result = await resolveUserCredentialsAsync({
      username: 'fakeUsername',
      password: 'fakePassword',
    });
    expect(result).toMatchObject({
      username: 'fakeUsername',
      password: 'fakePassword',
    });
  });

  it('uses credentials resolved from environment', async () => {
    process.env.EXPO_APPLE_ID = 'fakeUsername';
    process.env.EXPO_APPLE_PASSWORD = 'fakePassword';

    const result = await resolveUserCredentialsAsync({});
    expect(result).toMatchObject({
      username: 'fakeUsername',
      password: 'fakePassword',
    });
  });

  it('uses credentials from prompt, does not update cache if they match', async () => {
    vol.fromJSON({
      './.app-store/auth/username.json': `
      {
        "username": "fakeUsername"
      }
      `,
    });
    jest.mocked(promptAsync).mockResolvedValueOnce({ username: 'fakeUsername' });
    JsonFileCache.usernameCachePath = jest.fn().mockReturnValue('./.app-store/auth/username.json');
    const cacheAsyncSpy = jest.spyOn(JsonFileCache, 'cacheAsync');

    const result = await resolveUserCredentialsAsync({});
    expect(result).toMatchObject({
      username: 'fakeUsername',
    });
    expect(cacheAsyncSpy).not.toHaveBeenCalled();
  });

  it("uses credentials from prompt, updates cache if they don't match", async () => {
    vol.fromJSON({
      './.app-store/auth/username.json': `
      {
        "username": "fakeUsername"
      }
      `,
    });
    jest.mocked(promptAsync).mockResolvedValueOnce({ username: 'newFakeUsername' });
    JsonFileCache.usernameCachePath = jest.fn().mockReturnValue('./.app-store/auth/username.json');
    const cacheAsyncSpy = jest.spyOn(JsonFileCache, 'cacheAsync');

    expect(JSON.parse(await fs.readFile('./.app-store/auth/username.json', 'utf-8'))).toMatchObject(
      { username: 'fakeUsername' }
    );
    const result = await resolveUserCredentialsAsync({});
    expect(result).toMatchObject({
      username: 'newFakeUsername',
    });
    expect(cacheAsyncSpy).toHaveBeenCalledWith('./.app-store/auth/username.json', {
      username: 'newFakeUsername',
    });
    expect(JSON.parse(await fs.readFile('./.app-store/auth/username.json', 'utf-8'))).toMatchObject(
      { username: 'newFakeUsername' }
    );
  });

  it("uses credentials from prompt, doesn't read or update cache if EXPO_NO_KEYCHAIN is set", async () => {
    vol.fromJSON({
      './.app-store/auth/username.json': `
      {
        "username": "fakeUsername"
      }
      `,
    });
    jest.mocked(promptAsync).mockResolvedValueOnce({ username: 'newFakeUsername' });
    JsonFileCache.usernameCachePath = jest.fn().mockReturnValue('./.app-store/auth/username.json');
    KeychainMock.EXPO_NO_KEYCHAIN = 'true';
    const getCacheAsyncSpy = jest.spyOn(JsonFileCache, 'getCacheAsync');
    const cacheAsyncSpy = jest.spyOn(JsonFileCache, 'cacheAsync');

    expect(JSON.parse(await fs.readFile('./.app-store/auth/username.json', 'utf-8'))).toMatchObject(
      { username: 'fakeUsername' }
    );
    const result = await resolveUserCredentialsAsync({});
    expect(result).toMatchObject({
      username: 'newFakeUsername',
    });
    expect(getCacheAsyncSpy).not.toHaveBeenCalled();
    expect(cacheAsyncSpy).not.toHaveBeenCalled();
    await expect(fs.access('./.app-store/auth/username.json')).rejects.toThrow();
  });

  it('clears credentials from prompt if malformed before using and updating cache', async () => {
    vol.fromJSON({
      './.app-store/auth/username.json': `
      {
        "username": "fakeUsername"
      }
      `,
    });
    jest.mocked(promptAsync).mockResolvedValueOnce({ username: '\x17newFake\x01Username\x1F' });
    JsonFileCache.usernameCachePath = jest.fn().mockReturnValue('./.app-store/auth/username.json');
    const cacheAsyncSpy = jest.spyOn(JsonFileCache, 'cacheAsync');

    expect(JSON.parse(await fs.readFile('./.app-store/auth/username.json', 'utf-8'))).toMatchObject(
      { username: 'fakeUsername' }
    );
    const result = await resolveUserCredentialsAsync({});
    expect(result).toMatchObject({
      username: 'newFakeUsername',
    });
    expect(cacheAsyncSpy).toHaveBeenCalledWith('./.app-store/auth/username.json', {
      username: 'newFakeUsername',
    });
    expect(JSON.parse(await fs.readFile('./.app-store/auth/username.json', 'utf-8'))).toMatchObject(
      { username: 'newFakeUsername' }
    );
  });
});

import { vol } from 'memfs';

import { promptAsync } from '../../../../prompts';
import { AppleTeamType } from '../authenticateTypes';
import { resolveAppleTeamAsync, resolveAscApiKeyAsync } from '../resolveCredentials';

jest.mock('../../../../prompts');
jest.mock('fs');

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
    const ascApiKey = await resolveAscApiKeyAsync({ ascApiKey: testAscApiKey });
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

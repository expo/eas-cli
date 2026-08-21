import { Token } from '@expo/apple-utils';

import {
  authenticateAsync,
  isIndividualAscApiKeyAuthCtx,
  withIndividualAscApiKeyProvisioningHint,
} from '../authenticate';
import { ApiKeyAuthCtx, AppleTeamType, AuthCtx, AuthenticationMode } from '../authenticateTypes';

jest.mock('@expo/apple-utils', () => ({
  ...jest.requireActual('@expo/apple-utils'),
  Token: jest.fn(() => ({})),
}));

const apiKeyAuthOptions = {
  mode: AuthenticationMode.API_KEY,
  teamId: 'team-id',
  teamType: AppleTeamType.COMPANY_OR_ORGANIZATION,
};

describe(authenticateAsync, () => {
  beforeEach(() => {
    delete process.env.EXPO_ASC_API_KEY_PATH;
    delete process.env.EXPO_ASC_KEY_ID;
    delete process.env.EXPO_ASC_ISSUER_ID;
    jest.mocked(Token).mockClear();
  });

  it('authenticates with a team API key', async () => {
    const authCtx = (await authenticateAsync({
      ...apiKeyAuthOptions,
      ascApiKey: { keyP8: 'p8-content', keyId: 'key-id', issuerId: 'issuer-id' },
    })) as ApiKeyAuthCtx;

    expect(authCtx.ascApiKey.issuerId).toBe('issuer-id');
    expect(Token).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: 'key-id', issuerId: 'issuer-id' })
    );
  });

  it('rejects an individual (issuer-less) API key by default', async () => {
    await expect(
      authenticateAsync({
        ...apiKeyAuthOptions,
        ascApiKey: { keyP8: 'p8-content', keyId: 'key-id' },
      })
    ).rejects.toThrow('individual API key');
    expect(Token).not.toHaveBeenCalled();
  });

  it('accepts an individual API key when allowIndividualAscApiKey is set', async () => {
    const authCtx = (await authenticateAsync({
      ...apiKeyAuthOptions,
      allowIndividualAscApiKey: true,
      ascApiKey: { keyP8: 'p8-content', keyId: 'key-id' },
    })) as ApiKeyAuthCtx;

    expect(authCtx.ascApiKey.issuerId).toBeUndefined();
    expect(Token).toHaveBeenCalledWith(expect.objectContaining({ keyId: 'key-id' }));
  });
});

const individualKeyAuthCtx = {
  ascApiKey: { keyP8: 'p8-content', keyId: 'key-id' },
  team: { id: 'team-id' },
} as AuthCtx;
const teamKeyAuthCtx = {
  ascApiKey: { keyP8: 'p8-content', keyId: 'key-id', issuerId: 'issuer-id' },
  team: { id: 'team-id' },
} as AuthCtx;
const userAuthCtx = {
  appleId: 'user@example.com',
  team: { id: 'team-id' },
} as AuthCtx;

describe(isIndividualAscApiKeyAuthCtx, () => {
  it('detects an individual API key auth context', () => {
    expect(isIndividualAscApiKeyAuthCtx(individualKeyAuthCtx)).toBe(true);
    expect(isIndividualAscApiKeyAuthCtx(teamKeyAuthCtx)).toBe(false);
    expect(isIndividualAscApiKeyAuthCtx(userAuthCtx)).toBe(false);
    expect(isIndividualAscApiKeyAuthCtx(undefined)).toBe(false);
  });
});

describe(withIndividualAscApiKeyProvisioningHint, () => {
  it('appends a hint to a 401 NOT_AUTHORIZED error under an individual key', () => {
    const error = new Error('Request failed: NOT_AUTHORIZED (401)');

    const result = withIndividualAscApiKeyProvisioningHint(error, individualKeyAuthCtx);

    expect(result).toBe(error);
    expect(error.message).toContain('individual key');
    expect(error.message).toContain('Provisioning endpoints');
  });

  it('leaves the error unchanged under a team key', () => {
    const error = new Error('Request failed: NOT_AUTHORIZED (401)');

    withIndividualAscApiKeyProvisioningHint(error, teamKeyAuthCtx);

    expect(error.message).toBe('Request failed: NOT_AUTHORIZED (401)');
  });

  it('leaves unrelated errors unchanged', () => {
    const error = new Error('Some other failure');

    withIndividualAscApiKeyProvisioningHint(error, individualKeyAuthCtx);

    expect(error.message).toBe('Some other failure');
  });
});

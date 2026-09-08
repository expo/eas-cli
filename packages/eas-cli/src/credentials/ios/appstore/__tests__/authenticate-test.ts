import { Token } from '@expo/apple-utils';

import { authenticateAsync, isIndividualAscApiKeyAuthCtx } from '../authenticate';
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

  it('authenticates with an individual (issuer-less) API key', async () => {
    const authCtx = (await authenticateAsync({
      ...apiKeyAuthOptions,
      ascApiKey: { keyP8: 'p8-content', keyId: 'key-id' },
    })) as ApiKeyAuthCtx;

    expect(authCtx.ascApiKey.issuerId).toBeUndefined();
    expect(Token).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: 'key-id', issuerId: undefined })
    );
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

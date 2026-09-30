import { getAppStoreConnectApiKeyJsonAsync } from '../internal';
import { AppStoreConnectApiKeyQuery } from '../../../graphql/queries/AppStoreConnectApiKeyQuery';

jest.mock('../../../graphql/queries/AppStoreConnectApiKeyQuery', () => ({
  AppStoreConnectApiKeyQuery: {
    getByIdAsync: jest.fn(),
  },
}));

describe(getAppStoreConnectApiKeyJsonAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes issuer_id for an inline team key', async () => {
    const json = await getAppStoreConnectApiKeyJsonAsync({
      iosConfig: {
        ascApiKey: {
          keyIdentifier: 'KEY123',
          issuerIdentifier: 'ISSUER456',
          keyP8: 'p8-content',
        },
      } as any,
      graphqlClient: {} as any,
    });

    expect(JSON.parse(json!)).toEqual({
      key_id: 'KEY123',
      issuer_id: 'ISSUER456',
      key: 'p8-content',
    });
  });

  it('omits issuer_id for an inline individual key', async () => {
    const json = await getAppStoreConnectApiKeyJsonAsync({
      iosConfig: {
        ascApiKey: {
          keyIdentifier: 'KEY123',
          keyP8: 'p8-content',
        },
      } as any,
      graphqlClient: {} as any,
    });

    const parsed = JSON.parse(json!);
    expect(parsed).toEqual({ key_id: 'KEY123', key: 'p8-content' });
    expect('issuer_id' in parsed).toBe(false);
  });

  it('writes issuer_id for a stored team key', async () => {
    jest.mocked(AppStoreConnectApiKeyQuery.getByIdAsync).mockResolvedValue({
      keyIdentifier: 'KEY123',
      issuerIdentifier: 'ISSUER456',
      keyP8: 'p8-content',
    });

    const json = await getAppStoreConnectApiKeyJsonAsync({
      iosConfig: { ascApiKeyId: 'stored-key-id' } as any,
      graphqlClient: {} as any,
    });

    expect(JSON.parse(json!)).toEqual({
      key_id: 'KEY123',
      issuer_id: 'ISSUER456',
      key: 'p8-content',
    });
  });

  it('omits issuer_id for a stored individual key', async () => {
    jest.mocked(AppStoreConnectApiKeyQuery.getByIdAsync).mockResolvedValue({
      keyIdentifier: 'KEY123',
      issuerIdentifier: undefined,
      keyP8: 'p8-content',
    });

    const json = await getAppStoreConnectApiKeyJsonAsync({
      iosConfig: { ascApiKeyId: 'stored-key-id' } as any,
      graphqlClient: {} as any,
    });

    const parsed = JSON.parse(json!);
    expect(parsed).toEqual({ key_id: 'KEY123', key: 'p8-content' });
    expect('issuer_id' in parsed).toBe(false);
  });

  it('returns null without key input', async () => {
    const json = await getAppStoreConnectApiKeyJsonAsync({
      iosConfig: {} as any,
      graphqlClient: {} as any,
    });

    expect(json).toBeNull();
  });
});

import { CredentialsSource } from '@expo/eas-json';

import { resolveCredentialsSource } from '../credentials';

describe(resolveCredentialsSource, () => {
  test('CredentialsSource.LOCAL', async () => {
    const provider = {} as any;
    const src = resolveCredentialsSource(provider, CredentialsSource.LOCAL);
    expect(src).toBe(CredentialsSource.LOCAL);
  });

  test('CredentialsSource.REMOTE', async () => {
    const provider = {} as any;
    const src = resolveCredentialsSource(provider, CredentialsSource.REMOTE);
    expect(src).toBe(CredentialsSource.REMOTE);
  });

  test('CredentialsSource.AUTO', async () => {
    const provider = {} as any;
    const src = resolveCredentialsSource(provider, CredentialsSource.AUTO);
    expect(src).toBe(CredentialsSource.REMOTE);
  });
});

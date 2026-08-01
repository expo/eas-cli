import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { SupabaseMutation } from '../SupabaseMutation';

function makeMutationClient(data: unknown): ExpoGraphqlClient {
  return {
    mutation: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data }),
    }),
  } as unknown as ExpoGraphqlClient;
}

describe('SupabaseMutation', () => {
  it('beginSupabaseOAuthAsync returns oauth start data', async () => {
    const oauth = { state: 'state-1', url: 'https://supabase.example/oauth' };
    const client = makeMutationClient({
      supabaseConnection: { beginSupabaseOAuth: oauth },
    });

    await expect(
      SupabaseMutation.beginSupabaseOAuthAsync(client, { accountId: 'acct-1' })
    ).resolves.toEqual(oauth);
  });

  it('setSupabaseConnectionOrganizationAsync returns connection', async () => {
    const connection = {
      id: 'conn-1',
      supabaseOrganizationSlug: 'org',
      supabaseOrganizationName: 'Org',
    };
    const client = makeMutationClient({
      supabaseConnection: { setSupabaseConnectionOrganization: connection },
    });

    await expect(
      SupabaseMutation.setSupabaseConnectionOrganizationAsync(client, {
        supabaseConnectionId: 'conn-1',
        organizationSlug: 'org',
      })
    ).resolves.toEqual(connection);
  });

  it('disconnectSupabaseAsync returns id', async () => {
    const client = makeMutationClient({
      supabaseConnection: { disconnectSupabase: 'conn-1' },
    });

    await expect(SupabaseMutation.disconnectSupabaseAsync(client, 'conn-1')).resolves.toBe(
      'conn-1'
    );
  });

  it('provisionSupabaseProjectAsync returns receipt', async () => {
    const receipt = { id: 'receipt-1' };
    const client = makeMutationClient({
      supabaseProject: { provisionSupabaseProject: receipt },
    });

    await expect(
      SupabaseMutation.provisionSupabaseProjectAsync(client, {
        appId: 'app-1',
        region: 'americas',
      })
    ).resolves.toEqual(receipt);
  });

  it('provisionAdditionalSupabaseProjectAsync returns receipt', async () => {
    const receipt = { id: 'receipt-2' };
    const client = makeMutationClient({
      supabaseProject: { provisionAdditionalSupabaseProject: receipt },
    });

    await expect(
      SupabaseMutation.provisionAdditionalSupabaseProjectAsync(client, {
        appId: 'app-1',
        region: 'americas',
        projectNameSuffix: 'preview',
      })
    ).resolves.toEqual(receipt);
    expect(client.mutation).toHaveBeenCalledWith(
      expect.anything(),
      { input: { appId: 'app-1', region: 'americas', projectNameSuffix: 'preview' } },
      expect.anything()
    );
  });

  it('linkSupabaseProjectAsync returns project', async () => {
    const project = { id: 'project-1', supabaseProjectRef: 'ref' };
    const client = makeMutationClient({
      supabaseProject: { linkSupabaseProject: project },
    });

    await expect(
      SupabaseMutation.linkSupabaseProjectAsync(client, {
        appId: 'app-1',
        supabaseProjectRef: 'ref',
      })
    ).resolves.toEqual(project);
    expect(client.mutation).toHaveBeenCalledWith(
      expect.anything(),
      { input: { appId: 'app-1', supabaseProjectRef: 'ref' } },
      expect.anything()
    );
  });

  it('deleteSupabaseProjectAsync returns id', async () => {
    const client = makeMutationClient({
      supabaseProject: { deleteSupabaseProject: 'project-1' },
    });

    await expect(SupabaseMutation.deleteSupabaseProjectAsync(client, 'project-1')).resolves.toBe(
      'project-1'
    );
  });

  it('listSupabaseOrganizationsAsync returns organizations', async () => {
    const organizations = [{ id: '1', slug: 'org', name: 'Org' }];
    const client = makeMutationClient({
      supabaseConnection: { listSupabaseOrganizations: organizations },
    });

    await expect(
      SupabaseMutation.listSupabaseOrganizationsAsync(client, 'acct-1')
    ).resolves.toEqual(organizations);
  });

  it('fetchSupabasePublishableKeyAsync returns key or null', async () => {
    const withKey = makeMutationClient({
      supabaseProject: { fetchSupabasePublishableKey: 'pk_test' },
    });
    await expect(SupabaseMutation.fetchSupabasePublishableKeyAsync(withKey, 'app-1')).resolves.toBe(
      'pk_test'
    );

    const withoutKey = makeMutationClient({
      supabaseProject: { fetchSupabasePublishableKey: null },
    });
    await expect(
      SupabaseMutation.fetchSupabasePublishableKeyAsync(withoutKey, 'app-1')
    ).resolves.toBeNull();
  });
});

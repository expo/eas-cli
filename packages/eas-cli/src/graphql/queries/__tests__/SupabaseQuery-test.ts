import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { SupabaseQuery } from '../SupabaseQuery';

function makeQueryClient(data: unknown): ExpoGraphqlClient {
  return {
    query: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data }),
    }),
  } as unknown as ExpoGraphqlClient;
}

describe('SupabaseQuery', () => {
  const connection = {
    id: 'conn-1',
    supabaseOrganizationSlug: 'org',
    supabaseOrganizationName: 'Org',
  };
  const project = {
    id: 'project-1',
    supabaseProjectRef: 'abcdefghijklmnop',
    supabaseProjectName: 'Demo',
    supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
    supabaseRegion: 'us-east-1',
  };

  it('getSupabaseConnectionByAccountIdAsync returns connection', async () => {
    const client = makeQueryClient({
      account: { byId: { id: 'acct-1', supabaseConnection: connection } },
    });

    await expect(
      SupabaseQuery.getSupabaseConnectionByAccountIdAsync(client, 'acct-1')
    ).resolves.toEqual(connection);
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 'acct-1' },
      expect.objectContaining({ requestPolicy: 'cache-first' })
    );
  });

  it('getSupabaseConnectionByAccountIdAsync returns null when missing', async () => {
    const client = makeQueryClient({
      account: { byId: { id: 'acct-1' } },
    });

    await expect(
      SupabaseQuery.getSupabaseConnectionByAccountIdAsync(client, 'acct-1')
    ).resolves.toBeNull();
  });

  it('getSupabaseConnectionByAccountIdAsync uses network-only when useCache is false', async () => {
    const client = makeQueryClient({
      account: { byId: { id: 'acct-1', supabaseConnection: connection } },
    });

    await SupabaseQuery.getSupabaseConnectionByAccountIdAsync(client, 'acct-1', {
      useCache: false,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 'acct-1' },
      expect.objectContaining({ requestPolicy: 'network-only' })
    );
  });

  it('getSupabaseProjectByAppIdAsync returns project', async () => {
    const client = makeQueryClient({
      app: { byId: { id: 'app-1', supabaseProject: project } },
    });

    await expect(SupabaseQuery.getSupabaseProjectByAppIdAsync(client, 'app-1')).resolves.toEqual(
      project
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      { appId: 'app-1' },
      expect.objectContaining({ requestPolicy: 'cache-first' })
    );
  });

  it('getSupabaseProjectByAppIdAsync returns null when missing', async () => {
    const client = makeQueryClient({
      app: { byId: { id: 'app-1', supabaseProject: null } },
    });

    await expect(SupabaseQuery.getSupabaseProjectByAppIdAsync(client, 'app-1')).resolves.toBeNull();
  });

  it('getSupabaseProjectByAppIdAsync uses network-only when useCache is false', async () => {
    const client = makeQueryClient({
      app: { byId: { id: 'app-1', supabaseProject: project } },
    });

    await SupabaseQuery.getSupabaseProjectByAppIdAsync(client, 'app-1', { useCache: false });
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      { appId: 'app-1' },
      expect.objectContaining({ requestPolicy: 'network-only' })
    );
  });

  it('getSupabaseAdvisorLintsByAppIdAsync splits the project from the aliased advisor lists', async () => {
    const lint = {
      name: 'rls_disabled_in_public',
      title: 'RLS Disabled in Public',
      level: 'ERROR',
      description: 'Detects tables without RLS.',
      detail: 'Table `public.todos` is public, but RLS has not been enabled.',
      entity: 'public.todos',
      remediation: null,
      cacheKey: 'rls_disabled_in_public_public_todos',
    };
    const client = makeQueryClient({
      app: { byId: { id: 'app-1', supabaseProject: { ...project, security: [lint] } } },
    });

    await expect(
      SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync(client, 'app-1')
    ).resolves.toEqual({ project, security: [lint], performance: null });
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      { appId: 'app-1' },
      expect.objectContaining({ requestPolicy: 'network-only' })
    );
  });

  it('getSupabaseAdvisorLintsByAppIdAsync returns null when no project is linked', async () => {
    const client = makeQueryClient({ app: { byId: { id: 'app-1', supabaseProject: null } } });

    await expect(
      SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync(client, 'app-1')
    ).resolves.toBeNull();
  });
});

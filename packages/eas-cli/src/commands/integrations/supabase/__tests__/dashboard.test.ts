import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { SupabaseQuery } from '../../../../graphql/queries/SupabaseQuery';
import { SupabaseProjectData } from '../../../../graphql/types/SupabaseConnection';
import Log from '../../../../log';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsSupabaseDashboard from '../dashboard';

jest.mock('better-opn');
jest.mock('../../../../graphql/queries/SupabaseQuery');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

describe(IntegrationsSupabaseDashboard, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  const mockProject: SupabaseProjectData = {
    id: 'project-1',
    supabaseProjectRef: 'abcdefghijklmnop',
    supabaseProjectName: 'Test App',
    supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
    supabaseRegion: 'us-east-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  function createCommand(argv: string[]): IntegrationsSupabaseDashboard {
    const command = new IntegrationsSupabaseDashboard(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { slug: 'testapp' },
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
  });

  it('opens the Supabase project dashboard', async () => {
    await createCommand([]).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://supabase.com/dashboard/project/abcdefghijklmnop'
    );
  });

  it('prints the dashboard URL as JSON', async () => {
    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      dashboardUrl: 'https://supabase.com/dashboard/project/abcdefghijklmnop',
    });
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('warns when no project is linked', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No Supabase project'));
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('emits a null dashboardUrl as JSON when no project is linked', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ dashboardUrl: null });
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('prints the dashboard URL in non-interactive mode', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith('https://supabase.com/dashboard/project/abcdefghijklmnop');
  });

  it('fails the spinner when the browser cannot be opened', async () => {
    jest.mocked(openBrowserAsync).mockResolvedValue(false as never);
    const { ora } = jest.requireMock('../../../../ora') as { ora: jest.Mock };
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    ora.mockReturnValue(spinner);

    await createCommand([]).runAsync();

    expect(spinner.fail).toHaveBeenCalledWith(
      expect.stringContaining('Unable to open a web browser')
    );
  });

  it('fails the spinner and rethrows when opening the browser throws', async () => {
    jest.mocked(openBrowserAsync).mockRejectedValue(new Error('no browser'));
    const { ora } = jest.requireMock('../../../../ora') as { ora: jest.Mock };
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    ora.mockReturnValue(spinner);

    await expect(createCommand([]).runAsync()).rejects.toThrow('no browser');
    expect(spinner.fail).toHaveBeenCalled();
  });
});

import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { loadProjectScopedEnvVarsAsync } from '../../../../environments/variables';
import Log from '../../../../log';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsSurrealdbDashboard from '../dashboard';

jest.mock('better-opn');
jest.mock('../../../../environments/variables');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

const SURREALIST_URL = 'https://app.surrealdb.com';

describe(IntegrationsSurrealdbDashboard, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(argv: string[]): IntegrationsSurrealdbDashboard {
    const command = new IntegrationsSurrealdbDashboard(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: { projectId: testProjectId, exp: { slug: 'testapp' } },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([
      { id: '1', value: 'wss://prod.example.com', environments: ['production'] },
      { id: '2', value: 'wss://preview.example.com', environments: ['preview', 'development'] },
    ] as never);
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
  });

  it('lists the endpoints and opens Surrealist', async () => {
    await createCommand([]).runAsync();

    expect(loadProjectScopedEnvVarsAsync).toHaveBeenCalledWith(
      graphqlClient,
      testProjectId,
      'EXPO_PUBLIC_SURREAL_ENDPOINT'
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('wss://prod.example.com'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('wss://preview.example.com'));
    expect(openBrowserAsync).toHaveBeenCalledWith(SURREALIST_URL);
  });

  it('prints the URL and endpoints as JSON', async () => {
    await createCommand(['--json']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      dashboardUrl: SURREALIST_URL,
      endpoints: [
        { endpoint: 'wss://prod.example.com', environments: ['production'] },
        { endpoint: 'wss://preview.example.com', environments: ['preview', 'development'] },
      ],
    });
  });

  it('prints the URL instead of opening a browser in non-interactive mode', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(SURREALIST_URL);
  });

  it('warns when no SurrealDB instance is connected', async () => {
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([]);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No SurrealDB instance'));
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('emits a null dashboardUrl as JSON when nothing is connected', async () => {
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([]);

    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ dashboardUrl: null, endpoints: [] });
  });

  it('fails the spinner when the browser cannot be opened', async () => {
    jest.mocked(openBrowserAsync).mockResolvedValue(false as never);
    const { ora } = jest.requireMock('../../../../ora');
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
});

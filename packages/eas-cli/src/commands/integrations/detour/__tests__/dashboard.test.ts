import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import Log from '../../../../log';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsDetourDashboard from '../dashboard';

jest.mock('better-opn');
jest.mock('../../../../utils/json');
// `link` is kept real: the assertions below are about the URL it wraps.
jest.mock('../../../../log', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn() },
  link: (url: string) => url,
}));

const appId = 'a5f2c1d0-0000-4000-8000-000000000001';
// Built from the same base the command uses, so a developer with
// EXPO_DETOUR_API_URL exported does not see a false failure.
const dashboardUrl = new URL(
  `/applications/${appId}`,
  process.env.EXPO_DETOUR_API_URL ?? 'https://godetour.dev'
).toString();

describe(IntegrationsDetourDashboard, () => {
  const mockConfig = getMockOclifConfig();

  function createCommand(
    argv: string[] = [],
    extra: Record<string, unknown> = { detour: { appId, linkHost: 'acme.godetour.link' } }
  ): IntegrationsDetourDashboard {
    const command = new IntegrationsDetourDashboard(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: { projectId: testProjectId, exp: { slug: 'testapp', extra } },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(openBrowserAsync).mockResolvedValue({} as never);
  });

  // The CLI does not know the organization; the root domain resolves it.
  it('opens the root-domain URL built from the app id alone', async () => {
    await createCommand().runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(dashboardUrl);
  });

  it('prints the URL instead of opening a browser with --json', async () => {
    await createCommand(['--json']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ appId, url: dashboardUrl });
  });

  it('still prints the URL when no browser can be opened', async () => {
    jest.mocked(openBrowserAsync).mockResolvedValue(false);

    await createCommand().runAsync();

    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining(appId));
  });

  it('prints the URL instead of opening a browser in non-interactive mode', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(dashboardUrl);
  });

  it('points an unconnected project at connect', async () => {
    await expect(createCommand([], {}).runAsync()).rejects.toThrow(
      'This project is not connected to Detour'
    );

    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('works for a connection made before the link host was recorded', async () => {
    await createCommand([], { detour: { appId } }).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(dashboardUrl);
  });
});

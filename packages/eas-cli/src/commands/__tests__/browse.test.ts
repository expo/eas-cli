import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../credentials/__tests__/fixtures-constants';
import { AccountFragment } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import Browse from '../browse';

jest.mock('better-opn');
jest.mock('../../log');
jest.mock('../../project/projectUtils');
jest.mock('../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

describe(Browse, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(argv: string[]): Browse {
    const command = new Browse(argv, mockConfig);
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
    jest.resetAllMocks();
    jest
      .mocked(getOwnerAccountForProjectIdAsync)
      .mockResolvedValue({ name: 'testuser' } as AccountFragment);
    jest.mocked(openBrowserAsync).mockResolvedValue({} as never);
    jest.mocked(ora).mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    } as any);
  });

  it('opens the project dashboard when no page is provided', async () => {
    await createCommand([]).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://expo.dev/accounts/testuser/projects/testapp'
    );
  });

  it('opens a subpage by its EAS command name', async () => {
    await createCommand(['build']).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://expo.dev/accounts/testuser/projects/testapp/builds'
    );
  });

  it('maps the website wording to the same subpage', async () => {
    await createCommand(['submissions']).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://expo.dev/accounts/testuser/projects/testapp/submissions'
    );
  });

  it('opens the observe page', async () => {
    await createCommand(['observe']).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://expo.dev/accounts/testuser/projects/testapp/observe'
    );
  });

  it('prints the URL without opening a browser when --no-browser is passed', async () => {
    await createCommand(['hosting', '--no-browser']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(
      'https://expo.dev/accounts/testuser/projects/testapp/hosting'
    );
  });

  it('rejects an unknown page', async () => {
    await expect(createCommand(['nope']).runAsync()).rejects.toThrow();
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('fails the spinner when the browser cannot be opened', async () => {
    jest.mocked(openBrowserAsync).mockResolvedValue(false);
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    jest.mocked(ora).mockReturnValue(spinner as any);

    await createCommand([]).runAsync();

    expect(spinner.fail).toHaveBeenCalledWith(
      expect.stringContaining('Unable to open a web browser')
    );
  });
});

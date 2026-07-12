import open from 'open';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { BillingClient } from '../../../billing/billingClient';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { ora } from '../../../ora';
import { printJsonOnlyOutput } from '../../../utils/json';
import BillingManage from '../manage';

jest.mock('open');
jest.mock('../../../billing/billingClient');
jest.mock('../../../log');
jest.mock('../../../utils/json');
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

describe(BillingManage, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const account = { id: 'account-id', name: 'testaccount' };

  const createCustomerPortalSessionAsync = jest.fn();

  function createCommand(argv: string[]): BillingManage {
    const command = new BillingManage(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockResolvedValue({
      loggedIn: {
        graphqlClient,
        actor: { accounts: [account] },
        authenticationInfo: { accessToken: 'token', sessionSecret: null },
      },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(ora).mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    } as any);
    jest
      .mocked(BillingClient)
      .mockImplementation(() => ({ createCustomerPortalSessionAsync }) as unknown as BillingClient);
  });

  it('creates a customer portal session and prints the URL as JSON', async () => {
    createCustomerPortalSessionAsync.mockResolvedValue({
      url: 'https://billing.stripe.com/session/abc',
    });

    await createCommand(['--json']).runAsync();

    expect(createCustomerPortalSessionAsync).toHaveBeenCalledWith('account-id');
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      customerPortalUrl: 'https://billing.stripe.com/session/abc',
    });
  });

  it('opens the customer portal in a browser when interactive, without re-encoding the URL', async () => {
    const url = 'https://billing.stripe.com/session/abc%2Fdef';
    createCustomerPortalSessionAsync.mockResolvedValue({ url });
    jest.mocked(open).mockResolvedValue({} as never);

    await createCommand([]).runAsync();

    expect(open).toHaveBeenCalledWith(url);
  });
});

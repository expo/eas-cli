import open from 'open';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { BillingClient } from '../../../billing/billingClient';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { Role } from '../../../graphql/generated';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import { ora } from '../../../ora';
import { selectAsync } from '../../../prompts';
import { printJsonOnlyOutput } from '../../../utils/json';
import BillingManage from '../manage';

jest.mock('open');
jest.mock('../../../billing/billingClient');
jest.mock('../../../graphql/queries/AccountQuery');
jest.mock('../../../log');
jest.mock('../../../prompts');
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
  const account = {
    id: 'account-id',
    name: 'testaccount',
    users: [{ actor: { id: 'actor-id' }, role: Role.Admin }],
  };

  const createCustomerPortalSessionAsync = jest.fn();

  function createCommand(argv: string[], accounts = [account]): BillingManage {
    const command = new BillingManage(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockResolvedValue({
      loggedIn: {
        graphqlClient,
        actor: { id: 'actor-id', accounts },
        authenticationInfo: { accessToken: 'token', sessionSecret: null },
      },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue({
      id: 'sub_1',
      name: 'Starter',
      planId: 'price_paid',
      status: 'active',
      willCancel: false,
    });
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

  it('only shows accounts with active paid plans', async () => {
    const freeAccount = {
      id: 'free-account-id',
      name: 'free-account',
      users: [{ actor: { id: 'actor-id' }, role: Role.Admin }],
    };
    const productionAccount = {
      id: 'production-account-id',
      name: 'production-account',
      users: [{ actor: { id: 'actor-id' }, role: Role.Admin }],
    };
    jest
      .mocked(AccountQuery.getSubscriptionAsync)
      .mockImplementation(async (_client, accountId) => {
        if (accountId === freeAccount.id) {
          return null;
        }
        return {
          id: `subscription-${accountId}`,
          name: accountId === productionAccount.id ? 'Production' : 'Starter',
          planId: `price-${accountId}`,
          status: 'active',
          willCancel: false,
        };
      });
    jest.mocked(selectAsync).mockImplementation(async (_message, choices) => choices[1].value);
    createCustomerPortalSessionAsync.mockResolvedValue({
      url: 'https://billing.stripe.com/session',
    });

    await createCommand([], [account, freeAccount, productionAccount]).runAsync();

    expect(selectAsync).toHaveBeenCalledWith(
      'Select an account:',
      [
        {
          title: 'testaccount',
          value: {
            id: 'account-id',
            name: 'testaccount',
            subscription: {
              id: 'subscription-account-id',
              name: 'Starter',
              planId: 'price-account-id',
              status: 'active',
              willCancel: false,
            },
          },
          description: 'Current plan: Starter',
        },
        {
          title: 'production-account',
          value: {
            id: 'production-account-id',
            name: 'production-account',
            subscription: {
              id: 'subscription-production-account-id',
              name: 'Production',
              planId: 'price-production-account-id',
              status: 'active',
              willCancel: false,
            },
          },
          description: 'Current plan: Production',
        },
      ],
      expect.any(Object)
    );
    expect(createCustomerPortalSessionAsync).toHaveBeenCalledWith('production-account-id');
  });

  it('rejects an account without an active paid plan', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);

    await expect(createCommand(['--account', 'testaccount']).runAsync()).rejects.toThrow(
      'Account "testaccount" does not have an active paid plan. Run eas billing:subscribe to subscribe.'
    );

    expect(createCustomerPortalSessionAsync).not.toHaveBeenCalled();
  });
});

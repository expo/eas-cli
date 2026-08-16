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
jest.mock('../../../ora');

function billingAccount(
  id: string,
  name: string
): { id: string; name: string; viewerUserPermission: { role: Role } } {
  return { id, name, viewerUserPermission: { role: Role.Admin } };
}

const STARTER_SUBSCRIPTION = { id: 'sub_1', name: 'Starter', planId: 'price_paid' };

describe(BillingManage, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const account = billingAccount('account-id', 'testaccount');

  const createCustomerPortalSessionAsync = jest.fn();

  function createCommand(
    argv: string[],
    accounts: ReturnType<typeof billingAccount>[] = [account]
  ): BillingManage {
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
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(STARTER_SUBSCRIPTION);
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

  it('prints the customer portal URL without opening a browser with --no-open', async () => {
    createCustomerPortalSessionAsync.mockResolvedValue({
      url: 'https://billing.stripe.com/session/abc',
    });

    await createCommand(['--no-open']).runAsync();

    expect(open).not.toHaveBeenCalled();
  });

  it('only shows accounts with active paid plans', async () => {
    const freeAccount = billingAccount('free-account-id', 'free-account');
    const productionAccount = billingAccount('production-account-id', 'production-account');
    jest.mocked(AccountQuery.getSubscriptionAsync).mockImplementation(async (_client, accountId) =>
      accountId === freeAccount.id
        ? null
        : {
            id: `subscription-${accountId}`,
            name: accountId === productionAccount.id ? 'Production' : 'Starter',
            planId: `price-${accountId}`,
          }
    );
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
            },
          },
          description: 'Current plan: Starter',
          disabled: false,
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
            },
          },
          description: 'Current plan: Production',
          disabled: false,
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

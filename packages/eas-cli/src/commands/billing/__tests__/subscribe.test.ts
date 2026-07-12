import open from 'open';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { BillingClient } from '../../../billing/billingClient';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { printJsonOnlyOutput } from '../../../utils/json';
import BillingSubscribe from '../subscribe';

jest.mock('open');
jest.mock('../../../billing/billingClient');
jest.mock('../../../graphql/queries/AccountQuery');
jest.mock('../../../log');
jest.mock('../../../utils/json');
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

describe(BillingSubscribe, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const account = { id: 'account-id', name: 'testaccount' };

  const createCheckoutSessionAsync = jest.fn();

  function createCommand(argv: string[]): BillingSubscribe {
    const command = new BillingSubscribe(argv, mockConfig);
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
      .mockImplementation(() => ({ createCheckoutSessionAsync }) as unknown as BillingClient);
  });

  it('creates a checkout session for a plan and prints the URL as JSON', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/c/pay/cs_123',
    });

    await createCommand(['starter', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', ['STARTER']);
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_123',
      alreadySubscribed: false,
      currentPlan: null,
    });
  });

  it('maps each plan slug to its server PlanType', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(['production-plus', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', ['PRODUCTION_PLUS']);
  });

  it('does not create a checkout session when the account already has a paid subscription', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue({
      id: 'sub_1',
      name: 'Starter',
      planId: 'price_1RZD7tEnlKOkR6exdebL1Fhi',
      status: 'active',
      willCancel: false,
    });

    await createCommand(['agent', '--json']).runAsync();

    expect(createCheckoutSessionAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      checkoutUrl: null,
      alreadySubscribed: true,
      currentPlan: 'Starter',
    });
  });

  it('treats the free plan as not subscribed', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue({
      id: 'sub_free',
      name: 'Free',
      planId: 'price_free',
      status: 'active',
      willCancel: false,
    });
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(['starter', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', ['STARTER']);
  });

  it('prints the checkout URL without opening a browser in non-interactive mode', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({
      id: 'cs',
      url: 'https://checkout.stripe.com/pay',
    });
    await createCommand(['starter', '--non-interactive']).runAsync();

    expect(open).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      checkoutUrl: 'https://checkout.stripe.com/pay',
      alreadySubscribed: false,
      currentPlan: null,
    });
  });

  it('throws when the checkout session has no URL', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: null });

    await expect(createCommand(['starter', '--json']).runAsync()).rejects.toThrow(
      'The checkout session did not include a URL.'
    );
    expect(Log.log).not.toHaveBeenCalled();
  });
});

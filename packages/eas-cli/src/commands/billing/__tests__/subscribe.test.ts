import open from 'open';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { BillingClient } from '../../../billing/billingClient';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { Role } from '../../../graphql/generated';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { selectAsync } from '../../../prompts';
import { printJsonOnlyOutput } from '../../../utils/json';
import BillingSubscribe from '../subscribe';

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

describe(BillingSubscribe, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const account = {
    id: 'account-id',
    name: 'testaccount',
    users: [{ actor: { id: 'actor-id' }, role: Role.Admin }],
  };

  const createCheckoutSessionAsync = jest.fn();

  function createCommand(
    argv: string[],
    accounts: {
      id: string;
      name: string;
      users: { actor: { id: string }; role: Role }[];
    }[] = [account]
  ): BillingSubscribe {
    const command = new BillingSubscribe(argv, mockConfig);
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

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'STARTER');
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_123',
      alreadySubscribed: false,
      currentPlan: null,
    });
  });

  it('maps each plan slug to its server PlanType', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(['production', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'PRODUCTION');
  });

  it('prompts for a plan when one is not provided', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    jest.mocked(selectAsync).mockResolvedValue('production');
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand([]).runAsync();

    expect(selectAsync).toHaveBeenCalledWith('Select a plan:', [
      { title: 'Starter', value: 'starter' },
      { title: 'Production', value: 'production' },
    ]);
    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'PRODUCTION');
  });

  it('requires a plan in non-interactive mode', async () => {
    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      'The plan argument is required in non-interactive mode.'
    );

    expect(selectAsync).not.toHaveBeenCalled();
  });

  it('shows current plans and disables subscribed accounts in the account prompt', async () => {
    const subscribedAccount = {
      id: 'subscribed-id',
      name: 'subscribed',
      users: [{ actor: { id: 'actor-id' }, role: Role.Admin }],
    };
    const freeAccount = {
      id: 'free-id',
      name: 'free',
      users: [{ actor: { id: 'actor-id' }, role: Role.Admin }],
    };
    jest
      .mocked(AccountQuery.getSubscriptionAsync)
      .mockImplementation(async (_client, accountId) => {
        return accountId === subscribedAccount.id
          ? {
              id: 'sub_1',
              name: 'Starter',
              planId: 'price_paid',
              status: 'active',
              willCancel: false,
            }
          : null;
      });
    jest.mocked(selectAsync).mockImplementation(async (_message, choices) => choices[1].value);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(['starter'], [subscribedAccount, freeAccount]).runAsync();

    expect(selectAsync).toHaveBeenCalledWith(
      'Select an account:',
      [
        {
          title: 'subscribed',
          value: {
            id: 'subscribed-id',
            name: 'subscribed',
            subscription: {
              id: 'sub_1',
              name: 'Starter',
              planId: 'price_paid',
              status: 'active',
              willCancel: false,
            },
          },
          description: 'Current plan: Starter',
          disabled: true,
        },
        {
          title: 'free',
          value: { id: 'free-id', name: 'free', subscription: null },
          description: 'Current plan: Free',
          disabled: false,
        },
      ],
      {
        initial: { id: 'free-id', name: 'free', subscription: null },
        warningMessageForDisabledEntries:
          'This account already has a paid plan. Run eas billing:manage to change it.',
      }
    );
    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('free-id', 'STARTER');
  });

  it('does not create a checkout session when the account already has a paid subscription', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue({
      id: 'sub_1',
      name: 'Starter',
      planId: 'price_1RZD7tEnlKOkR6exdebL1Fhi',
      status: 'active',
      willCancel: false,
    });

    await createCommand(['production', '--json']).runAsync();

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

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'STARTER');
  });

  it('prints the checkout URL as text without opening a browser in non-interactive mode', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({
      id: 'cs',
      url: 'https://checkout.stripe.com/pay',
    });
    await createCommand(['starter', '--non-interactive']).runAsync();

    expect(open).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledWith('https://checkout.stripe.com/pay');
  });

  it('returns structured JSON with the checkout URL and does not open a browser', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
    createCheckoutSessionAsync.mockResolvedValue({
      id: 'cs',
      url: 'https://checkout.stripe.com/pay',
    });
    await createCommand(['starter', '--json']).runAsync();

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

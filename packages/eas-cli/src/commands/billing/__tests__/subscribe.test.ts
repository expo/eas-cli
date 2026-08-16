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
jest.mock('../../../ora');

function billingAccount(
  id: string,
  name: string
): { id: string; name: string; users: { actor: { id: string }; role: Role }[] } {
  return { id, name, users: [{ actor: { id: 'actor-id' }, role: Role.Admin }] };
}

const STARTER_SUBSCRIPTION = { id: 'sub_1', name: 'Starter', planId: 'price_paid' };
const FREE_SUBSCRIPTION = { id: 'sub_free', name: 'Free', planId: 'price_free' };

describe(BillingSubscribe, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const account = billingAccount('account-id', 'testaccount');

  const createCheckoutSessionAsync = jest.fn();

  function createCommand(
    argv: string[],
    accounts: ReturnType<typeof billingAccount>[] = [account]
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
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
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
    createCheckoutSessionAsync.mockResolvedValue({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/c/pay/cs_123',
    });

    await createCommand(['starter', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'STARTER');
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_123',
      alreadySubscribed: false,
    });
  });

  it('maps each plan slug to its server PlanType', async () => {
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(['production', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'PRODUCTION');
  });

  it('prompts for a plan when one is not provided', async () => {
    jest.mocked(selectAsync).mockResolvedValue('production');
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand([]).runAsync();

    expect(selectAsync).toHaveBeenCalledWith('Select a plan:', [
      { title: 'Starter', value: 'starter' },
      { title: 'Production', value: 'production' },
    ]);
    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'PRODUCTION');
    expect(jest.mocked(AccountQuery.getSubscriptionAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(selectAsync).mock.invocationCallOrder[0]
    );
  });

  it('prompts for an account before prompting for a plan', async () => {
    jest
      .mocked(selectAsync)
      .mockImplementationOnce(async (_message, choices) => choices[0].value)
      .mockResolvedValueOnce('production');
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(
      [],
      [account, billingAccount('second-account-id', 'second-account')]
    ).runAsync();

    expect(jest.mocked(selectAsync).mock.calls.map(([message]) => message)).toEqual([
      'Select an account:',
      'Select a plan:',
    ]);
  });

  it('requires a plan in non-interactive mode', async () => {
    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      'The plan argument is required in non-interactive mode.'
    );

    expect(selectAsync).not.toHaveBeenCalled();
  });

  it('shows current plans and disables subscribed accounts in the account prompt', async () => {
    const subscribedAccount = billingAccount('subscribed-id', 'subscribed');
    const freeAccount = billingAccount('free-id', 'free');
    const secondFreeAccount = billingAccount('second-free-id', 'second-free');
    jest
      .mocked(AccountQuery.getSubscriptionAsync)
      .mockImplementation(async (_client, accountId) =>
        accountId === subscribedAccount.id ? STARTER_SUBSCRIPTION : null
      );
    jest.mocked(selectAsync).mockImplementation(async (_message, choices) => choices[0].value);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(
      ['starter'],
      [subscribedAccount, freeAccount, secondFreeAccount]
    ).runAsync();

    expect(selectAsync).toHaveBeenCalledWith(
      'Select an account:',
      [
        {
          title: 'free',
          value: { id: 'free-id', name: 'free', subscription: null },
          description: 'Current plan: Free',
          disabled: false,
        },
        {
          title: 'second-free',
          value: { id: 'second-free-id', name: 'second-free', subscription: null },
          description: 'Current plan: Free',
          disabled: false,
        },
        {
          title: 'subscribed',
          value: {
            id: 'subscribed-id',
            name: 'subscribed',
            subscription: STARTER_SUBSCRIPTION,
          },
          description: 'Current plan: Starter',
          disabled: true,
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

  it.each([
    ['an explicitly selected account is', ['production', '--account', 'testaccount', '--json']],
    ['the only account is', ['production', '--json']],
  ])('returns the current plan when %s already subscribed', async (_case, argv) => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(STARTER_SUBSCRIPTION);

    await createCommand(argv).runAsync();

    expect(createCheckoutSessionAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      alreadySubscribed: true,
      currentPlan: 'Starter',
    });
  });

  it('reports an explicitly selected subscribed account before prompting for a plan', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(STARTER_SUBSCRIPTION);

    await createCommand(['--account', 'testaccount']).runAsync();

    expect(selectAsync).not.toHaveBeenCalled();
    expect(createCheckoutSessionAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      'Account testaccount is already subscribed to the Starter plan.'
    );
    expect(Log.log).toHaveBeenCalledWith('To change or cancel your plan, run eas billing:manage.');
  });

  it('treats the free plan as not subscribed', async () => {
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(FREE_SUBSCRIPTION);
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

    await createCommand(['starter', '--json']).runAsync();

    expect(createCheckoutSessionAsync).toHaveBeenCalledWith('account-id', 'STARTER');
  });

  it.each([['--non-interactive'], ['--no-open']])(
    'prints the checkout URL without opening a browser with %s',
    async flag => {
      createCheckoutSessionAsync.mockResolvedValue({
        id: 'cs',
        url: 'https://checkout.stripe.com/pay',
      });

      await createCommand(['starter', flag]).runAsync();

      expect(open).not.toHaveBeenCalled();
      expect(printJsonOnlyOutput).not.toHaveBeenCalled();
      expect(link).toHaveBeenCalledWith('https://checkout.stripe.com/pay');
    }
  );

  it('returns structured JSON with the checkout URL and does not open a browser', async () => {
    createCheckoutSessionAsync.mockResolvedValue({
      id: 'cs',
      url: 'https://checkout.stripe.com/pay',
    });

    await createCommand(['starter', '--json']).runAsync();

    expect(open).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      checkoutUrl: 'https://checkout.stripe.com/pay',
      alreadySubscribed: false,
    });
  });

  it.each([
    ['checkout', null],
    ['already subscribed', STARTER_SUBSCRIPTION],
  ])(
    'does not emit null JSON values, which printJsonOnlyOutput strips (%s)',
    async (_case, subscription) => {
      jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(subscription);
      createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: 'https://checkout' });

      await createCommand(['starter', '--json']).runAsync();

      const [payload] = jest.mocked(printJsonOnlyOutput).mock.calls[0];
      expect(Object.values(payload)).not.toContain(null);
    }
  );

  it('throws when the checkout session has no URL', async () => {
    createCheckoutSessionAsync.mockResolvedValue({ id: 'cs', url: null });

    await expect(createCommand(['starter', '--json']).runAsync()).rejects.toThrow(
      'The checkout session did not include a URL.'
    );
    expect(Log.log).not.toHaveBeenCalled();
  });
});

import { ApiV2Client } from '../../api';
import { BillingClient } from '../billingClient';

jest.mock('../../api');

describe(BillingClient, () => {
  const postAsync = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(ApiV2Client).mockImplementation(() => ({ postAsync }) as unknown as ApiV2Client);
  });

  it('unwraps the apiv2 `data` envelope for a checkout session', async () => {
    postAsync.mockResolvedValue({ data: { id: 'cs_123', url: 'https://checkout.stripe.com/pay' } });

    const client = new BillingClient({ accessToken: 'token', sessionSecret: null });
    const session = await client.createCheckoutSessionAsync('account-id', ['STARTER']);

    expect(session).toEqual({ id: 'cs_123', url: 'https://checkout.stripe.com/pay' });
    expect(postAsync).toHaveBeenCalledWith('stripe-auth/checkout', {
      body: { accountId: 'account-id', planTypes: ['STARTER'] },
    });
  });

  it('unwraps the apiv2 `data` envelope for a customer portal session', async () => {
    postAsync.mockResolvedValue({
      data: { customerPortal: { url: 'https://billing.stripe.com' } },
    });

    const client = new BillingClient({ accessToken: 'token', sessionSecret: null });
    const session = await client.createCustomerPortalSessionAsync('account-id');

    expect(session).toEqual({ url: 'https://billing.stripe.com' });
    expect(postAsync).toHaveBeenCalledWith('stripe-auth/customer-portal', {
      body: { accountId: 'account-id' },
    });
  });
});

import { ApiV2Client } from '../api';

export type CheckoutSession = {
  id: string;
  url: string | null;
};

export type CustomerPortalSession = {
  url: string;
};

/**
 * Wraps the `stripe-auth` apiv2 REST endpoints. These require an account ADMIN actor and
 * work with either a session secret or an access token (`EXPO_TOKEN`).
 */
export class BillingClient {
  private readonly apiV2Client: ApiV2Client;

  constructor(authInfo: { accessToken: string | null; sessionSecret: string | null }) {
    this.apiV2Client = new ApiV2Client(authInfo);
  }

  async createCheckoutSessionAsync(
    accountId: string,
    planTypes: string[]
  ): Promise<CheckoutSession> {
    // apiv2 wraps JSON responses as `{ data: <payload> }`, so unwrap `data` here.
    const { data } = await this.apiV2Client.postAsync('stripe-auth/checkout', {
      body: { accountId, planTypes },
    });
    return data;
  }

  async createCustomerPortalSessionAsync(accountId: string): Promise<CustomerPortalSession> {
    const { data } = await this.apiV2Client.postAsync('stripe-auth/customer-portal', {
      body: { accountId },
    });
    return data.customerPortal;
  }
}

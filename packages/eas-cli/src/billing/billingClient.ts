import { ApiV2Client } from '../api';
import type { CheckoutPlanType } from './plans';

export type CheckoutSession = {
  id: string;
  clientSecret: string | null;
  url: string | null;
};

export type CustomerPortalSession = {
  url: string;
};

export class BillingClient {
  private readonly apiV2Client: ApiV2Client;

  constructor(authInfo: { accessToken: string | null; sessionSecret: string | null }) {
    this.apiV2Client = new ApiV2Client(authInfo);
  }

  async createCheckoutSessionAsync(
    accountId: string,
    planType: CheckoutPlanType
  ): Promise<CheckoutSession> {
    const { data } = await this.apiV2Client.postAsync('stripe-auth/checkout', {
      body: { accountId, planType },
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

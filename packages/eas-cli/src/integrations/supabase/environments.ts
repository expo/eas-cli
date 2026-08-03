import { DefaultEnvironment } from '../../build/utils/environment';

// Production-first, matching the PostHog and Convex integrations.
export const EAS_SUPABASE_ENVIRONMENTS = [
  DefaultEnvironment.Production,
  DefaultEnvironment.Preview,
  DefaultEnvironment.Development,
];

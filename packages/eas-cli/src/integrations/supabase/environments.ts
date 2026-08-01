import { DefaultEnvironment } from '../../build/utils/environment';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { resolveTargetEnvironmentsAsync as resolveTargetEnvironmentsWithDefaultsAsync } from '../../environments/resolve';

export { parseEnvironmentFlag } from '../../environments/resolve';

// Production-first, matching the PostHog and Convex integrations.
export const EAS_SUPABASE_ENVIRONMENTS = [
  DefaultEnvironment.Production,
  DefaultEnvironment.Preview,
  DefaultEnvironment.Development,
];

const SUPABASE_ENVIRONMENTS_LABEL = 'Supabase';

export async function resolveTargetEnvironmentsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  requested: string[],
  nonInteractive: boolean
): Promise<string[]> {
  return await resolveTargetEnvironmentsWithDefaultsAsync(
    graphqlClient,
    projectId,
    requested,
    nonInteractive,
    { defaultEnvironments: EAS_SUPABASE_ENVIRONMENTS, label: SUPABASE_ENVIRONMENTS_LABEL }
  );
}

import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';
import { Actor } from '../../user/User';
import FeatureGateEnvOverrides from '../gating/FeatureGateEnvOverrides';
import FeatureGating from '../gating/FeatureGating';

export default class MaybeLoggedInContextField extends ContextField<{
  actor: Actor | null;
  featureGating: FeatureGating;
  graphqlClient: ExpoGraphqlClient;
}> {
  async getValueAsync({ sessionManager }: ContextOptions): Promise<{
    actor: Actor | null;
    featureGating: FeatureGating;
    graphqlClient: ExpoGraphqlClient;
  }> {
    const authenticationInfo = {
      accessToken: sessionManager.getAccessToken(),
      sessionSecret: sessionManager.getSessionSecret(),
    };

    const graphqlClient = createGraphqlClient(authenticationInfo);
    const actor = await sessionManager.getUserAsync();
    const featureGateServerValues: { [key: string]: boolean } = actor?.featureGates ?? {};

    return {
      actor: actor ?? null,
      featureGating: new FeatureGating(featureGateServerValues, new FeatureGateEnvOverrides()),
      graphqlClient,
    };
  }
}

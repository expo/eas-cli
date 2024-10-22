import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';
import { Actor } from '../../user/User';
import FeatureGateEnvOverrides from '../gating/FeatureGateEnvOverrides';
import FeatureGating from '../gating/FeatureGating';

type MaybeLoggedInContextType = {
  actor: Actor | null;
  featureGating: FeatureGating;
  graphqlClient: ExpoGraphqlClient;
  authenticationInfo: {
    accessToken: string | null;
    sessionSecret: string | null;
  };
};

export default class MaybeLoggedInContextField extends ContextField<MaybeLoggedInContextType> {
  async getValueAsync({ sessionManager }: ContextOptions): Promise<MaybeLoggedInContextType> {
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
      authenticationInfo,
    };
  }
}

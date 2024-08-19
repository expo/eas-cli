import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';
import { Actor } from '../../user/User';
import FeatureGateEnvOverrides from '../gating/FeatureGateEnvOverrides';
import FeatureGating from '../gating/FeatureGating';

export default class LoggedInContextField extends ContextField<{
  actor: Actor;
  featureGating: FeatureGating;
  graphqlClient: ExpoGraphqlClient;
}> {
  async getValueAsync({ nonInteractive, sessionManager }: ContextOptions): Promise<{
    actor: Actor;
    featureGating: FeatureGating;
    graphqlClient: ExpoGraphqlClient;
  }> {
    const { actor, authenticationInfo } = await sessionManager.ensureLoggedInAsync({
      nonInteractive,
    });
    const featureGateServerValues: { [key: string]: boolean } = actor?.featureGates ?? {};

    const graphqlClient = createGraphqlClient(authenticationInfo);

    return {
      actor,
      featureGating: new FeatureGating(featureGateServerValues, new FeatureGateEnvOverrides()),
      graphqlClient,
    };
  }
}

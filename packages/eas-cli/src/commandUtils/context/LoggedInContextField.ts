import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';
import { LoggedInAuthenticationInfo } from '../../user/SessionManager';
import { Actor } from '../../user/User';
import FeatureGateEnvOverrides from '../gating/FeatureGateEnvOverrides';
import FeatureGating from '../gating/FeatureGating';

type LoggedInContextType = {
  actor: Actor;
  featureGating: FeatureGating;
  graphqlClient: ExpoGraphqlClient;
  authenticationInfo: LoggedInAuthenticationInfo;
};

export default class LoggedInContextField extends ContextField<LoggedInContextType> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
  }: ContextOptions): Promise<LoggedInContextType> {
    const { actor, authenticationInfo } = await sessionManager.ensureLoggedInAsync({
      nonInteractive,
    });
    const featureGateServerValues: { [key: string]: boolean } = actor?.featureGates ?? {};

    const graphqlClient = createGraphqlClient(authenticationInfo);

    return {
      actor,
      featureGating: new FeatureGating(featureGateServerValues, new FeatureGateEnvOverrides()),
      graphqlClient,
      authenticationInfo,
    };
  }
}

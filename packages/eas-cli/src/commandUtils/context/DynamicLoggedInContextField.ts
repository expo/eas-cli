import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';
import { LoggedInAuthenticationInfo } from '../../user/SessionManager';
import { Actor } from '../../user/User';
import FeatureGateEnvOverrides from '../gating/FeatureGateEnvOverrides';
import FeatureGating from '../gating/FeatureGating';

export type DynamicLoggedInContextFn = () => Promise<{
  actor: Actor;
  featureGating: FeatureGating;
  graphqlClient: ExpoGraphqlClient;
  authenticationInfo: LoggedInAuthenticationInfo;
}>;

export default class DynamicLoggedInContextField extends ContextField<DynamicLoggedInContextFn> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
  }: ContextOptions): Promise<DynamicLoggedInContextFn> {
    return async () => {
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
    };
  }
}

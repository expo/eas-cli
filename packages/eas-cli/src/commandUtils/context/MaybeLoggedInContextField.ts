import { Actor } from '../../user/User';
import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';

export default class MaybeLoggedInContextField extends ContextField<{
  actor: Actor | null;
  graphqlClient: ExpoGraphqlClient;
}> {
  async getValueAsync({ sessionManager }: ContextOptions): Promise<{
    actor: Actor | null;
    graphqlClient: ExpoGraphqlClient;
  }> {
    const authenticationInfo = {
      accessToken: sessionManager.getAccessToken(),
      sessionSecret: sessionManager.getSessionSecret(),
    };

    const graphqlClient = createGraphqlClient(authenticationInfo);
    const actor = await sessionManager.getUserAsync();

    return { actor: actor ?? null, graphqlClient };
  }
}

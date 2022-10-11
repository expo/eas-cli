import { Actor } from '../../user/User';
import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient, createGraphqlClient } from './contextUtils/createGraphqlClient';

export default class LoggedInContextField extends ContextField<{
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
}> {
  async getValueAsync({ nonInteractive, sessionManager }: ContextOptions): Promise<{
    actor: Actor;
    graphqlClient: ExpoGraphqlClient;
  }> {
    const { actor, authenticationInfo } = await sessionManager.ensureLoggedInAsync({
      nonInteractive,
    });

    const graphqlClient = createGraphqlClient(authenticationInfo);
    return { actor, graphqlClient };
  }
}

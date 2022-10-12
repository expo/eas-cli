import { legacyGraphqlClient } from '../../graphql/client';
import { Actor } from '../../user/User';
import ContextField, { ContextOptions } from './ContextField';
import { ExpoGraphqlClient } from './contextUtils/createGraphqlClient';
import { ensureLoggedInAsync } from './contextUtils/ensureLoggedInAsync';

export default class LoggedInContextField extends ContextField<{
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
}> {
  async getValueAsync({
    nonInteractive,
  }: ContextOptions): Promise<{ actor: Actor; graphqlClient: ExpoGraphqlClient }> {
    const actor = await ensureLoggedInAsync({ nonInteractive });
    return { actor, graphqlClient: legacyGraphqlClient };
  }
}

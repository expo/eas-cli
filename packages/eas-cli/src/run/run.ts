import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { BuildFragment } from '../graphql/generated';
import Log from '../log';
import { Actor } from '../user/User';

export interface RunArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export async function runAsync(
  graphqlClient: ExpoGraphqlClient,
  actor: Actor,
  runArchiveFlags: RunArchiveFlags,
  build?: BuildFragment
): Promise<void> {
  Log.log(build?.id);
}

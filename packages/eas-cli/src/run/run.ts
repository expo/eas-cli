import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Actor } from '../user/User';

export interface RunArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export async function runAsync(
  graphqlClient: ExpoGraphqlClient,
  buildId: string,
  runArchiveFlags: RunArchiveFlags,
  actor: Actor
): Promise<void> {}

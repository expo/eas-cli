import { ControlConnectionBootstrap } from './controlConnection';
import { getPreviewApiAccess } from './utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, DeviceRunSessionStatus } from '../graphql/generated';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';

export async function loadControlSessionAsync(
  graphqlClient: ExpoGraphqlClient,
  sessionId: string
): Promise<ControlConnectionBootstrap> {
  const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
  if (session.status !== DeviceRunSessionStatus.InProgress) {
    throw new Error(
      `Simulator session ${session.id} is ${session.status.toLowerCase()}. Simulator actions need a running session. Start one with \`eas simulator:start\`.`
    );
  }
  if (session.platform !== AppPlatform.Ios) {
    throw new Error(
      `Simulator control on ${session.platform.toLowerCase()} is not supported yet. Simulator actions are available only for iOS sessions.`
    );
  }
  const access = session.remoteConfig ? getPreviewApiAccess(session.remoteConfig) : null;
  if (!access) {
    throw new Error(
      `Simulator session ${session.id} does not expose a preview server with a token. Simulator actions use that server. Start a new session with \`eas simulator:start\`.`
    );
  }
  return {
    access,
    session: {
      id: session.id,
      name: session.name ?? null,
      project: `@${session.app.ownerAccount.name}/${session.app.slug}`,
      status: session.status,
    },
  };
}

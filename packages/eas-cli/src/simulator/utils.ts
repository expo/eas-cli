import { DeviceRunSessionByIdQuery } from '../graphql/generated';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

export function formatRemoteConfigShellSnippet(remoteConfig: DeviceRunSessionRemoteConfig): string {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig':
      return [
        `export AGENT_DEVICE_DAEMON_BASE_URL='${remoteConfig.url}'`,
        `export AGENT_DEVICE_DAEMON_AUTH_TOKEN='${remoteConfig.token}'`,
      ].join('\n');
  }
}

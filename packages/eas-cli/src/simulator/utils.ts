import { DeviceRunSessionByIdQuery } from '../graphql/generated';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

export function formatRemoteSessionInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig
): string {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig':
      return [
        '🔑 Run the following in your shell to attach to the agent-device daemon:',
        '',
        `export AGENT_DEVICE_DAEMON_BASE_URL='${remoteConfig.url}'`,
        `export AGENT_DEVICE_DAEMON_AUTH_TOKEN='${remoteConfig.token}'`,
      ].join('\n');
    case 'ServeSimRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        remoteConfig.previewUrl,
      ].join('\n');
  }
}

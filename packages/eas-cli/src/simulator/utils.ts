import { DeviceRunSessionByIdQuery } from '../graphql/generated';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

export function formatRemoteSessionInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig
): string {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig': {
      const lines = [
        '🔑 Run the following in your shell to attach to the agent-device daemon:',
        '',
        `export AGENT_DEVICE_DAEMON_BASE_URL='${remoteConfig.agentDeviceRemoteSessionUrl}'`,
        `export AGENT_DEVICE_DAEMON_AUTH_TOKEN='${remoteConfig.agentDeviceRemoteSessionToken}'`,
      ];
      if (remoteConfig.webPreviewUrl) {
        lines.push(
          '',
          '🌐 Open the following URL in your browser to preview the simulator:',
          '',
          remoteConfig.webPreviewUrl
        );
      }
      return lines.join('\n');
    }
    case 'ServeSimRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        remoteConfig.previewUrl,
      ].join('\n');
  }
}

import { DeviceRunSessionByIdQuery, DeviceRunSessionType } from '../graphql/generated';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

// Mapping enum -> CLI flag value. Declared as Record<DeviceRunSessionType, string>
// so adding a new enum value in codegen fails the build until it is wired up here.
export const DEVICE_RUN_SESSION_TYPE_FLAG_VALUES: Record<DeviceRunSessionType, string> = {
  [DeviceRunSessionType.AgentDevice]: 'agent-device',
  [DeviceRunSessionType.Argent]: 'argent',
  [DeviceRunSessionType.ServeSim]: 'serve-sim',
};

export const DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE = Object.fromEntries(
  (Object.entries(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES) as [DeviceRunSessionType, string][]).map(
    ([type, value]) => [value, type]
  )
) as Record<string, DeviceRunSessionType>;

export function deviceRunSessionTypeToFlagValue(type: DeviceRunSessionType): string {
  return DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[type];
}

export function getRemoteSessionEnvironmentVariables(
  remoteConfig: DeviceRunSessionRemoteConfig
): Record<string, string> {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig':
      return {
        AGENT_DEVICE_DAEMON_BASE_URL: remoteConfig.agentDeviceRemoteSessionUrl,
        AGENT_DEVICE_DAEMON_AUTH_TOKEN: remoteConfig.agentDeviceRemoteSessionToken,
      };
    case 'ArgentRunSessionRemoteConfig':
    case 'ServeSimRunSessionRemoteConfig':
      return {};
  }
}

type RemoteSessionInstructionsConfigType = 'env' | 'dotenv';

export function formatRemoteSessionInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig,
  configType: RemoteSessionInstructionsConfigType
): string {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig': {
      const environmentVariables = getRemoteSessionEnvironmentVariables(remoteConfig);
      const lines =
        configType === 'dotenv'
          ? [
              '🔑 Run the following to use agent-device with the simulator:',
              '',
              'eas simulator:exec agent-device <command>',
            ]
          : [
              '🔑 Run the following in your shell to attach to the agent-device daemon:',
              '',
              ...Object.entries(environmentVariables).map(
                ([key, value]) => `export ${key}='${value}'`
              ),
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
    case 'ArgentRunSessionRemoteConfig': {
      const lines = [
        '🔑 Open the following URL to access the Argent tools for this session:',
        '',
        remoteConfig.toolsUrl,
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

import {
  DeviceRunSessionByIdQuery,
  DeviceRunSessionResourceClass,
  DeviceRunSessionType,
} from '../graphql/generated';
import { link } from '../log';
import {
  EAS_SIMULATOR_EGRESS_ALLOW,
  EAS_SIMULATOR_EGRESS_FINGERPRINT,
  EAS_SIMULATOR_EGRESS_PORT,
  EAS_SIMULATOR_EGRESS_TOKEN,
  EAS_SIMULATOR_EGRESS_URL,
} from './env';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

/** Landing page where accounts without access can request it. */
export const EAS_SIMULATOR_WAITLIST_URL = 'https://expo.dev/services/simulators';

/**
 * Message shown when EAS Simulator is not enabled for the account. Shared by every
 * command that can hit the gate so users always get the same waitlist pointer.
 */
export function formatSimulatorUnavailableMessage(accountName: string): string {
  return [
    `EAS Simulator isn't available on ${accountName} yet — it's coming soon.`,
    `Join the waitlist to get access: ${link(EAS_SIMULATOR_WAITLIST_URL)}`,
  ].join('\n');
}

// Mapping enum -> CLI flag value. Declared as Record<DeviceRunSessionType, string>
// so adding a new enum value in codegen fails the build until it is wired up here.
export const DEVICE_RUN_SESSION_TYPE_FLAG_VALUES: Record<DeviceRunSessionType, string> = {
  [DeviceRunSessionType.AgentDevice]: 'agent-device',
  [DeviceRunSessionType.Appium]: 'appium',
  [DeviceRunSessionType.Argent]: 'argent',
  [DeviceRunSessionType.ServeSim]: 'web-preview-only',
  [DeviceRunSessionType.WebPreviewOnly]: 'web-preview-only',
};

export const DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE = Object.fromEntries(
  (Object.entries(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES) as [DeviceRunSessionType, string][]).map(
    ([type, value]) => [value, type]
  )
) as Record<string, DeviceRunSessionType>;

export function deviceRunSessionTypeToFlagValue(type: DeviceRunSessionType): string {
  return DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[type];
}

export const DEVICE_RUN_SESSION_RESOURCE_CLASS_FLAG_VALUES: Record<
  DeviceRunSessionResourceClass,
  string
> = {
  [DeviceRunSessionResourceClass.Large]: 'large',
  [DeviceRunSessionResourceClass.Medium]: 'medium',
};

export const DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE = Object.fromEntries(
  (
    Object.entries(DEVICE_RUN_SESSION_RESOURCE_CLASS_FLAG_VALUES) as [
      DeviceRunSessionResourceClass,
      string,
    ][]
  ).map(([resourceClass, value]) => [value, resourceClass])
) as Record<string, DeviceRunSessionResourceClass>;

export type LocalEgressConfig = {
  url: string;
  /** Secret for the tunnel server; the client pairs it with the fixed egress username. */
  token: string;
  fingerprint: string;
  port: number;
  /**
   * Normalized `host:port` destinations on the developer's machine or network
   * that the simulator may reach through the proxy (`--egress-allow`).
   */
  allow: string[];
};

export type LocalEgressOptions = {
  egressAllow?: readonly string[];
};

/**
 * Connection details for the local egress client, present only for sessions
 * started with `--egress local`. `allow` comes from the developer's flags, not
 * from the worker.
 */
export function getLocalEgressConfig(
  remoteConfig: DeviceRunSessionRemoteConfig,
  allow: readonly string[] = []
): LocalEgressConfig | null {
  const { egressUrl, egressToken, egressFingerprint, egressPort } = remoteConfig;
  if (!egressUrl || !egressToken || !egressFingerprint || egressPort == null) {
    return null;
  }
  return {
    url: egressUrl,
    token: egressToken,
    fingerprint: egressFingerprint,
    port: egressPort,
    allow: [...allow],
  };
}

export function getLocalEgressEnvironmentVariables(
  egress: LocalEgressConfig | null
): Record<string, string> {
  if (!egress) {
    return {};
  }
  return {
    [EAS_SIMULATOR_EGRESS_URL]: egress.url,
    [EAS_SIMULATOR_EGRESS_TOKEN]: egress.token,
    [EAS_SIMULATOR_EGRESS_FINGERPRINT]: egress.fingerprint,
    [EAS_SIMULATOR_EGRESS_PORT]: String(egress.port),
    [EAS_SIMULATOR_EGRESS_ALLOW]: egress.allow.join(','),
  };
}

export function getRemoteSessionEnvironmentVariables(
  remoteConfig: DeviceRunSessionRemoteConfig,
  { egressAllow }: LocalEgressOptions = {}
): Record<string, string> {
  return {
    ...getControllerEnvironmentVariables(remoteConfig),
    ...getLocalEgressEnvironmentVariables(getLocalEgressConfig(remoteConfig, egressAllow)),
  };
}

function getControllerEnvironmentVariables(
  remoteConfig: DeviceRunSessionRemoteConfig
): Record<string, string> {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig':
      return {
        AGENT_DEVICE_DAEMON_BASE_URL: remoteConfig.agentDeviceRemoteSessionUrl,
        AGENT_DEVICE_DAEMON_AUTH_TOKEN: remoteConfig.agentDeviceRemoteSessionToken,
      };
    case 'ArgentRunSessionRemoteConfig':
      return {
        ARGENT_TOOLS_URL: remoteConfig.toolsUrl,
        ...(remoteConfig.toolsAuthToken ? { ARGENT_AUTH_TOKEN: remoteConfig.toolsAuthToken } : {}),
      };
    case 'AppiumRunSessionRemoteConfig':
      return {
        APPIUM_URL: remoteConfig.appiumUrl,
        APPIUM_CAPS: JSON.stringify(remoteConfig.capabilities),
      };
    case 'ServeSimRunSessionRemoteConfig':
    case 'WebPreviewOnlyRunSessionRemoteConfig':
      return {};
  }
}

type RemoteSessionInstructionsConfigType = 'env' | 'dotenv';

/**
 * Preview link for a session. A gated serve-sim needs the session token, and a browser cannot send
 * a header on a page load, so it rides the query. serve-sim swaps it for a cookie on the first load.
 */
export function formatPreviewUrl(url: string, token: string | null | undefined): string {
  if (!token) {
    return url;
  }
  const withToken = new URL(url);
  withToken.searchParams.set('token', token);
  return withToken.toString();
}

/**
 * Remote config for `--json`. The preview URL carries the token and the standalone token field is
 * dropped, so a consumer gets one URL that works rather than a bare URL that 401s next to a secret
 * it has to know to combine.
 */
export function sanitizeRemoteConfigForJson(
  remoteConfig: DeviceRunSessionRemoteConfig
): DeviceRunSessionRemoteConfig {
  switch (remoteConfig.__typename) {
    case 'ServeSimRunSessionRemoteConfig':
    case 'WebPreviewOnlyRunSessionRemoteConfig': {
      const { previewToken, ...rest } = remoteConfig;
      return { ...rest, previewUrl: formatPreviewUrl(remoteConfig.previewUrl, previewToken) };
    }
    case 'AgentDeviceRunSessionRemoteConfig':
    case 'ArgentRunSessionRemoteConfig':
    case 'AppiumRunSessionRemoteConfig': {
      const { webPreviewToken, ...rest } = remoteConfig;
      return {
        ...rest,
        webPreviewUrl: remoteConfig.webPreviewUrl
          ? formatPreviewUrl(remoteConfig.webPreviewUrl, webPreviewToken)
          : remoteConfig.webPreviewUrl,
      };
    }
  }
}

export function formatRemoteSessionInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig,
  configType: RemoteSessionInstructionsConfigType,
  { egressAllow }: LocalEgressOptions = {}
): string {
  const instructions = formatControllerInstructions(remoteConfig, configType);
  const egress = getLocalEgressConfig(remoteConfig, egressAllow);
  if (!egress) {
    return instructions;
  }
  return [
    instructions,
    '',
    '🔀 This session can route proxied HTTP(S) requests through this machine.',
    ...(configType === 'env'
      ? Object.entries(getLocalEgressEnvironmentVariables(egress)).map(
          ([key, value]) => `export ${key}='${value}'`
        )
      : []),
    'Run the egress client to connect the tunnel:',
    '',
    configType === 'env' ? 'eas simulator:egress --config-type env' : 'eas simulator:egress',
    '',
    'Keep it running for the life of the session.',
    ...(egress.allow.length > 0
      ? ['', `The simulator may reach ${egress.allow.join(', ')} on this machine's network.`]
      : []),
  ].join('\n');
}

function formatControllerInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig,
  configType: RemoteSessionInstructionsConfigType
): string {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig': {
      const environmentVariables = getControllerEnvironmentVariables(remoteConfig);
      const lines =
        configType === 'dotenv'
          ? [
              '🔑 Run the following to use agent-device with the simulator:',
              '',
              'eas simulator:exec npx agent-device <command>',
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
          formatPreviewUrl(remoteConfig.webPreviewUrl, remoteConfig.webPreviewToken)
        );
      }
      return lines.join('\n');
    }
    case 'ArgentRunSessionRemoteConfig': {
      const environmentVariables = getControllerEnvironmentVariables(remoteConfig);
      const lines =
        configType === 'dotenv'
          ? [
              '🔑 Run the following to link your local Argent client to this simulator session:',
              '',
              [
                'argent',
                'link',
                `'${remoteConfig.toolsUrl}'`,
                remoteConfig.toolsAuthToken
                  ? `--token '${remoteConfig.toolsAuthToken}'`
                  : undefined,
                '--yes',
              ]
                .filter(Boolean)
                .join(' '),
              '',
              'Restart your editor after linking so its Argent MCP process uses the remote session.',
            ]
          : [
              '🔑 Run the following in your shell to attach Argent to this simulator session:',
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
          formatPreviewUrl(remoteConfig.webPreviewUrl, remoteConfig.webPreviewToken)
        );
      }
      return lines.join('\n');
    }
    case 'AppiumRunSessionRemoteConfig': {
      const environmentVariables = getControllerEnvironmentVariables(remoteConfig);
      const lines =
        configType === 'dotenv'
          ? [
              'Run an Appium client with the simulator session environment:',
              '',
              'eas simulator:exec <appium-client> [args...]',
            ]
          : [
              'Run the following in your shell to attach an Appium client to this session:',
              '',
              ...Object.entries(environmentVariables).map(
                ([key, value]) => `export ${key}='${value}'`
              ),
              '',
              '<appium-client> [args...]',
            ];
      if (remoteConfig.webPreviewUrl) {
        lines.push(
          '',
          'Open the simulator preview:',
          '',
          formatPreviewUrl(remoteConfig.webPreviewUrl, remoteConfig.webPreviewToken)
        );
      }
      return lines.join('\n');
    }
    case 'ServeSimRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        formatPreviewUrl(remoteConfig.previewUrl, remoteConfig.previewToken),
      ].join('\n');
    case 'WebPreviewOnlyRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        formatPreviewUrl(remoteConfig.previewUrl, remoteConfig.previewToken),
      ].join('\n');
  }
}

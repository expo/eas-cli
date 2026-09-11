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
  /**
   * Link to the session on expo.dev. Its Logs section lists every connection
   * the local egress guard refused inside the simulator, with the process and
   * the calling frameworks, so the banner points readers there.
   */
  sessionUrl?: string;
  /**
   * Whether the calling command runs the egress client itself in the current
   * terminal, as interactive `simulator:start` does. When false the reader must
   * start `eas simulator:egress` in another process.
   */
  egressClientRunsInline?: boolean;
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

export type LoopbackForwardPlan = {
  /** Ports the tunnel client forwards on the device host's loopback interface. */
  ports: number[];
  /** Loopback allow entries that stay reachable by name through the proxy only. */
  skipped: string[];
};

/**
 * Which `--egress-allow` entries also become loopback port forwards. iOS never
 * sends loopback-literal requests to the system proxy, and Expo CLI rewrites
 * `localhost` to `127.0.0.1` in manifests, so the proxy alone cannot serve a dev
 * server allowed as `localhost:<port>`. For each entry naming `localhost` or
 * `127.0.0.1`, the tunnel client opens a reverse remote that makes
 * `127.0.0.1:<port>` on the device host reach the same port here, like
 * `adb reverse`. The device host only permits unprivileged ports, and the proxy
 * port is already taken by the tunnel server, so those entries are skipped.
 */
export function getLoopbackForwardPlan(
  allow: readonly string[],
  proxyPort: number
): LoopbackForwardPlan {
  const ports = new Set<number>();
  const skipped: string[] = [];
  for (const destination of allow) {
    const match = /^(?:localhost|127\.0\.0\.1):(\d+)$/.exec(destination);
    if (!match) {
      continue;
    }
    const port = Number(match[1]);
    if (port < 1024 || port === proxyPort) {
      skipped.push(destination);
      continue;
    }
    ports.add(port);
  }
  return { ports: [...ports].sort((a, b) => a - b), skipped };
}

/**
 * Only the exception is worth a line: forwarded ports just work, but an entry
 * the device host will not forward changes what the reader would expect.
 */
export function formatLoopbackForwardNotice({ skipped }: LoopbackForwardPlan): string[] {
  if (skipped.length === 0) {
    return [];
  }
  return [
    `${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} reachable by name only: ` +
      'privileged ports and the egress proxy port are not forwarded to 127.0.0.1 in the simulator.',
  ];
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
  { egressAllow, egressClientRunsInline = false, sessionUrl }: LocalEgressOptions = {}
): string {
  const instructions = formatControllerInstructions(remoteConfig, configType);
  const egress = getLocalEgressConfig(remoteConfig, egressAllow);
  if (!egress) {
    return instructions;
  }
  const egressCommand =
    configType === 'env' ? 'eas simulator:egress --config-type env' : 'eas simulator:egress';
  const summary =
    "🔀 Local egress: the simulator's HTTP(S) traffic exits from this machine." +
    (egress.allow.length > 0 ? ` It can also reach ${egress.allow.join(', ')}.` : '');
  const guardNotice =
    'Connections that bypass the proxy are refused inside the simulator. The Logs section of the ' +
    `session page lists what was refused and which library tried${sessionUrl ? `: ${link(sessionUrl)}` : '.'}`;
  return [
    instructions,
    '',
    summary,
    guardNotice,
    ...formatLoopbackForwardNotice(getLoopbackForwardPlan(egress.allow, egress.port)),
    // In interactive mode the client starts in this terminal once the session is
    // ready and stops with it, so there is nothing for the reader to run.
    ...(egressClientRunsInline
      ? []
      : [
          ...(configType === 'env'
            ? Object.entries(getLocalEgressEnvironmentVariables(egress)).map(
                ([key, value]) => `export ${key}='${value}'`
              )
            : []),
          'Run the egress client to connect the tunnel:',
          '',
          egressCommand,
          '',
          'Keep it running for the life of the session.',
        ]),
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

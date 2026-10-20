import chalk from 'chalk';

import {
  AppPlatform,
  DeviceRunSessionByIdQuery,
  DeviceRunSessionResourceClass,
  DeviceRunSessionType,
} from '../graphql/generated';
import { link } from '../log';
import {
  EAS_SIMULATOR_EGRESS_ALLOW,
  EAS_SIMULATOR_EGRESS_FINGERPRINT,
  EAS_SIMULATOR_EGRESS_PLATFORM,
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

// Legacy ServeSim and WebPreviewOnly share a flag value, so list each value once.
export const DEVICE_RUN_SESSION_TYPE_FLAG_OPTIONS = [
  ...new Set(Object.values(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES)),
];

// Every enum value behind a flag value, so filtering by web-preview-only also
// matches sessions created with the legacy ServeSim type.
export function deviceRunSessionTypesForFlagValue(value: string): DeviceRunSessionType[] {
  return (Object.keys(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES) as DeviceRunSessionType[]).filter(
    type => DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[type] === value
  );
}

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
  /**
   * An Android emulator guest reaches this machine's loopback as 10.0.2.2 (and,
   * through the emulator's proxy, as 127.0.0.1); an iOS Simulator does not.
   */
  platform: AppPlatform;
};

export type LocalEgressOptions = {
  egressAllow?: readonly string[];
  platform?: AppPlatform;
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
  allow: readonly string[] = [],
  platform: AppPlatform = AppPlatform.Ios
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
    platform,
  };
}

export type PreviewApiAccess = {
  apiUrl: string;
  token: string;
};

export function getPreviewApiAccess(
  remoteConfig: DeviceRunSessionRemoteConfig
): PreviewApiAccess | null {
  const token =
    remoteConfig.__typename === 'ServeSimRunSessionRemoteConfig' ||
    remoteConfig.__typename === 'WebPreviewOnlyRunSessionRemoteConfig'
      ? remoteConfig.previewToken
      : remoteConfig.webPreviewToken;
  if (!remoteConfig.previewApiUrl || !token) {
    return null;
  }
  return { apiUrl: remoteConfig.previewApiUrl, token };
}

/** The worker relay that the Android emulator's proxy points at; see build-tools androidLocalEgress.ts. */
export const ANDROID_EMULATOR_EGRESS_RELAY_PORT = 8898;

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
  proxyPort: number,
  platform: AppPlatform = AppPlatform.Ios
): LoopbackForwardPlan {
  const reservedPorts = new Set([
    proxyPort,
    ...(platform === AppPlatform.Android ? [ANDROID_EMULATOR_EGRESS_RELAY_PORT] : []),
  ]);
  const ports = new Set<number>();
  const skipped: string[] = [];
  for (const destination of allow) {
    const match = /^(?:localhost|127\.0\.0\.1):(\d+)$/.exec(destination);
    if (!match) {
      continue;
    }
    const port = Number(match[1]);
    if (port < 1024 || reservedPorts.has(port)) {
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
    // Always written, so pasted exports for one session replace another session's value.
    [EAS_SIMULATOR_EGRESS_PLATFORM]: egress.platform === AppPlatform.Android ? 'android' : 'ios',
  };
}

export function getRemoteSessionEnvironmentVariables(
  remoteConfig: DeviceRunSessionRemoteConfig,
  { egressAllow, platform }: LocalEgressOptions = {}
): Record<string, string> {
  return {
    ...getControllerEnvironmentVariables(remoteConfig),
    ...getLocalEgressEnvironmentVariables(
      getLocalEgressConfig(remoteConfig, egressAllow, platform)
    ),
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

type PreviewLinkOptions = {
  privatePreviewUrl?: string;
  publicLink?: boolean;
  /** Origins the session allows to embed the preview host; the embed URL is printed for them. */
  frameAncestors?: readonly string[];
  /** Origins the session allows to call the preview host API; the embed URL is printed for them. */
  corsOrigins?: readonly string[];
};

export type PreviewAccessOrigins = Pick<PreviewLinkOptions, 'frameAncestors' | 'corsOrigins'>;

function previewUrlIsWebsitePage(remoteConfig: DeviceRunSessionRemoteConfig): boolean {
  return remoteConfig.previewApiUrl != null;
}

/**
 * Preview link for a session. A gated preview needs the session token, and a browser cannot send
 * a header on a page load. The expo.dev preview page reads it from the fragment, which no request
 * carries; a preview server reads it from the query and swaps it for a cookie on the first load.
 */
export function formatPreviewUrl(
  remoteConfig: DeviceRunSessionRemoteConfig,
  url: string,
  token: string | null | undefined
): string {
  if (!token || !previewUrlIsWebsitePage(remoteConfig)) {
    return formatPreviewApiUrl(url, token);
  }
  const withToken = new URL(url);
  withToken.hash = new URLSearchParams({ token }).toString();
  return withToken.toString();
}

function formatPreviewApiUrl(url: string, token: string | null | undefined): string {
  if (!token) {
    return url;
  }
  const withToken = new URL(url);
  withToken.searchParams.set('token', token);
  return withToken.toString();
}

function withoutPreviewToken(url: string): string {
  const parsed = new URL(url);
  const hashParams = new URLSearchParams(parsed.hash.slice(1));
  if (!parsed.searchParams.has('token') && !hashParams.has('token')) {
    return url;
  }
  parsed.searchParams.delete('token');
  if (hashParams.has('token')) {
    hashParams.delete('token');
    parsed.hash = hashParams.toString();
  }
  return parsed.toString();
}

function formatBrowserPreviewUrl(
  remoteConfig: DeviceRunSessionRemoteConfig,
  url: string,
  token: string | null | undefined,
  { privatePreviewUrl, publicLink }: PreviewLinkOptions
): string {
  return publicLink
    ? formatPreviewUrl(remoteConfig, url, token)
    : (privatePreviewUrl ?? withoutPreviewToken(url));
}

function formatBrowserPreviewInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig,
  url: string,
  token: string | null | undefined,
  options: PreviewLinkOptions
): string {
  const previewUrl = formatBrowserPreviewUrl(remoteConfig, url, token, options);
  return options.publicLink
    ? `${chalk.yellow('Warning: Anyone with this link can view and control the simulator, including your app and logs that may contain sensitive data. Share this link only with trusted recipients.')}\n${previewUrl}`
    : previewUrl;
}

/**
 * Remote config for `--json`. Private sessions omit the direct preview API address and preview
 * tokens. Public sessions include bearer preview links while preserving controller credentials.
 * A session with frame ancestors or CORS origins also includes the preview API address, since
 * the page on those origins needs it.
 */
export function sanitizeRemoteConfigForJson(
  remoteConfig: DeviceRunSessionRemoteConfig,
  privatePreviewUrl: string,
  publicLink = false,
  { frameAncestors = [], corsOrigins = [] }: PreviewAccessOrigins = {}
): DeviceRunSessionRemoteConfig {
  const includePreviewApiUrl = publicLink || frameAncestors.length > 0 || corsOrigins.length > 0;
  switch (remoteConfig.__typename) {
    case 'ServeSimRunSessionRemoteConfig':
    case 'WebPreviewOnlyRunSessionRemoteConfig': {
      const { previewToken, ...rest } = remoteConfig;
      return {
        ...rest,
        previewUrl: formatBrowserPreviewUrl(remoteConfig, remoteConfig.previewUrl, previewToken, {
          privatePreviewUrl,
          publicLink,
        }),
        previewApiUrl: includePreviewApiUrl
          ? remoteConfig.previewApiUrl &&
            formatPreviewApiUrl(remoteConfig.previewApiUrl, previewToken)
          : null,
      };
    }
    case 'AgentDeviceRunSessionRemoteConfig':
    case 'ArgentRunSessionRemoteConfig':
    case 'AppiumRunSessionRemoteConfig': {
      const { webPreviewToken, ...rest } = remoteConfig;
      return {
        ...rest,
        webPreviewUrl: remoteConfig.webPreviewUrl
          ? formatBrowserPreviewUrl(remoteConfig, remoteConfig.webPreviewUrl, webPreviewToken, {
              privatePreviewUrl,
              publicLink,
            })
          : remoteConfig.webPreviewUrl,
        previewApiUrl: includePreviewApiUrl
          ? remoteConfig.previewApiUrl &&
            formatPreviewApiUrl(remoteConfig.previewApiUrl, webPreviewToken)
          : null,
      };
    }
  }
}

/**
 * The preview host address with the session token, which an embedding page loads directly. The
 * expo.dev preview page cannot be framed by other sites. Null until the worker reports the host.
 */
export function formatEmbedPreviewUrl(remoteConfig: DeviceRunSessionRemoteConfig): string | null {
  switch (remoteConfig.__typename) {
    case 'ServeSimRunSessionRemoteConfig':
    case 'WebPreviewOnlyRunSessionRemoteConfig':
      return remoteConfig.previewApiUrl
        ? formatPreviewApiUrl(remoteConfig.previewApiUrl, remoteConfig.previewToken)
        : null;
    case 'AgentDeviceRunSessionRemoteConfig':
    case 'ArgentRunSessionRemoteConfig':
    case 'AppiumRunSessionRemoteConfig':
      return remoteConfig.previewApiUrl
        ? formatPreviewApiUrl(remoteConfig.previewApiUrl, remoteConfig.webPreviewToken)
        : null;
  }
}

function formatEmbedInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig,
  { frameAncestors = [], corsOrigins = [] }: PreviewAccessOrigins
): string[] {
  if (frameAncestors.length === 0 && corsOrigins.length === 0) {
    return [];
  }
  const embedUrl = formatEmbedPreviewUrl(remoteConfig);
  const grants = [
    ...(frameAncestors.length > 0
      ? [`Pages on ${frameAncestors.join(', ')} may embed the preview in a frame.`]
      : []),
    ...(corsOrigins.length > 0
      ? [
          `Pages on ${corsOrigins.join(', ')} may call the preview API, for example with @expo/hub-client.`,
        ]
      : []),
  ];
  return [
    '',
    `🖼  ${grants.join(' ')} Use this URL there:`,
    '',
    embedUrl ?? 'The preview host has not reported its address yet.',
    chalk.yellow(
      'Warning: Anyone who can read this URL can view and control the simulator, including your app and logs that may contain sensitive data.'
    ),
  ];
}

export function formatRemoteSessionInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig,
  configType: RemoteSessionInstructionsConfigType,
  {
    egressAllow,
    egressClientRunsInline = false,
    sessionUrl,
    platform,
    privatePreviewUrl,
    publicLink,
    frameAncestors = [],
    corsOrigins = [],
  }: LocalEgressOptions & PreviewLinkOptions = {}
): string {
  const instructions = [
    formatControllerInstructions(remoteConfig, configType, {
      privatePreviewUrl,
      publicLink,
    }),
    ...formatEmbedInstructions(remoteConfig, { frameAncestors, corsOrigins }),
  ].join('\n');
  const egress = getLocalEgressConfig(remoteConfig, egressAllow, platform);
  if (!egress) {
    return instructions;
  }
  const egressCommand =
    configType === 'env' ? 'eas simulator:egress --config-type env' : 'eas simulator:egress';
  const summary =
    "🔀 Local egress: the simulator's HTTP(S) traffic exits from this machine." +
    (egress.allow.length > 0 ? ` It can also reach ${egress.allow.join(', ')}.` : '');
  const guardNotice =
    egress.platform === AppPlatform.Android
      ? 'Traffic that cannot use the tunnel, such as UDP, is refused on the device host. The Logs ' +
        `section of the session page lists what was refused${sessionUrl ? `: ${link(sessionUrl)}` : '.'}`
      : 'Connections that bypass the proxy are refused inside the simulator. The Logs section of the ' +
        `session page lists what was refused and which library tried${sessionUrl ? `: ${link(sessionUrl)}` : '.'}`;
  return [
    instructions,
    '',
    summary,
    guardNotice,
    ...formatLoopbackForwardNotice(
      getLoopbackForwardPlan(egress.allow, egress.port, egress.platform)
    ),
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
  configType: RemoteSessionInstructionsConfigType,
  previewLinkOptions: PreviewLinkOptions
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
          formatBrowserPreviewInstructions(
            remoteConfig,
            remoteConfig.webPreviewUrl,
            remoteConfig.webPreviewToken,
            previewLinkOptions
          )
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
          formatBrowserPreviewInstructions(
            remoteConfig,
            remoteConfig.webPreviewUrl,
            remoteConfig.webPreviewToken,
            previewLinkOptions
          )
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
          formatBrowserPreviewInstructions(
            remoteConfig,
            remoteConfig.webPreviewUrl,
            remoteConfig.webPreviewToken,
            previewLinkOptions
          )
        );
      }
      return lines.join('\n');
    }
    case 'ServeSimRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        formatBrowserPreviewInstructions(
          remoteConfig,
          remoteConfig.previewUrl,
          remoteConfig.previewToken,
          previewLinkOptions
        ),
      ].join('\n');
    case 'WebPreviewOnlyRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        formatBrowserPreviewInstructions(
          remoteConfig,
          remoteConfig.previewUrl,
          remoteConfig.previewToken,
          previewLinkOptions
        ),
      ].join('\n');
  }
}

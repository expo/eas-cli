import {
  AppPlatform,
  DeviceRunSessionResourceClass,
  DeviceRunSessionType,
} from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_OPTIONS,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  DeviceRunSessionRemoteConfig,
  EAS_SIMULATOR_WAITLIST_URL,
  deviceRunSessionTypeToFlagValue,
  deviceRunSessionTypesForFlagValue,
  formatEmbedPreviewUrl,
  formatLoopbackForwardNotice,
  formatPreviewUrl,
  formatRemoteSessionInstructions,
  formatSimulatorUnavailableMessage,
  getLocalEgressConfig,
  getLoopbackForwardPlan,
  getPreviewApiAccess,
  getRemoteSessionEnvironmentVariables,
  sanitizeRemoteConfigForJson,
  stripTerminalControlCharacters,
} from '../utils';

const agentDeviceConfig = {
  __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
  agentDeviceRemoteSessionUrl: 'https://agent-device.example.test',
  agentDeviceRemoteSessionToken: 'daemon-token',
  webPreviewUrl: 'https://preview.example.test',
};

const agentDeviceConfigWithEgress = {
  ...agentDeviceConfig,
  egressUrl: 'https://egress-abc.eas-simulator.ngrok.dev',
  egressToken: 'egress-secret',
  egressFingerprint: 'fp=',
  egressPort: 8899,
};

describe('local egress configuration', () => {
  it('is absent for sessions without egress', () => {
    expect(getLocalEgressConfig(agentDeviceConfig)).toBeNull();
    expect(getRemoteSessionEnvironmentVariables(agentDeviceConfig)).toEqual({
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent-device.example.test',
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'daemon-token',
    });
    expect(formatRemoteSessionInstructions(agentDeviceConfig, 'dotenv')).not.toContain(
      'eas simulator:egress'
    );
  });

  it('adds the egress variables and instructions when the worker reported them', () => {
    expect(getLocalEgressConfig(agentDeviceConfigWithEgress)).toEqual({
      url: 'https://egress-abc.eas-simulator.ngrok.dev',
      token: 'egress-secret',
      fingerprint: 'fp=',
      port: 8899,
      allow: [],
      platform: AppPlatform.Ios,
    });
    expect(getRemoteSessionEnvironmentVariables(agentDeviceConfigWithEgress)).toEqual({
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent-device.example.test',
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'daemon-token',
      EAS_SIMULATOR_EGRESS_URL: 'https://egress-abc.eas-simulator.ngrok.dev',
      EAS_SIMULATOR_EGRESS_TOKEN: 'egress-secret',
      EAS_SIMULATOR_EGRESS_FINGERPRINT: 'fp=',
      EAS_SIMULATOR_EGRESS_PORT: '8899',
      EAS_SIMULATOR_EGRESS_ALLOW: '',
      EAS_SIMULATOR_EGRESS_PLATFORM: 'ios',
    });
    const instructions = formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv');
    expect(instructions).toContain(
      "🔀 Local egress: the simulator's HTTP(S) traffic exits from this machine.\n"
    );
    expect(instructions).toContain('Run the egress client to connect the tunnel');
    expect(instructions).toContain('eas simulator:egress');
    expect(instructions).toContain('Keep it running for the life of the session.');
    expect(instructions).not.toContain('It can also reach');
    expect(instructions).toContain(
      'Connections that bypass the proxy are refused inside the simulator. The Logs section of the session page lists what was refused and which library tried.'
    );
    expect(formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'env')).toContain(
      "export EAS_SIMULATOR_EGRESS_ALLOW=''"
    );
  });

  it('links the session page when it is known, so refusals can be found', () => {
    const instructions = formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv', {
      sessionUrl: 'https://expo.dev/accounts/a/projects/p/simulator-sessions/s',
    });
    // The link is rendered with terminal styling, so check the phrase and the URL apart.
    expect(instructions).toContain('lists what was refused and which library tried: ');
    expect(instructions).toContain('https://expo.dev/accounts/a/projects/p/simulator-sessions/s');
    expect(
      formatRemoteSessionInstructions(agentDeviceConfig, 'dotenv', {
        sessionUrl: 'https://expo.dev/x',
      })
    ).not.toContain('refused');
  });

  it('says nothing about starting the client when it runs inline', () => {
    for (const configType of ['dotenv', 'env'] as const) {
      const instructions = formatRemoteSessionInstructions(
        agentDeviceConfigWithEgress,
        configType,
        {
          egressClientRunsInline: true,
        }
      );
      expect(instructions).toContain(
        "🔀 Local egress: the simulator's HTTP(S) traffic exits from this machine."
      );
      expect(instructions).not.toContain('eas simulator:egress');
      expect(instructions).not.toContain('Run the egress client');
      expect(instructions).not.toContain('Keep it running');
      expect(instructions).not.toContain('export EAS_SIMULATOR_EGRESS');
    }
  });

  it('carries the allowed local destinations into the config, env file and instructions', () => {
    const egressAllow = ['localhost:3000', '192.168.1.20:8080'];
    expect(getLocalEgressConfig(agentDeviceConfigWithEgress, egressAllow)?.allow).toEqual(
      egressAllow
    );
    expect(
      getRemoteSessionEnvironmentVariables(agentDeviceConfigWithEgress, { egressAllow })
    ).toMatchObject({ EAS_SIMULATOR_EGRESS_ALLOW: 'localhost:3000,192.168.1.20:8080' });
    expect(
      getRemoteSessionEnvironmentVariables(agentDeviceConfig, { egressAllow })
    ).not.toHaveProperty('EAS_SIMULATOR_EGRESS_ALLOW');
    const instructions = formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv', {
      egressAllow,
    });
    expect(instructions).toContain(
      "🔀 Local egress: the simulator's HTTP(S) traffic exits from this machine. It can also reach localhost:3000, 192.168.1.20:8080."
    );
    expect(instructions).not.toContain('reachable by name only');
  });

  it('warns only about loopback entries the device host will not forward', () => {
    expect(
      formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv', {
        egressAllow: ['localhost:80', 'localhost:3000'],
      })
    ).toContain(
      'localhost:80 is reachable by name only: privileged ports and the egress proxy port are not forwarded to 127.0.0.1 in the simulator.'
    );
  });
});

describe(getLoopbackForwardPlan, () => {
  it('forwards unprivileged localhost and 127.0.0.1 ports once each, in order', () => {
    expect(
      getLoopbackForwardPlan(
        ['localhost:8082', '127.0.0.1:3000', 'localhost:3000', '192.168.1.20:8080', '[::1]:4000'],
        8899
      )
    ).toEqual({ ports: [3000, 8082], skipped: [] });
  });

  it('skips privileged ports and the proxy port, which the device host does not forward', () => {
    expect(
      getLoopbackForwardPlan(['localhost:80', '127.0.0.1:8899', 'localhost:1024'], 8899)
    ).toEqual({ ports: [1024], skipped: ['localhost:80', '127.0.0.1:8899'] });
  });

  it('returns an empty plan without allow entries', () => {
    expect(getLoopbackForwardPlan([], 8899)).toEqual({ ports: [], skipped: [] });
  });

  it('also skips the relay port the Android emulator proxy uses', () => {
    expect(getLoopbackForwardPlan(['localhost:8898', 'localhost:8081'], 8899)).toEqual({
      ports: [8081, 8898],
      skipped: [],
    });
    expect(
      getLoopbackForwardPlan(['localhost:8898', 'localhost:8081'], 8899, AppPlatform.Android)
    ).toEqual({ ports: [8081], skipped: ['localhost:8898'] });
  });
});

describe(formatLoopbackForwardNotice, () => {
  it('describes name-only entries and stays silent about forwarded ports', () => {
    expect(formatLoopbackForwardNotice({ ports: [3000, 8082], skipped: ['localhost:80'] })).toEqual(
      [
        'localhost:80 is reachable by name only: privileged ports and the egress proxy port are not forwarded to 127.0.0.1 in the simulator.',
      ]
    );
    expect(formatLoopbackForwardNotice({ ports: [3000], skipped: [] })).toEqual([]);
    expect(formatLoopbackForwardNotice({ ports: [], skipped: [] })).toEqual([]);
  });
});

const iosAppiumConfig = {
  __typename: 'AppiumRunSessionRemoteConfig' as const,
  appiumUrl: 'https://appium.example.test',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': 'simulator-id',
  },
  webPreviewUrl: 'https://preview.example.test',
};

describe('Appium simulator configuration', () => {
  it('maps the appium CLI value to the GraphQL enum', () => {
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE.appium).toBe(DeviceRunSessionType.Appium);
  });

  it('creates the Appium client environment', () => {
    expect(getRemoteSessionEnvironmentVariables(iosAppiumConfig)).toEqual({
      APPIUM_URL: 'https://appium.example.test',
      APPIUM_CAPS:
        '{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"simulator-id"}',
    });
  });

  it('does not print the URL in managed dotenv instructions', () => {
    const instructions = formatRemoteSessionInstructions(iosAppiumConfig, 'dotenv');

    expect(instructions).toContain('eas simulator:exec <appium-client> [args...]');
    expect(instructions).toContain('https://preview.example.test');
    expect(instructions).toContain('Open the simulator preview:');
    expect(instructions).not.toContain('iOS simulator preview');
    expect(instructions).not.toContain('https://appium.example.test');
  });
});

describe('simulator session type flags', () => {
  it('maps web-preview-only to the WebPreviewOnly GraphQL enum', () => {
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE['web-preview-only']).toBe(
      DeviceRunSessionType.WebPreviewOnly
    );
    expect(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.ServeSim]).toBe(
      'web-preview-only'
    );
    expect(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.WebPreviewOnly]).toBe(
      'web-preview-only'
    );
    expect(deviceRunSessionTypeToFlagValue(DeviceRunSessionType.ServeSim)).toBe('web-preview-only');
    expect(deviceRunSessionTypeToFlagValue(DeviceRunSessionType.WebPreviewOnly)).toBe(
      'web-preview-only'
    );
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE['serve-sim']).toBeUndefined();
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE['web-preview']).toBeUndefined();
  });

  it('lists each flag value once', () => {
    expect(DEVICE_RUN_SESSION_TYPE_FLAG_OPTIONS).toEqual([
      'agent-device',
      'appium',
      'argent',
      'web-preview-only',
    ]);
  });

  it('filters web-preview-only by the new and the legacy session type', () => {
    expect(deviceRunSessionTypesForFlagValue('web-preview-only')).toEqual([
      DeviceRunSessionType.ServeSim,
      DeviceRunSessionType.WebPreviewOnly,
    ]);
    expect(deviceRunSessionTypesForFlagValue('appium')).toEqual([DeviceRunSessionType.Appium]);
  });
});

describe('simulator resource class flags', () => {
  it('maps CLI values to the GraphQL enum', () => {
    expect(DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE.large).toBe(
      DeviceRunSessionResourceClass.Large
    );
    expect(DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE.medium).toBe(
      DeviceRunSessionResourceClass.Medium
    );
  });
});

describe(formatPreviewUrl, () => {
  const PAGE_URL = 'https://expo.dev/simulator-preview/abc';
  const SERVER_URL = 'https://web-preview-abc.eas-simulator.ngrok.dev';
  const pageConfig = {
    __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
    previewUrl: PAGE_URL,
    previewToken: 'tok-1',
    previewApiUrl: SERVER_URL,
  };
  const serverConfig = {
    __typename: 'ServeSimRunSessionRemoteConfig' as const,
    previewUrl: SERVER_URL,
    previewToken: 'tok-1',
  };

  it('puts the token in the fragment for the expo.dev page, where no request carries it', () => {
    expect(formatPreviewUrl(pageConfig, PAGE_URL, 'tok-1')).toBe(`${PAGE_URL}#token=tok-1`);
  });

  it('puts the token on the query for a session that predates the expo.dev page', () => {
    expect(formatPreviewUrl(serverConfig, SERVER_URL, 'tok-1')).toBe(`${SERVER_URL}/?token=tok-1`);
  });

  it('leaves the url alone when the preview is ungated', () => {
    expect(formatPreviewUrl(pageConfig, PAGE_URL, null)).toBe(PAGE_URL);
    expect(formatPreviewUrl(pageConfig, PAGE_URL, undefined)).toBe(PAGE_URL);
  });
});

describe(sanitizeRemoteConfigForJson, () => {
  const PREVIEW_URL = 'https://preview.example.test';
  const PAGE_URL = 'https://expo.dev/simulator-preview/abc';
  const PRIVATE_URL =
    'https://expo.dev/accounts/testuser/projects/testapp/simulator-sessions/session-123/preview';

  it('uses the authenticated preview URL by default and drops the standalone token', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW_URL,
        previewToken: 'tok-1',
      },
      PRIVATE_URL
    );

    expect(sanitized).toEqual({
      __typename: 'ServeSimRunSessionRemoteConfig',
      previewUrl: PRIVATE_URL,
      previewApiUrl: null,
    });
    expect(JSON.stringify(sanitized)).not.toContain('tok-1');
  });

  it('omits the direct preview API address by default', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PAGE_URL,
        previewToken: 'tok-1',
        previewApiUrl: `${PREVIEW_URL}/?token=tok-1&mode=stream`,
      },
      PRIVATE_URL
    );

    expect(sanitized).toEqual({
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
      previewUrl: PRIVATE_URL,
      previewApiUrl: null,
    });
    expect(JSON.stringify(sanitized)).not.toContain('tok-1');
  });

  it('removes preexisting query and fragment tokens but preserves other URL parameters', () => {
    const pretokenizedUrl = `${PREVIEW_URL}/?mode=stream&token=tok-1#token=tok-1&view=logs`;
    const tokenlessUrl = `${PREVIEW_URL}/?mode=stream#view=logs`;
    const remoteConfig = {
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
      previewUrl: pretokenizedUrl,
      previewApiUrl: pretokenizedUrl,
      previewToken: 'tok-1',
    };

    expect(sanitizeRemoteConfigForJson(remoteConfig, PRIVATE_URL)).toMatchObject({
      previewUrl: PRIVATE_URL,
      previewApiUrl: null,
    });
    const fallbackInstructions = formatRemoteSessionInstructions(remoteConfig, 'env');
    expect(fallbackInstructions).toContain(tokenlessUrl);
    expect(fallbackInstructions).not.toContain('tok-1');
  });

  it.each([
    {
      name: 'legacy serve-sim',
      config: {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW_URL,
        previewToken: 'preview-secret',
      },
    },
    {
      name: 'web-preview-only',
      config: {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PAGE_URL,
        previewToken: 'preview-secret',
      },
    },
    {
      name: 'agent-device on Android',
      config: {
        ...agentDeviceConfig,
        webPreviewUrl: null,
        webPreviewToken: null,
      },
    },
    {
      name: 'Argent',
      config: {
        __typename: 'ArgentRunSessionRemoteConfig' as const,
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-secret',
        webPreviewUrl: PREVIEW_URL,
        webPreviewToken: 'preview-secret',
      },
    },
    {
      name: 'Appium',
      config: {
        __typename: 'AppiumRunSessionRemoteConfig' as const,
        appiumUrl: 'https://appium.example.test',
        capabilities: {},
        webPreviewUrl: PREVIEW_URL,
        webPreviewToken: 'preview-secret',
      },
    },
  ])('hides the direct API address for $name unless opted in', ({ config }) => {
    const remoteConfig: DeviceRunSessionRemoteConfig = {
      ...config,
      previewApiUrl: PREVIEW_URL,
    };
    const token =
      'previewToken' in config
        ? config.previewToken
        : 'webPreviewToken' in config
          ? config.webPreviewToken
          : null;
    expect(sanitizeRemoteConfigForJson(remoteConfig, PRIVATE_URL).previewApiUrl).toBeNull();
    expect(sanitizeRemoteConfigForJson(remoteConfig, PRIVATE_URL, true).previewApiUrl).toBe(
      token ? `${PREVIEW_URL}/?token=${token}` : PREVIEW_URL
    );
  });

  it('keeps controller credentials separate from the preview token', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'ArgentRunSessionRemoteConfig' as const,
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-token',
        webPreviewUrl: PREVIEW_URL,
        webPreviewToken: 'tok-1',
      },
      PRIVATE_URL
    );

    expect(sanitized).toMatchObject({
      webPreviewUrl: PRIVATE_URL,
      toolsAuthToken: 'argent-token',
    });
    expect(JSON.stringify(sanitized)).not.toContain('tok-1');
  });

  it('uses the authenticated preview URL even when the public preview is ungated', () => {
    const remoteConfig = {
      __typename: 'ServeSimRunSessionRemoteConfig' as const,
      previewUrl: PREVIEW_URL,
      previewToken: null,
    };

    expect(sanitizeRemoteConfigForJson(remoteConfig, PRIVATE_URL)).toEqual({
      __typename: 'ServeSimRunSessionRemoteConfig',
      previewUrl: PRIVATE_URL,
      previewApiUrl: null,
    });
  });

  it('leaves a controller session with no web preview alone', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'AppiumRunSessionRemoteConfig' as const,
        appiumUrl: 'https://appium.example.test',
        capabilities: {},
        webPreviewUrl: null,
        webPreviewToken: null,
      },
      PRIVATE_URL
    );

    expect(sanitized).toMatchObject({ webPreviewUrl: null });
  });

  it('includes the tokenized preview API address for a session with frame ancestors', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
        agentDeviceRemoteSessionUrl: 'https://agent-device.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
        webPreviewUrl: PAGE_URL,
        webPreviewToken: 'tok-1',
        previewApiUrl: PREVIEW_URL,
      },
      PRIVATE_URL,
      false,
      { frameAncestors: ['https://embed.example.test'] }
    );

    expect(sanitized).toMatchObject({
      webPreviewUrl: PRIVATE_URL,
      previewApiUrl: `${PREVIEW_URL}/?token=tok-1`,
    });
  });

  it('includes the tokenized preview API address for a session with CORS origins', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PAGE_URL,
        previewToken: 'tok-1',
        previewApiUrl: PREVIEW_URL,
      },
      PRIVATE_URL,
      false,
      { corsOrigins: ['https://app.example.test'] }
    );

    expect(sanitized).toMatchObject({
      previewUrl: PRIVATE_URL,
      previewApiUrl: `${PREVIEW_URL}/?token=tok-1`,
    });
  });

  it('returns a fragment-bearing website link with --public-link', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PAGE_URL,
        previewToken: 'tok-1',
        previewApiUrl: PREVIEW_URL,
      },
      PRIVATE_URL,
      true
    );

    expect(sanitized).toEqual({
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
      previewUrl: `${PAGE_URL}#token=tok-1`,
      previewApiUrl: `${PREVIEW_URL}/?token=tok-1`,
    });
  });

  it('returns the legacy direct-preview link with --public-link', () => {
    const sanitized = sanitizeRemoteConfigForJson(
      {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW_URL,
        previewToken: 'tok-1',
      },
      PRIVATE_URL,
      true
    );

    expect(sanitized).toMatchObject({ previewUrl: `${PREVIEW_URL}/?token=tok-1` });
  });
});

describe('gated preview links', () => {
  const PREVIEW = 'https://preview.example.test';
  const GATED = `${PREVIEW}/?token=tok-1`;
  const PRIVATE =
    'https://expo.dev/accounts/testuser/projects/testapp/simulator-sessions/session-123/preview';

  it('prints the private preview by default while retaining controller credentials', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
        agentDeviceRemoteSessionUrl: 'https://daemon.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
        webPreviewUrl: PREVIEW,
        webPreviewToken: 'tok-1',
      },
      'env',
      { privatePreviewUrl: PRIVATE }
    );

    expect(instructions).toContain(PRIVATE);
    expect(instructions).not.toContain(PREVIEW);
    expect(instructions).not.toContain('tok-1');
    expect(instructions).toContain("export AGENT_DEVICE_DAEMON_AUTH_TOKEN='daemon-token'");
  });

  it('prints the shareable link when explicitly requested', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: 'https://expo.dev/simulator-preview/abc',
        previewToken: 'tok-1',
        previewApiUrl: PREVIEW,
      },
      'env',
      { privatePreviewUrl: PRIVATE, publicLink: true }
    );

    expect(instructions).toContain('https://expo.dev/simulator-preview/abc#token=tok-1');
    expect(instructions).not.toContain(PRIVATE);
  });

  it('prints the tokenized preview for a serve-sim session with --public-link', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW,
        previewToken: 'tok-1',
      },
      'env',
      { publicLink: true }
    );

    expect(instructions).toContain(GATED);
  });

  it('prints the tokenized preview for a web-preview-only session with --public-link', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW,
        previewToken: 'tok-1',
      },
      'env',
      { publicLink: true }
    );

    expect(instructions).toContain(GATED);
  });

  it('prints the tokenized preview for every controller session type with --public-link', () => {
    const controllers = [
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
        agentDeviceRemoteSessionUrl: 'https://daemon.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
        webPreviewUrl: PREVIEW,
        webPreviewToken: 'tok-1',
      },
      {
        __typename: 'ArgentRunSessionRemoteConfig' as const,
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-token',
        webPreviewUrl: PREVIEW,
        webPreviewToken: 'tok-1',
      },
      { ...iosAppiumConfig, webPreviewToken: 'tok-1' },
    ];

    for (const remoteConfig of controllers) {
      expect(formatRemoteSessionInstructions(remoteConfig, 'env', { publicLink: true })).toContain(
        GATED
      );
    }
  });

  it('prints the fragment link for every session the worker gave a preview api url with --public-link', () => {
    const PAGE = 'https://expo.dev/simulator-preview/abc';
    const API = 'https://web-preview-abc.eas-simulator.ngrok.dev';
    const sessions = [
      {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PAGE,
        previewToken: 'tok-1',
        previewApiUrl: API,
      },
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PAGE,
        previewToken: 'tok-1',
        previewApiUrl: API,
      },
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
        agentDeviceRemoteSessionUrl: 'https://daemon.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
        webPreviewUrl: PAGE,
        webPreviewToken: 'tok-1',
        previewApiUrl: API,
      },
      {
        __typename: 'ArgentRunSessionRemoteConfig' as const,
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-token',
        webPreviewUrl: PAGE,
        webPreviewToken: 'tok-1',
        previewApiUrl: API,
      },
      { ...iosAppiumConfig, webPreviewUrl: PAGE, webPreviewToken: 'tok-1', previewApiUrl: API },
    ];

    for (const remoteConfig of sessions) {
      const instructions = formatRemoteSessionInstructions(remoteConfig, 'env', {
        publicLink: true,
      });
      expect(instructions).toContain(
        'Warning: Anyone with this link can view and control the simulator, including your app and logs that may contain sensitive data. Share this link only with trusted recipients.'
      );
      expect(instructions.indexOf('Warning:')).toBeLessThan(
        instructions.indexOf(`${PAGE}#token=tok-1`)
      );
      expect(instructions).toContain(`${PAGE}#token=tok-1`);
      expect(instructions).not.toContain('?token=');
    }
  });

  it('prints the plain url when the preview is ungated', () => {
    const instructions = formatRemoteSessionInstructions(
      { __typename: 'ServeSimRunSessionRemoteConfig' as const, previewUrl: PREVIEW },
      'env'
    );

    expect(instructions).toContain(PREVIEW);
    expect(instructions).not.toContain('token=');
  });
});

describe('preview-only session environment', () => {
  it.each([
    { __typename: 'ServeSimRunSessionRemoteConfig' as const, previewUrl: 'https://p.example.test' },
    {
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
      previewUrl: 'https://p.example.test',
    },
  ])('has no controller variables for $__typename', remoteConfig => {
    expect(getRemoteSessionEnvironmentVariables(remoteConfig)).toEqual({});
  });
});

describe('Argent session without a tools token', () => {
  const untokenizedArgent = {
    __typename: 'ArgentRunSessionRemoteConfig' as const,
    toolsUrl: 'https://argent.example.test',
    webPreviewUrl: null,
  };

  it('omits the auth variable', () => {
    expect(getRemoteSessionEnvironmentVariables(untokenizedArgent)).toEqual({
      ARGENT_TOOLS_URL: 'https://argent.example.test',
    });
  });

  it('omits the --token flag from the link command', () => {
    const instructions = formatRemoteSessionInstructions(untokenizedArgent, 'dotenv');

    expect(instructions).toContain("argent link 'https://argent.example.test'");
    expect(instructions).not.toContain('--token');
  });
});

describe('dotenv instructions', () => {
  it('tells an agent-device session to use simulator:exec', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
        agentDeviceRemoteSessionUrl: 'https://daemon.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
        webPreviewUrl: null,
      },
      'dotenv'
    );

    expect(instructions).toContain('eas simulator:exec npx agent-device <command>');
  });

  it('tells an argent session to link its local client', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'ArgentRunSessionRemoteConfig' as const,
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-token',
        webPreviewUrl: null,
      },
      'dotenv'
    );

    expect(instructions).toContain('link your local Argent client');
    expect(instructions).toContain("--token 'argent-token'");
  });
});

describe(formatSimulatorUnavailableMessage, () => {
  it('names the account and points at the waitlist', () => {
    const message = formatSimulatorUnavailableMessage('acme');

    expect(message).toContain('acme');
    expect(message).toContain(EAS_SIMULATOR_WAITLIST_URL);
  });
});

const controllerConfigs: DeviceRunSessionRemoteConfig[] = [
  agentDeviceConfig,
  iosAppiumConfig,
  { __typename: 'ArgentRunSessionRemoteConfig', toolsUrl: 'https://argent.example.test' },
  { __typename: 'ServeSimRunSessionRemoteConfig', previewUrl: 'https://preview.example.test' },
  {
    __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
    previewUrl: 'https://preview.example.test',
  },
];

describe.each(controllerConfigs)('$__typename local egress', remoteConfig => {
  const egress = {
    egressUrl: 'https://egress.example.test',
    egressToken: 'egress-secret',
    egressFingerprint: 'fp=',
    egressPort: 8899,
  };

  it('preserves controller variables and provides egress credentials and instructions', () => {
    const withEgress = { ...remoteConfig, ...egress };
    expect(getRemoteSessionEnvironmentVariables(withEgress)).toEqual({
      ...getRemoteSessionEnvironmentVariables(remoteConfig),
      EAS_SIMULATOR_EGRESS_URL: egress.egressUrl,
      EAS_SIMULATOR_EGRESS_TOKEN: egress.egressToken,
      EAS_SIMULATOR_EGRESS_FINGERPRINT: egress.egressFingerprint,
      EAS_SIMULATOR_EGRESS_PORT: '8899',
      EAS_SIMULATOR_EGRESS_ALLOW: '',
      EAS_SIMULATOR_EGRESS_PLATFORM: 'ios',
    });
    expect(getLocalEgressConfig(withEgress)).toEqual({
      url: egress.egressUrl,
      token: egress.egressToken,
      fingerprint: egress.egressFingerprint,
      port: 8899,
      allow: [],
      platform: AppPlatform.Ios,
    });
    const dotenvInstructions = formatRemoteSessionInstructions(withEgress, 'dotenv');
    expect(dotenvInstructions).toContain('eas simulator:egress');
    expect(dotenvInstructions).not.toContain(egress.egressToken);
    expect(formatRemoteSessionInstructions(withEgress, 'env')).toContain(
      'eas simulator:egress --config-type env'
    );
    expect(formatRemoteSessionInstructions(withEgress, 'env')).toContain(
      "export EAS_SIMULATOR_EGRESS_TOKEN='egress-secret'"
    );
  });

  it('does not start a tunnel from absent or incomplete egress credentials', () => {
    expect(getLocalEgressConfig(remoteConfig)).toBeNull();
    expect(getLocalEgressConfig({ ...remoteConfig, ...egress, egressToken: null })).toBeNull();
    expect(formatRemoteSessionInstructions(remoteConfig, 'dotenv')).not.toContain(
      'eas simulator:egress'
    );
  });
});

describe(getPreviewApiAccess, () => {
  it('reads the preview token for each remote config type', () => {
    expect(
      getPreviewApiAccess({
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
        previewUrl: 'https://expo.dev/preview',
        previewToken: 'preview-token',
        previewApiUrl: 'https://sim.example.test',
      })
    ).toEqual({ apiUrl: 'https://sim.example.test', token: 'preview-token' });
    expect(
      getPreviewApiAccess({
        __typename: 'AgentDeviceRunSessionRemoteConfig',
        agentDeviceRemoteSessionUrl: 'https://agent.example.test',
        agentDeviceRemoteSessionToken: 'agent-token',
        webPreviewToken: 'preview-token',
        previewApiUrl: 'https://sim.example.test',
      })
    ).toEqual({ apiUrl: 'https://sim.example.test', token: 'preview-token' });
  });

  it('returns null without an API URL or a token', () => {
    expect(
      getPreviewApiAccess({
        __typename: 'ServeSimRunSessionRemoteConfig',
        previewUrl: 'https://sim.example.test',
        previewToken: 'preview-token',
      })
    ).toBeNull();
    expect(
      getPreviewApiAccess({
        __typename: 'ServeSimRunSessionRemoteConfig',
        previewUrl: 'https://sim.example.test',
        previewApiUrl: 'https://sim.example.test',
      })
    ).toBeNull();
  });
});

describe(formatEmbedPreviewUrl, () => {
  it('is null until the worker reports the preview host', () => {
    expect(formatEmbedPreviewUrl(agentDeviceConfig)).toBeNull();
    expect(
      formatEmbedPreviewUrl({
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: 'https://expo.dev/simulator-preview/abc',
        previewToken: 'tok-2',
      })
    ).toBeNull();
  });

  it('adds the preview token to the preview host address', () => {
    expect(
      formatEmbedPreviewUrl({
        ...agentDeviceConfig,
        previewApiUrl: 'https://web-preview.example.test',
        webPreviewToken: 'tok-1',
      })
    ).toBe('https://web-preview.example.test/?token=tok-1');
    expect(
      formatEmbedPreviewUrl({
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: 'https://expo.dev/simulator-preview/abc',
        previewToken: 'tok-2',
        previewApiUrl: 'https://web-preview.example.test',
      })
    ).toBe('https://web-preview.example.test/?token=tok-2');
  });
});

describe('embed instructions', () => {
  const config = {
    ...agentDeviceConfig,
    previewApiUrl: 'https://web-preview.example.test',
    webPreviewToken: 'tok-1',
  };

  it('prints the embed URL and the allowed origins', () => {
    const instructions = formatRemoteSessionInstructions(config, 'dotenv', {
      frameAncestors: ['https://embed.example.test', 'https://*.example.test'],
    });
    expect(instructions).toContain(
      'Pages on https://embed.example.test, https://*.example.test may embed the preview'
    );
    expect(instructions).toContain('https://web-preview.example.test/?token=tok-1');
  });

  it('says the host is not reported yet when the preview address is missing', () => {
    const instructions = formatRemoteSessionInstructions(agentDeviceConfig, 'dotenv', {
      frameAncestors: ['https://embed.example.test'],
    });
    expect(instructions).toContain('has not reported its address yet');
  });

  it('adds the embed URL before the local egress instructions', () => {
    const instructions = formatRemoteSessionInstructions(
      { ...config, ...agentDeviceConfigWithEgress, previewApiUrl: config.previewApiUrl },
      'dotenv',
      { frameAncestors: ['https://embed.example.test'] }
    );
    expect(instructions.indexOf('tok-1')).toBeLessThan(
      instructions.indexOf('eas simulator:egress')
    );
  });

  it('prints the API URL and the CORS origins', () => {
    const instructions = formatRemoteSessionInstructions(config, 'dotenv', {
      corsOrigins: ['https://app.example.test'],
    });
    expect(instructions).toContain('Pages on https://app.example.test may call the preview API');
    expect(instructions).not.toContain('embed the preview in a frame');
    expect(instructions).toContain('https://web-preview.example.test/?token=tok-1');
  });

  it('lists both grants when frame ancestors and CORS origins are set', () => {
    const instructions = formatRemoteSessionInstructions(config, 'dotenv', {
      frameAncestors: ['https://embed.example.test'],
      corsOrigins: ['https://app.example.test'],
    });
    expect(instructions).toContain('may embed the preview in a frame.');
    expect(instructions).toContain('may call the preview API');
  });

  it('says nothing about embedding without frame ancestors', () => {
    expect(formatRemoteSessionInstructions(config, 'dotenv')).not.toContain('embed the preview');
    expect(formatRemoteSessionInstructions(config, 'dotenv')).not.toContain('tok-1');
  });
});

describe(stripTerminalControlCharacters, () => {
  it('removes terminal escapes and all control characters by default', () => {
    expect(stripTerminalControlCharacters('\u001b[31mhello\u001b[0m\u0007\n\tworld\u009b')).toBe(
      'helloworld'
    );
  });

  it('keeps newlines and tabs when requested', () => {
    expect(
      stripTerminalControlCharacters('\u001b[31mhello\u001b[0m\u0007\n\tworld', {
        keepNewlinesAndTabs: true,
      })
    ).toBe('hello\n\tworld');
  });
});

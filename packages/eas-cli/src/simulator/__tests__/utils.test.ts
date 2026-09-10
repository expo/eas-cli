import { DeviceRunSessionResourceClass, DeviceRunSessionType } from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  DeviceRunSessionRemoteConfig,
  EAS_SIMULATOR_WAITLIST_URL,
  deviceRunSessionTypeToFlagValue,
  formatLoopbackForwardNotice,
  formatPreviewUrl,
  formatRemoteSessionInstructions,
  formatSimulatorUnavailableMessage,
  getLocalEgressConfig,
  getLoopbackForwardPlan,
  getRemoteSessionEnvironmentVariables,
  sanitizeRemoteConfigForJson,
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
    });
    expect(getRemoteSessionEnvironmentVariables(agentDeviceConfigWithEgress)).toEqual({
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent-device.example.test',
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'daemon-token',
      EAS_SIMULATOR_EGRESS_URL: 'https://egress-abc.eas-simulator.ngrok.dev',
      EAS_SIMULATOR_EGRESS_TOKEN: 'egress-secret',
      EAS_SIMULATOR_EGRESS_FINGERPRINT: 'fp=',
      EAS_SIMULATOR_EGRESS_PORT: '8899',
      EAS_SIMULATOR_EGRESS_ALLOW: '',
    });
    const instructions = formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv');
    expect(instructions).toContain('eas simulator:egress');
    expect(instructions).toContain('Run the egress client to connect the tunnel');
    expect(instructions).toContain('Keep it running for the life of the session.');
    expect(instructions).not.toContain('may reach');
    expect(formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'env')).toContain(
      "export EAS_SIMULATOR_EGRESS_ALLOW=''"
    );
  });

  it('describes the inline egress client instead of asking the reader to start one', () => {
    const instructions = formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv', {
      egressClientRunsInline: true,
    });
    expect(instructions).toContain('The egress client runs in this terminal');
    expect(instructions).toContain(
      'reconnect the tunnel from another shell with:\n\neas simulator:egress'
    );
    expect(instructions).not.toContain('Run the egress client to connect the tunnel');
    expect(instructions).not.toContain('Keep it running');

    expect(
      formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'env', {
        egressClientRunsInline: true,
      })
    ).toContain('eas simulator:egress --config-type env');
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
      "The simulator may reach localhost:3000, 192.168.1.20:8080 on this machine's network."
    );
    expect(instructions).toContain(
      '127.0.0.1:3000 in the simulator reaches the same port on this machine (like adb reverse)'
    );
  });

  it('omits the loopback forwarding notice when no allowed destination is loopback', () => {
    expect(
      formatRemoteSessionInstructions(agentDeviceConfigWithEgress, 'dotenv', {
        egressAllow: ['192.168.1.20:8080'],
      })
    ).not.toContain('adb reverse');
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
});

describe(formatLoopbackForwardNotice, () => {
  it('describes forwarded ports and name-only entries', () => {
    expect(formatLoopbackForwardNotice({ ports: [3000, 8082], skipped: ['localhost:80'] })).toEqual(
      [
        '127.0.0.1:3000, 127.0.0.1:8082 in the simulator reach the same ports on this machine (like adb reverse), so dev server URLs that use 127.0.0.1 work.',
        'localhost:80 is reachable by name only: privileged ports and the egress proxy port are not forwarded to 127.0.0.1 in the simulator.',
      ]
    );
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
  it('appends the session token for a gated preview', () => {
    expect(formatPreviewUrl('https://preview.example.test', 'tok-1')).toBe(
      'https://preview.example.test/?token=tok-1'
    );
  });

  it('leaves the url alone when the preview is ungated', () => {
    expect(formatPreviewUrl('https://preview.example.test', null)).toBe(
      'https://preview.example.test'
    );
    expect(formatPreviewUrl('https://preview.example.test', undefined)).toBe(
      'https://preview.example.test'
    );
  });
});

describe(sanitizeRemoteConfigForJson, () => {
  const PREVIEW_URL = 'https://preview.example.test';

  it('moves the token into the preview url and drops the standalone field', () => {
    const sanitized = sanitizeRemoteConfigForJson({
      __typename: 'ServeSimRunSessionRemoteConfig' as const,
      previewUrl: PREVIEW_URL,
      previewToken: 'tok-1',
    });

    expect(sanitized).toEqual({
      __typename: 'ServeSimRunSessionRemoteConfig',
      previewUrl: `${PREVIEW_URL}/?token=tok-1`,
    });
    expect(JSON.stringify(sanitized)).not.toContain('previewToken');
  });

  it('does the same for a controller session', () => {
    const sanitized = sanitizeRemoteConfigForJson({
      __typename: 'ArgentRunSessionRemoteConfig' as const,
      toolsUrl: 'https://argent.example.test',
      toolsAuthToken: 'argent-token',
      webPreviewUrl: PREVIEW_URL,
      webPreviewToken: 'tok-1',
    });

    expect(sanitized).toMatchObject({ webPreviewUrl: `${PREVIEW_URL}/?token=tok-1` });
    expect(JSON.stringify(sanitized)).not.toContain('webPreviewToken');
    // The controller credential is a different secret and stays: it is what simulator:exec needs.
    expect(sanitized).toMatchObject({ toolsAuthToken: 'argent-token' });
  });

  it('leaves an ungated session untouched', () => {
    const remoteConfig = {
      __typename: 'ServeSimRunSessionRemoteConfig' as const,
      previewUrl: PREVIEW_URL,
      previewToken: null,
    };

    expect(sanitizeRemoteConfigForJson(remoteConfig)).toEqual({
      __typename: 'ServeSimRunSessionRemoteConfig',
      previewUrl: PREVIEW_URL,
    });
  });

  it('leaves a controller session with no web preview alone', () => {
    const sanitized = sanitizeRemoteConfigForJson({
      __typename: 'AppiumRunSessionRemoteConfig' as const,
      appiumUrl: 'https://appium.example.test',
      capabilities: {},
      webPreviewUrl: null,
      webPreviewToken: null,
    });

    expect(sanitized).toMatchObject({ webPreviewUrl: null });
  });
});

describe('gated preview links', () => {
  const PREVIEW = 'https://preview.example.test';
  const GATED = `${PREVIEW}/?token=tok-1`;

  it('prints the tokenized preview for a serve-sim session', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW,
        previewToken: 'tok-1',
      },
      'env'
    );

    expect(instructions).toContain(GATED);
  });

  it('prints the tokenized preview for a web-preview-only session', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW,
        previewToken: 'tok-1',
      },
      'env'
    );

    expect(instructions).toContain(GATED);
  });

  it('prints the tokenized preview for every controller session type', () => {
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
      expect(formatRemoteSessionInstructions(remoteConfig, 'env')).toContain(GATED);
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
    });
    expect(getLocalEgressConfig(withEgress)).toEqual({
      url: egress.egressUrl,
      token: egress.egressToken,
      fingerprint: egress.egressFingerprint,
      port: 8899,
      allow: [],
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

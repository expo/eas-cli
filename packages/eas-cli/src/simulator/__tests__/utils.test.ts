import { DeviceRunSessionResourceClass, DeviceRunSessionType } from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  EAS_SIMULATOR_WAITLIST_URL,
  deviceRunSessionTypeToFlagValue,
  formatRemoteSessionInstructions,
  formatSimulatorUnavailableMessage,
  getRemoteSessionEnvironmentVariables,
  remoteConfigWithPreviewPageUrl,
  simulatorPreviewUrl,
} from '../utils';

const tunnelUrl = 'https://web-preview-abc123.eas-simulator.ngrok.dev';
const previewPageUrl = 'https://expo.dev/simulator-preview/abc123';

const iosAppiumConfig = {
  __typename: 'AppiumRunSessionRemoteConfig' as const,
  appiumUrl: 'https://appium.example.test',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': 'simulator-id',
  },
  webPreviewUrl: tunnelUrl,
};

const agentDeviceConfig = {
  __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
  agentDeviceRemoteSessionUrl: 'https://agent.example.com',
  agentDeviceRemoteSessionToken: 'token-123',
  webPreviewUrl: tunnelUrl,
};

const argentConfig = {
  __typename: 'ArgentRunSessionRemoteConfig' as const,
  toolsUrl: 'https://argent.example.test',
  toolsAuthToken: 'argent-token',
  webPreviewUrl: tunnelUrl,
};

const serveSimConfig = {
  __typename: 'ServeSimRunSessionRemoteConfig' as const,
  previewUrl: tunnelUrl,
};

const webPreviewOnlyConfig = {
  __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
  previewUrl: tunnelUrl,
};

describe(remoteConfigWithPreviewPageUrl, () => {
  it('rewrites the preview url a controller session reports', () => {
    const remoteConfig = remoteConfigWithPreviewPageUrl(iosAppiumConfig);

    expect(remoteConfig).toMatchObject({
      webPreviewUrl: 'https://expo.dev/simulator-preview/abc123',
    });
  });

  it('rewrites the preview url a web-preview-only session reports', () => {
    const remoteConfig = remoteConfigWithPreviewPageUrl(webPreviewOnlyConfig);

    expect(remoteConfig).toMatchObject({
      previewUrl: previewPageUrl,
    });
  });

  it('rewrites the preview url a serve-sim session reports', () => {
    expect(remoteConfigWithPreviewPageUrl(serveSimConfig)).toMatchObject({
      previewUrl: previewPageUrl,
    });
  });

  it('leaves a config with no preview url alone', () => {
    const remoteConfig = remoteConfigWithPreviewPageUrl({
      ...iosAppiumConfig,
      webPreviewUrl: null,
    });

    expect(remoteConfig).toMatchObject({ webPreviewUrl: null });
  });

  it('leaves a serve-sim config with an empty preview url alone', () => {
    expect(
      remoteConfigWithPreviewPageUrl({
        ...serveSimConfig,
        previewUrl: '',
      })
    ).toMatchObject({ previewUrl: '' });
  });
});

describe(simulatorPreviewUrl, () => {
  it('points at the preview page for the session', () => {
    expect(simulatorPreviewUrl('https://web-preview-abc123.eas-simulator.ngrok.dev')).toBe(
      'https://expo.dev/simulator-preview/abc123'
    );
  });

  it.each(['https://appium-abc123.eas-simulator.ngrok.dev', 'not-a-url', ''])(
    'falls back to what it was given when there is no preview host: %p',
    url => {
      expect(simulatorPreviewUrl(url)).toBe(url);
    }
  );

  it('points at the website the cli is talking to', () => {
    process.env.EXPO_STAGING = '1';
    try {
      expect(simulatorPreviewUrl('https://web-preview-abc123.eas-simulator.ngrok.dev')).toBe(
        'https://staging.expo.dev/simulator-preview/abc123'
      );
    } finally {
      delete process.env.EXPO_STAGING;
    }
  });

  it('drops everything the tunnel url carries', () => {
    expect(
      simulatorPreviewUrl(
        'https://web-preview-abc123.eas-simulator.ngrok.dev/session?token=secret#frame'
      )
    ).toBe('https://expo.dev/simulator-preview/abc123');
  });
});

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
    expect(instructions).toContain(previewPageUrl);
    expect(instructions).toContain('Open the simulator preview:');
    expect(instructions).not.toContain('iOS simulator preview');
    expect(instructions).not.toContain('https://appium.example.test');
  });

  it('prints Appium export lines when outputting env', () => {
    const instructions = formatRemoteSessionInstructions(iosAppiumConfig, 'env');

    expect(instructions).toContain("export APPIUM_URL='https://appium.example.test'");
    expect(instructions).toContain(previewPageUrl);
  });

  it('omits the preview when an Appium session has none', () => {
    const instructions = formatRemoteSessionInstructions(
      { ...iosAppiumConfig, webPreviewUrl: null },
      'dotenv'
    );

    expect(instructions).not.toContain('Open the simulator preview:');
  });
});

describe(formatSimulatorUnavailableMessage, () => {
  it('points gated accounts at the waitlist', () => {
    const message = formatSimulatorUnavailableMessage('acme');

    expect(message).toContain("isn't available on acme yet");
    expect(message).toContain(EAS_SIMULATOR_WAITLIST_URL);
  });
});

describe(getRemoteSessionEnvironmentVariables, () => {
  it('maps Argent tools and token', () => {
    expect(getRemoteSessionEnvironmentVariables(argentConfig)).toEqual({
      ARGENT_TOOLS_URL: 'https://argent.example.test',
      ARGENT_AUTH_TOKEN: 'argent-token',
    });
  });

  it('omits the Argent token when it is missing', () => {
    expect(
      getRemoteSessionEnvironmentVariables({
        ...argentConfig,
        toolsAuthToken: null,
      })
    ).toEqual({
      ARGENT_TOOLS_URL: 'https://argent.example.test',
    });
  });

  it('returns no env for a preview-only session', () => {
    expect(getRemoteSessionEnvironmentVariables(webPreviewOnlyConfig)).toEqual({});
    expect(getRemoteSessionEnvironmentVariables(serveSimConfig)).toEqual({});
  });
});

describe(formatRemoteSessionInstructions, () => {
  it('prints the preview page for an agent-device dotenv session', () => {
    const instructions = formatRemoteSessionInstructions(agentDeviceConfig, 'dotenv');

    expect(instructions).toContain('eas simulator:exec npx agent-device <command>');
    expect(instructions).toContain(previewPageUrl);
  });

  it('prints export lines for an agent-device env session', () => {
    const instructions = formatRemoteSessionInstructions(agentDeviceConfig, 'env');

    expect(instructions).toContain(
      "export AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'"
    );
    expect(instructions).toContain(previewPageUrl);
  });

  it('omits the preview when an agent-device session has none', () => {
    expect(
      formatRemoteSessionInstructions({ ...agentDeviceConfig, webPreviewUrl: null }, 'dotenv')
    ).not.toContain('preview the simulator');
  });

  it('prints an Argent link with a token for dotenv', () => {
    const instructions = formatRemoteSessionInstructions(argentConfig, 'dotenv');

    expect(instructions).toContain(
      "argent link 'https://argent.example.test' --token 'argent-token' --yes"
    );
    expect(instructions).toContain(previewPageUrl);
  });

  it('omits the token flag when Argent has none', () => {
    expect(
      formatRemoteSessionInstructions({ ...argentConfig, toolsAuthToken: null }, 'dotenv')
    ).toContain("argent link 'https://argent.example.test' --yes");
  });

  it('prints Argent export lines for env', () => {
    const instructions = formatRemoteSessionInstructions(argentConfig, 'env');

    expect(instructions).toContain("export ARGENT_TOOLS_URL='https://argent.example.test'");
    expect(instructions).toContain(previewPageUrl);
  });

  it('omits the preview when an Argent session has none', () => {
    expect(
      formatRemoteSessionInstructions({ ...argentConfig, webPreviewUrl: null }, 'env')
    ).not.toContain('preview the simulator');
  });

  it('prints the preview page for a serve-sim session', () => {
    expect(formatRemoteSessionInstructions(serveSimConfig, 'env')).toContain(previewPageUrl);
  });

  it('prints the preview page for a web-preview-only session', () => {
    expect(formatRemoteSessionInstructions(webPreviewOnlyConfig, 'dotenv')).toContain(
      previewPageUrl
    );
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

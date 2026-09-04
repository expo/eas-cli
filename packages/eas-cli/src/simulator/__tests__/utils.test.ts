import { DeviceRunSessionResourceClass, DeviceRunSessionType } from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  EAS_SIMULATOR_WAITLIST_URL,
  deviceRunSessionTypeToFlagValue,
  formatPreviewUrl,
  formatRemoteSessionInstructions,
  formatSimulatorUnavailableMessage,
  getRemoteSessionEnvironmentVariables,
  sanitizeRemoteConfigForJson,
} from '../utils';

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

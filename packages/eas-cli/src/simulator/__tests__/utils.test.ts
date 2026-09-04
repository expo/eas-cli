import { DeviceRunSessionResourceClass, DeviceRunSessionType } from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  deviceRunSessionTypeToFlagValue,
  formatRemoteSessionInstructions,
  getRemoteSessionEnvironmentVariables,
  remoteConfigWithPreviewPageUrl,
  simulatorPreviewUrl,
} from '../utils';

const iosAppiumConfig = {
  __typename: 'AppiumRunSessionRemoteConfig' as const,
  appiumUrl: 'https://appium.example.test',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': 'simulator-id',
  },
  webPreviewUrl: 'https://web-preview-abc123.eas-simulator.ngrok.dev',
};

describe(remoteConfigWithPreviewPageUrl, () => {
  it('rewrites the preview url a controller session reports', () => {
    const remoteConfig = remoteConfigWithPreviewPageUrl(iosAppiumConfig);

    expect(remoteConfig).toMatchObject({
      webPreviewUrl: 'https://expo.dev/simulator-preview/abc123',
    });
  });

  it('rewrites the preview url a web-preview-only session reports', () => {
    const remoteConfig = remoteConfigWithPreviewPageUrl({
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig' as const,
      previewUrl: 'https://web-preview-abc123.eas-simulator.ngrok.dev',
    });

    expect(remoteConfig).toMatchObject({
      previewUrl: 'https://expo.dev/simulator-preview/abc123',
    });
  });

  it('leaves a config with no preview url alone', () => {
    const remoteConfig = remoteConfigWithPreviewPageUrl({
      ...iosAppiumConfig,
      webPreviewUrl: null,
    });

    expect(remoteConfig).toMatchObject({ webPreviewUrl: null });
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
    expect(instructions).toContain('https://expo.dev/simulator-preview/abc123');
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

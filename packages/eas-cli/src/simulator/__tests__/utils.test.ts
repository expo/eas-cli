import { DeviceRunSessionResourceClass, DeviceRunSessionType } from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  deviceRunSessionTypeToFlagValue,
  formatRemoteSessionInstructions,
  getRemoteSessionEnvironmentVariables,
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

describe('managed simulator instructions', () => {
  it('runs agent-device with bunx', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig',
        agentDeviceRemoteSessionUrl: 'https://agent.example.test',
        agentDeviceRemoteSessionToken: 'agent-token',
      },
      'dotenv'
    );

    expect(instructions).toContain('eas simulator:exec bunx agent-device <command>');
    expect(instructions).not.toContain('npx agent-device');
  });

  it('runs Argent with bunx', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'ArgentRunSessionRemoteConfig',
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-token',
      },
      'dotenv'
    );

    expect(instructions).toContain(
      "bunx @swmansion/argent link 'https://argent.example.test' --token 'argent-token' --yes"
    );
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

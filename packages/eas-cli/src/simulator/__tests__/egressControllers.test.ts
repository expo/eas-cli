import { parse as parseDotenv } from 'dotenv';
import * as fs from 'fs-extra';

import { readLocalEgressConfigFromEnv } from '../egress';
import { writeSimulatorEnvAsync } from '../env';
import {
  DeviceRunSessionRemoteConfig,
  formatRemoteSessionInstructions,
  getRemoteSessionEnvironmentVariables,
} from '../utils';

jest.mock('fs-extra');

const configs: DeviceRunSessionRemoteConfig[] = [
  {
    __typename: 'AgentDeviceRunSessionRemoteConfig',
    agentDeviceRemoteSessionUrl: 'https://agent.example.test',
    agentDeviceRemoteSessionToken: 'agent-token',
  },
  { __typename: 'ArgentRunSessionRemoteConfig', toolsUrl: 'https://argent.example.test' },
  {
    __typename: 'AppiumRunSessionRemoteConfig',
    appiumUrl: 'https://appium.example.test',
    capabilities: { platformName: 'iOS' },
  },
  {
    __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
    previewUrl: 'https://preview.example.test',
  },
  { __typename: 'ServeSimRunSessionRemoteConfig', previewUrl: 'https://preview.example.test' },
];

const egressFields = {
  egressUrl: 'https://egress.example.test',
  egressToken: 'test-egress-token',
  egressFingerprint: 'test-fingerprint',
  egressPort: 8899,
};

describe('egress exceptions across simulator controllers', () => {
  beforeEach(() => {
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
  });

  it.each(configs)('persists only the requested exceptions for $__typename', async config => {
    const remoteConfig = { ...config, ...egressFields };
    const egressAllow = ['localhost:3000', '[::1]:4000'];
    const environment = getRemoteSessionEnvironmentVariables(remoteConfig, { egressAllow });
    await writeSimulatorEnvAsync('/test/project', environment);
    const content = String(jest.mocked(fs.writeFile).mock.calls.at(-1)?.[1]);
    expect(readLocalEgressConfigFromEnv(parseDotenv(content))).toEqual({
      url: egressFields.egressUrl,
      token: egressFields.egressToken,
      fingerprint: egressFields.egressFingerprint,
      port: 8899,
      allow: egressAllow,
    });
    const instructions = formatRemoteSessionInstructions(remoteConfig, 'dotenv', { egressAllow });
    expect(instructions).toContain('eas simulator:egress');
    expect(instructions).toContain('localhost:3000, [::1]:4000');
  });

  it.each(configs)(
    'explicitly clears exceptions for $__typename when none are requested',
    config => {
      const environment = getRemoteSessionEnvironmentVariables({ ...config, ...egressFields });
      expect(environment.EAS_SIMULATOR_EGRESS_ALLOW).toBe('');
      expect(
        readLocalEgressConfigFromEnv({
          EAS_SIMULATOR_EGRESS_ALLOW: 'localhost:9999',
          ...environment,
        }).allow
      ).toEqual([]);
    }
  );

  it.each(configs)('does not grant exceptions without an egress tunnel for $__typename', config => {
    expect(
      getRemoteSessionEnvironmentVariables(config, { egressAllow: ['localhost:3000'] })
    ).not.toHaveProperty('EAS_SIMULATOR_EGRESS_ALLOW');
    expect(
      formatRemoteSessionInstructions(config, 'dotenv', { egressAllow: ['localhost:3000'] })
    ).not.toContain('localhost:3000');
  });
});

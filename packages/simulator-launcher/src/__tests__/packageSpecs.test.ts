import {
  agentDevicePackageSpec,
  argentPackageSpec,
  getConfiguredToolVersions,
  serveSimPackageSpec,
} from '../utils/packageSpecs';

let environment: NodeJS.ProcessEnv;
beforeEach(() => {
  environment = { ...process.env };
  delete process.env.SERVE_SIM_VERSION;
  delete process.env.AGENT_DEVICE_VERSION;
  delete process.env.ARGENT_VERSION;
});
afterEach(() => {
  process.env = environment;
});

it('keeps standalone defaults without claiming a resolved version', () => {
  expect(serveSimPackageSpec()).toBe('@expo/serve-sim@latest');
  expect(agentDevicePackageSpec()).toBe('agent-device@latest');
  expect(argentPackageSpec()).toBe('@swmansion/argent@latest');
  expect(getConfiguredToolVersions()).toEqual({
    serveSimVersion: undefined,
    agentDeviceVersion: undefined,
    argentVersion: undefined,
  });
});

it('uses and reports exact supplied versions, including prereleases and build metadata', () => {
  process.env.SERVE_SIM_VERSION = '0.13.4-beta.1+build.2';
  process.env.AGENT_DEVICE_VERSION = '0.21.36';
  process.env.ARGENT_VERSION = '0.32.0';
  expect(getConfiguredToolVersions()).toEqual({
    serveSimVersion: '0.13.4-beta.1+build.2',
    agentDeviceVersion: '0.21.36',
    argentVersion: '0.32.0',
  });
  expect(serveSimPackageSpec()).toBe('@expo/serve-sim@0.13.4-beta.1+build.2');
  expect(agentDevicePackageSpec()).toBe('agent-device@0.21.36');
  expect(argentPackageSpec()).toBe('@swmansion/argent@0.32.0');
});

it.each(['latest', 'next', '^0.13', 'v0.13.4', '01.2.3', '1.2.3-01'])(
  'passes %s through without claiming an exact version',
  requested => {
    process.env.SERVE_SIM_VERSION = requested;
    expect(serveSimPackageSpec()).toBe(`@expo/serve-sim@${requested}`);
    expect(getConfiguredToolVersions().serveSimVersion).toBeUndefined();
  }
);

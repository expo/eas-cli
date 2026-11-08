// start and prefetch use these exact specs, so with pinned versions prefetch caches the packages
// that start runs.
export const serveSimPackageSpec = (): string =>
  `@expo/serve-sim@${process.env.SERVE_SIM_VERSION || 'latest'}`;

export const agentDevicePackageSpec = (): string =>
  `agent-device@${process.env.AGENT_DEVICE_VERSION || 'latest'}`;

export const argentPackageSpec = (): string =>
  `@swmansion/argent@${process.env.ARGENT_VERSION || 'latest'}`;

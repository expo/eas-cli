import { PackageVersionSchema } from './state';

export const serveSimPackageSpec = (): string =>
  `@expo/serve-sim@${process.env.SERVE_SIM_VERSION || 'latest'}`;

export const agentDevicePackageSpec = (): string =>
  `agent-device@${process.env.AGENT_DEVICE_VERSION || 'latest'}`;

export const argentPackageSpec = (): string =>
  `@swmansion/argent@${process.env.ARGENT_VERSION || 'latest'}`;

/** Report exact caller-supplied versions. Tags/ranges remain unknown until the package runs. */
export function getConfiguredToolVersions(): {
  serveSimVersion?: string;
  agentDeviceVersion?: string;
  argentVersion?: string;
} {
  const exact = (value: string | undefined): string | undefined =>
    PackageVersionSchema.safeParse(value).success ? value : undefined;
  return {
    serveSimVersion: exact(process.env.SERVE_SIM_VERSION),
    agentDeviceVersion: exact(process.env.AGENT_DEVICE_VERSION),
    argentVersion: exact(process.env.ARGENT_VERSION),
  };
}

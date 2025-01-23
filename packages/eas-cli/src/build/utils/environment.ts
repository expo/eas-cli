import { BuildProfile } from '@expo/eas-json';

import { EnvironmentVariableEnvironment } from '../../graphql/generated';

type Environment = NonNullable<BuildProfile['environment']>;

const BuildProfileEnvironmentToEnvironment: Record<Environment, EnvironmentVariableEnvironment> = {
  production: EnvironmentVariableEnvironment.Production,
  preview: EnvironmentVariableEnvironment.Preview,
  development: EnvironmentVariableEnvironment.Development,
};

export function isEnvironment(env: string): env is EnvironmentVariableEnvironment {
  return Object.values(EnvironmentVariableEnvironment).includes(
    env as EnvironmentVariableEnvironment
  );
}

export function buildProfileEnvironmentToEnvironment(
  environment: BuildProfile['environment']
): EnvironmentVariableEnvironment | null {
  if (!environment) {
    return null;
  }
  return BuildProfileEnvironmentToEnvironment[environment];
}

import { BuildProfile } from '@expo/eas-json';

type Environment = NonNullable<BuildProfile['environment']>;

// Default environments
export enum EnvironmentVariableEnvironment {
  Development = 'development',
  Preview = 'preview',
  Production = 'production',
}

const BuildProfileEnvironmentToEnvironment: Record<Environment, EnvironmentVariableEnvironment> = {
  production: EnvironmentVariableEnvironment.Production,
  preview: EnvironmentVariableEnvironment.Preview,
  development: EnvironmentVariableEnvironment.Development,
};

export function isEnvironment(env: string): env is EnvironmentVariableEnvironment {
  return Object.values(EnvironmentVariableEnvironment).includes(
    env.toLowerCase() as EnvironmentVariableEnvironment
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

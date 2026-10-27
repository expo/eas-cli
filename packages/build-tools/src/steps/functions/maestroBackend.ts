import { UserError } from '@expo/eas-build-job';
import { BuildStepEnv } from '@expo/steps';
import { z } from 'zod';

export const MaestroBackendSchema = z.enum(['maestro', 'maestro-runner']).default('maestro');

export type MaestroBackend = z.output<typeof MaestroBackendSchema>;

export function resolveMaestroBackend({
  input,
  env,
}: {
  input: unknown;
  env: BuildStepEnv;
}): MaestroBackend {
  const result = MaestroBackendSchema.safeParse(input || env.EAS_MAESTRO_BACKEND || undefined);
  if (!result.success) {
    throw new UserError(
      'ERR_MAESTRO_INVALID_INPUT',
      'backend and EAS_MAESTRO_BACKEND must be either "maestro" or "maestro-runner".',
      { cause: result.error }
    );
  }
  return result.data;
}

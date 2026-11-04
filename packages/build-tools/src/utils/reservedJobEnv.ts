import {
  BUILT_IN_ENVIRONMENT_VARIABLES_DOCS_URL,
  Env,
  UserError,
  reservedEasBuildEnvironmentVariableNames,
} from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';

export function warnOrThrowIfJobOverridesReservedEnvironmentVariables({
  jobEnv,
  workerEnv,
  logger,
}: {
  jobEnv: Env | undefined;
  workerEnv: Env | undefined;
  logger: bunyan;
}): void {
  const reservedNames = reservedEasBuildEnvironmentVariableNames(jobEnv);
  if (reservedNames.length === 0) {
    return;
  }

  logger.warn(
    `This job sets reserved environment variable(s) ${reservedNames.join(', ')}. EAS injects these for the worker; overwriting them can break the job. See ${BUILT_IN_ENVIRONMENT_VARIABLES_DOCS_URL}`
  );

  const jobBuildId = jobEnv?.EAS_BUILD_ID;
  const workerBuildId = workerEnv?.EAS_BUILD_ID;
  if (jobBuildId && workerBuildId && jobBuildId !== workerBuildId) {
    throw new UserError(
      'EAS_RESERVED_ENV_EAS_BUILD_ID',
      `This job sets EAS_BUILD_ID to "${jobBuildId}", which replaces the worker's job id (${workerBuildId}). Custom jobs use EAS_BUILD_ID to fetch project sources, so Prepare project fails. Rename the variable in your workflow. See ${BUILT_IN_ENVIRONMENT_VARIABLES_DOCS_URL}`,
      { docsUrl: BUILT_IN_ENVIRONMENT_VARIABLES_DOCS_URL }
    );
  }
}

/**
 * Environment variable names EAS injects into every job. Setting them in
 * workflow `env` (or `builderEnvironment.env`) overwrites the worker values.
 *
 * `EAS_BUILD_ID` is the dangerous one: custom jobs use it to fetch their own
 * project sources (`/v2/turtle-job-runs/<id>/download-project-archive`).
 *
 * Keep in sync with
 * https://docs.expo.dev/eas/environment-variables/usage/#built-in-environment-variables
 */
export const BUILT_IN_ENVIRONMENT_VARIABLES_DOCS_URL =
  'https://docs.expo.dev/eas/environment-variables/usage/#built-in-environment-variables';

export function isReservedEasBuildEnvironmentVariableName(name: string): boolean {
  return name === 'EAS_BUILD' || name.startsWith('EAS_BUILD_');
}

export function reservedEasBuildEnvironmentVariableNames(
  env: Record<string, unknown> | null | undefined
): string[] {
  if (!env || typeof env !== 'object') {
    return [];
  }
  return Object.keys(env).filter(isReservedEasBuildEnvironmentVariableName).sort();
}

export type WorkflowReservedEnvUsage = {
  jobId: string;
  path: string;
  names: string[];
};

export function formatReservedEasBuildEnvironmentVariableWarning(
  usages: WorkflowReservedEnvUsage[]
): string | null {
  if (usages.length === 0) {
    return null;
  }
  const details = usages.map(usage => `- ${usage.path}: ${usage.names.join(', ')}`).join('\n');
  return [
    'This workflow sets reserved EAS environment variable(s) that the worker already injects.',
    'Overwriting them can break the job — especially EAS_BUILD_ID, which custom jobs use to fetch project sources.',
    details,
    `See ${BUILT_IN_ENVIRONMENT_VARIABLES_DOCS_URL}`,
  ].join('\n');
}

export function findReservedEasBuildEnvironmentVariablesInWorkflow(
  parsedYaml: unknown
): WorkflowReservedEnvUsage[] {
  const usages: WorkflowReservedEnvUsage[] = [];
  if (!parsedYaml || typeof parsedYaml !== 'object') {
    return usages;
  }
  const root = parsedYaml as Record<string, unknown>;

  collectEnvUsages('(defaults)', 'defaults.env', getRecord(root.defaults)?.env, usages);

  const jobs = getRecord(root.jobs);
  if (!jobs) {
    return usages;
  }

  for (const [jobId, jobValue] of Object.entries(jobs)) {
    const job = getRecord(jobValue);
    if (!job) {
      continue;
    }
    collectEnvUsages(jobId, `jobs.${jobId}.env`, job.env, usages);
    collectStepEnvUsages(jobId, `jobs.${jobId}.steps`, job.steps, usages);

    const hooks = getRecord(job.hooks);
    if (hooks) {
      for (const [hookId, hookSteps] of Object.entries(hooks)) {
        collectStepEnvUsages(jobId, `jobs.${jobId}.hooks.${hookId}`, hookSteps, usages);
      }
    }
  }

  return usages;
}

function collectStepEnvUsages(
  jobId: string,
  pathPrefix: string,
  steps: unknown,
  usages: WorkflowReservedEnvUsage[]
): void {
  if (!Array.isArray(steps)) {
    return;
  }
  steps.forEach((step, index) => {
    const stepRecord = getRecord(step);
    collectEnvUsages(jobId, `${pathPrefix}[${index}].env`, stepRecord?.env, usages);
  });
}

function collectEnvUsages(
  jobId: string,
  path: string,
  env: unknown,
  usages: WorkflowReservedEnvUsage[]
): void {
  const names = reservedEasBuildEnvironmentVariableNames(getRecord(env));
  if (names.length > 0) {
    usages.push({ jobId, path, names });
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

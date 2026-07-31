import { buildLocalCompositeFunctionCatalogAsync } from '@expo/steps';

import Log from '../../log';

export async function validateWorkflowLocalCompositeFunctionsAsync(
  parsedYaml: any,
  projectDir: string
): Promise<void> {
  await buildLocalCompositeFunctionCatalogAsync(projectDir, {
    rootSteps: stepsFromWorkflow(parsedYaml),
    logger: {
      debug: message => {
        Log.debug(message);
      },
    },
  });
}

function stepsFromWorkflow(parsedYaml: any): any[] {
  const jobs = parsedYaml?.jobs;
  if (!jobs || typeof jobs !== 'object') {
    return [];
  }
  return Object.entries(jobs).flatMap(([jobKey, job]: [string, any]) => {
    if (hasCustomProjectRootDirectory(job)) {
      Log.debug(
        `Skipping local composite function validation for job "${jobKey}": ` +
          `"project_root_directory" is set, so its functions resolve relative to that directory at runtime`
      );
      return [];
    }
    return [...(Array.isArray(job?.steps) ? job.steps : []), ...hookStepsFromJob(job)];
  });
}

function hasCustomProjectRootDirectory(job: any): boolean {
  const params = job?.params;
  return (
    params !== null &&
    typeof params === 'object' &&
    typeof params.project_root_directory === 'string'
  );
}

function hookStepsFromJob(job: any): any[] {
  const hooks = job?.hooks;
  if (!hooks || typeof hooks !== 'object') {
    return [];
  }
  return Object.values(hooks).flatMap((steps: any) => (Array.isArray(steps) ? steps : []));
}

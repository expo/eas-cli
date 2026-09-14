import { buildLocalFunctionCatalogAsync } from '@expo/steps';

import Log from '../../log';

export async function validateWorkflowLocalFunctionsAsync(
  parsedYaml: any,
  projectDir: string
): Promise<void> {
  await buildLocalFunctionCatalogAsync(projectDir, {
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
  return [
    ...Object.values(jobs).flatMap((job: any) => [
      ...(Array.isArray(job?.steps) ? job.steps : []),
      ...hookStepsFrom(job),
    ]),
    ...hookStepsFrom(parsedYaml?.defaults),
  ];
}

function hookStepsFrom(jobOrDefaults: any): any[] {
  const hooks = jobOrDefaults?.hooks;
  if (!hooks || typeof hooks !== 'object') {
    return [];
  }
  return Object.values(hooks).flatMap((steps: any) => (Array.isArray(steps) ? steps : []));
}

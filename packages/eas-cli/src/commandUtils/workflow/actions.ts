import {
  buildActionCatalogFromStepsAsync,
  discoverLocalActionPathsByRefAsync,
  getWorkflowLocalActionsCycleError,
  getWorkflowLocalActionsMissingError,
  validateActionConfig,
} from '@expo/eas-build-job';
import { promises as fs } from 'fs';
import * as YAML from 'yaml';

import Log from '../../log';

export async function validateWorkflowLocalActionsAsync(
  parsedYaml: any,
  projectDir: string
): Promise<void> {
  const pathByRef = await discoverLocalActionPathsByRefAsync(projectDir);
  const steps = stepsFromWorkflow(parsedYaml);

  await buildActionCatalogFromStepsAsync({
    rootSteps: steps,
    loadAction: async ref => {
      const absolutePath = pathByRef.get(ref);
      if (!absolutePath) {
        throw new Error(getWorkflowLocalActionsMissingError([ref]));
      }

      const rawContents = await fs.readFile(absolutePath, 'utf-8');
      const parsed = YAML.parse(rawContents);
      const config = validateActionConfig(parsed, { actionReference: ref });
      Log.debug(`Validated local action "${ref}"`);
      return config;
    },
    onCycleDetected: cyclePath => new Error(getWorkflowLocalActionsCycleError(cyclePath)),
  });
}

function stepsFromWorkflow(parsedYaml: any): any[] {
  const jobs = parsedYaml?.jobs;
  if (!jobs || typeof jobs !== 'object') {
    return [];
  }
  return Object.values(jobs).flatMap((job: any) => (Array.isArray(job?.steps) ? job.steps : []));
}

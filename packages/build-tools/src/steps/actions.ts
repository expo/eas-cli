import { bunyan } from '@expo/logger';
import {
  ActionCatalog,
  buildActionCatalogFromStepsAsync,
  discoverLocalActionPathsByRefAsync,
  getActionNotFoundError,
  validateActionConfig,
} from '@expo/eas-build-job';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';

export async function buildActionCatalogAsync(
  projectRoot: string,
  { steps, logger }: { steps: readonly unknown[]; logger?: bunyan }
): Promise<ActionCatalog> {
  const pathByRef = await discoverLocalActionPathsByRefAsync(projectRoot);

  return buildActionCatalogFromStepsAsync({
    rootSteps: steps,
    loadAction: async ref => {
      const absolutePath = pathByRef.get(ref);
      if (!absolutePath) {
        throw new Error(getActionNotFoundError(ref));
      }

      const rawContents = await fs.readFile(absolutePath, 'utf-8');
      const parsed = YAML.parse(rawContents);
      const config = validateActionConfig(parsed, { actionReference: ref });
      logger?.debug(
        `Loaded local action "${ref}" from ${path.relative(projectRoot, absolutePath)}`
      );
      return config;
    },
  });
}

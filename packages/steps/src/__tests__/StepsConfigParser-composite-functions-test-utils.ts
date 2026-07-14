import { CompositeFunctionCatalog, CompositeFunctionConfigZ, Step } from '@expo/eas-build-job';

import { createGlobalContextMock } from './utils/context';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildWorkflow } from '../BuildWorkflow';
import { StepsConfigParser } from '../StepsConfigParser';

export const SETUP = './.eas/functions/setup';

export function makeCatalog(entries: Record<string, unknown>): CompositeFunctionCatalog {
  const catalog: CompositeFunctionCatalog = {};
  for (const [compositeFunctionPath, raw] of Object.entries(entries)) {
    catalog[compositeFunctionPath] = CompositeFunctionConfigZ.parse(raw);
  }
  return catalog;
}

export async function parseCompositeFunctions(options: {
  catalog?: Record<string, unknown>;
  steps: Step[];
  externalFunctions?: BuildFunction[];
  externalFunctionGroups?: BuildFunctionGroup[];
}): Promise<BuildWorkflow> {
  const ctx = createGlobalContextMock();
  const parser = new StepsConfigParser(ctx, {
    steps: options.steps,
    hooks: undefined,
    compositeFunctionCatalog: makeCatalog(options.catalog ?? {}),
    externalFunctions: options.externalFunctions,
    externalFunctionGroups: options.externalFunctionGroups,
  });
  return parser.parseAsync();
}

export function echoFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'echo',
    fn: () => {},
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'value',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
  });
}

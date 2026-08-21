import { CompositeFunctionCatalog, CompositeFunctionConfigZ, Step } from '@expo/eas-build-job';

import { createGlobalContextMock } from './utils/context';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildStepOutput } from '../BuildStepOutput';
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

export function setVersionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'set-version',
    fn: (_ctx, { outputs }) => {
      outputs.version.set('$(echo injected)');
    },
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'version',
        required: true,
      }),
    ],
  });
}

export function failingFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'fail',
    fn: () => {
      throw new Error('inner failed');
    },
  });
}

export function passThroughFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'passthrough',
    fn: (_ctx, { inputs, outputs }) => {
      outputs.out.set(String(inputs.value.value ?? ''));
    },
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'value',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'out', required: true })],
  });
}

export function captureEnvFunction(
  sink: (env: Record<string, string | undefined>) => void
): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'capture-env',
    fn: (_ctx, { env }) => {
      sink(env);
    },
  });
}

export function echoInputCompositeFunction(inputName: string, input: Record<string, unknown>) {
  return {
    inputs: [input],
    runs: { steps: [{ run: `echo "\${{ inputs.${inputName} }}"` }] },
  };
}

export function compositeFunctionReadingInput(input: Record<string, unknown>) {
  return {
    inputs: [input],
    runs: {
      steps: [
        { id: 'inner', uses: 'test/passthrough', with: { value: `\${{ inputs.${input.name} }}` } },
      ],
    },
  };
}

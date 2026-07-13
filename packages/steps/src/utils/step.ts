import { ShellStep } from '@expo/eas-build-job';

import { BuildStepGlobalContext } from '../BuildStepContext';
import { BuildStepEnv } from '../BuildStepEnv';
import { BuildStepOutput } from '../BuildStepOutput';

export function mergeEnv(base?: BuildStepEnv, overrides?: BuildStepEnv): BuildStepEnv | undefined {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...base, ...overrides };
}

export function getShellStepDisplayName(step: ShellStep): string {
  return (
    step.name ??
    step.id ??
    step.run
      .split('\n')
      .find(line => line.trim())
      ?.trim() ??
    step.run
  );
}

export function createBuildStepOutputsFromDefinition(
  ctx: BuildStepGlobalContext,
  stepOutputs: Required<ShellStep>['outputs'],
  stepDisplayName: string
): BuildStepOutput[] {
  return stepOutputs.map(
    entry =>
      new BuildStepOutput(ctx, {
        id: entry.name,
        stepDisplayName,
        required: entry.required ?? true,
      })
  );
}

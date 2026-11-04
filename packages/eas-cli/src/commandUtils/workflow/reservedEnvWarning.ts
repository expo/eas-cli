import {
  findReservedEasBuildEnvironmentVariablesInWorkflow,
  formatReservedEasBuildEnvironmentVariableWarning,
} from '@expo/eas-build-job';

import Log from '../../log';

export function warnIfWorkflowSetsReservedEnvironmentVariables(parsedYaml: unknown): void {
  const warning = formatReservedEasBuildEnvironmentVariableWarning(
    findReservedEasBuildEnvironmentVariablesInWorkflow(parsedYaml)
  );
  if (warning) {
    Log.warn(warning);
  }
}

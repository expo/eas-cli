import {
  findReservedEasBuildEnvironmentVariablesInWorkflow,
  formatReservedEasBuildEnvironmentVariableWarning,
} from '@expo/eas-build-job';

import Log from '../../../log';
import { warnIfWorkflowSetsReservedEnvironmentVariables } from '../reservedEnvWarning';

jest.mock('../../../log', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe(warnIfWorkflowSetsReservedEnvironmentVariables, () => {
  beforeEach(() => {
    jest.mocked(Log.warn).mockClear();
  });

  it('does not warn when the workflow leaves reserved names alone', () => {
    warnIfWorkflowSetsReservedEnvironmentVariables({
      jobs: {
        tests: {
          type: 'custom',
          env: { MY_BUILD_ID: '${{ needs.repack.outputs.build_id }}' },
        },
      },
    });

    expect(Log.warn).not.toHaveBeenCalled();
  });

  it('warns with the reserved names and docs link', () => {
    const parsedYaml = {
      jobs: {
        tests: {
          type: 'custom',
          env: { EAS_BUILD_ID: '${{ needs.repack.outputs.build_id }}' },
        },
      },
    };

    warnIfWorkflowSetsReservedEnvironmentVariables(parsedYaml);

    expect(Log.warn).toHaveBeenCalledTimes(1);
    expect(Log.warn).toHaveBeenCalledWith(
      formatReservedEasBuildEnvironmentVariableWarning(
        findReservedEasBuildEnvironmentVariablesInWorkflow(parsedYaml)
      )
    );
  });
});

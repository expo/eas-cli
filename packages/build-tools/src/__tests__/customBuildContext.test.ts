import { BuildTrigger, Ios, Metadata } from '@expo/eas-build-job';

import { BuildContext } from '../context';
import { CustomBuildContext } from '../customBuildContext';

import { createTestIosJob } from './utils/job';
import { createMockLogger } from './utils/logger';

describe(CustomBuildContext, () => {
  it('should not lose workflowInterpolationContext', () => {
    const contextUploadArtifact = jest.fn();
    const ctx = new BuildContext(
      createTestIosJob({
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        workflowInterpolationContext: {
          foo: 'bar',
        } as unknown as Ios.Job['workflowInterpolationContext'],
      }),
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        logger: createMockLogger(),
        uploadArtifact: contextUploadArtifact,
        workingdir: '',
      }
    );
    const customContext = new CustomBuildContext(ctx);
    expect(customContext.job.workflowInterpolationContext).toStrictEqual({
      foo: 'bar',
    });
    customContext.updateJobInformation({} as Ios.Job, {} as Metadata);
    expect(customContext.job.workflowInterpolationContext).toStrictEqual({
      foo: 'bar',
    });
  });
});

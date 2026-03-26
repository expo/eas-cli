import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { graphql } from 'gql.tada';

import { MaestroFlowResult, parseMaestroResults } from './maestroResultParser';
import { CustomBuildContext } from '../../customBuildContext';

const CREATE_MUTATION = graphql(`
  mutation CreateWorkflowDeviceTestCaseResults($input: CreateWorkflowDeviceTestCaseResultsInput!) {
    workflowDeviceTestCaseResult {
      createWorkflowDeviceTestCaseResults(input: $input) {
        id
      }
    }
  }
`);

const FLOW_STATUS_TO_TEST_CASE_RESULT_STATUS: Record<string, 'PASSED' | 'FAILED' | undefined> = {
  passed: 'PASSED',
  failed: 'FAILED',
} satisfies Record<MaestroFlowResult['status'], 'PASSED' | 'FAILED'>;

export function createReportMaestroTestResultsFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'report_maestro_test_results',
    name: 'Report Maestro Test Results',
    __metricsId: 'eas/report_maestro_test_results',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'junit_report_directory',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        defaultValue: '${{ env.HOME }}/.maestro/tests',
      }),
      BuildStepInput.createProvider({
        id: 'tests_directory',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        defaultValue: '${{ env.HOME }}/.maestro/tests',
      }),
    ],
    fn: async (stepsCtx, { inputs }) => {
      const { logger } = stepsCtx;
      const workflowJobId = stepsCtx.global.env.__WORKFLOW_JOB_ID;
      if (!workflowJobId) {
        logger.info('Not running in a workflow job, skipping test results report');
        return;
      }
      const junitDirectory = (inputs.junit_report_directory.value as string | undefined) ?? '';
      if (!junitDirectory) {
        logger.info('No JUnit directory provided, skipping test results report');
        return;
      }
      const testsDirectory = inputs.tests_directory.value as string;

      try {
        const flowResults = await parseMaestroResults(
          junitDirectory,
          testsDirectory,
          stepsCtx.workingDirectory
        );
        if (flowResults.length === 0) {
          logger.info('No maestro test results found, skipping report');
          return;
        }

        // Detect truly conflicting results: same (name, retryCount) pair means different flow files
        // share the same name (Maestro config override), which we can't disambiguate.
        // Same name with different retryCount is expected (per-attempt results from retries).
        const seen = new Set<string>();
        const conflicting = new Set<string>();
        for (const r of flowResults) {
          const key = `${r.name}:${r.retryCount}`;
          if (seen.has(key)) {
            conflicting.add(r.name);
          }
          seen.add(key);
        }
        if (conflicting.size > 0) {
          logger.error(
            `Duplicate test case names found in JUnit output: ${[...conflicting].join(
              ', '
            )}. Skipping report. Ensure each Maestro flow has a unique name.`
          );
          return;
        }

        const testCaseResults = flowResults.flatMap(f => {
          const status = FLOW_STATUS_TO_TEST_CASE_RESULT_STATUS[f.status];
          if (!status) {
            return [];
          }
          return [
            {
              name: f.name,
              path: f.path,
              status,
              errorMessage: f.errorMessage,
              duration: f.duration,
              retryCount: f.retryCount,
              tags: f.tags,
              properties: f.properties,
            },
          ];
        });

        const result = await ctx.graphqlClient
          .mutation(CREATE_MUTATION, {
            input: {
              workflowJobId,
              testCaseResults,
            },
          })
          .toPromise();

        if (result.error) {
          logger.error({ error: result.error }, 'GraphQL error creating test case results');
          return;
        }

        logger.info(`Reported ${testCaseResults.length} test case result(s).`);
      } catch (error) {
        logger.error({ err: error }, 'Failed to create test case results');
      }
    },
  });
}

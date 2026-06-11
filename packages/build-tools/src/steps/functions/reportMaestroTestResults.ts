import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { graphql } from 'gql.tada';
import { z } from 'zod';

import { buildFlowNameToPathMap } from './maestroFlowDiscovery';
import {
  MaestroFlowResult,
  isFileAttrRun,
  parseJUnitTestCases,
  parseMaestroResults,
  parseMaestroResultsFromFileAttrs,
} from './maestroResultParser';
import { CustomBuildContext } from '../../customBuildContext';

const FlowPathSchema = z.array(z.string().min(1)).min(1);

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
      BuildStepInput.createProvider({
        id: 'flow_path',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
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

      try {
        // Maestro >= 2.6.0 stamps every <testcase> with its flow's path in a
        // `file=` attribute; older reports need the legacy flow-file scan to
        // map testcase names back to paths.
        const usedFileAttrs = isFileAttrRun(await parseJUnitTestCases(junitDirectory));

        let flowResults: MaestroFlowResult[];
        if (usedFileAttrs) {
          flowResults = await parseMaestroResultsFromFileAttrs(junitDirectory);
        } else {
          // Legacy (Maestro < 2.6.0) — DELETE this arm once the fleet is on >= 2.6.0.
          const flowPathRaw = inputs.flow_path.value;
          let nameToPath: Map<string, string> | null = null;
          if (flowPathRaw !== undefined) {
            const parsed = FlowPathSchema.safeParse(flowPathRaw);
            if (parsed.success) {
              nameToPath = await buildFlowNameToPathMap({
                inputFlowPaths: parsed.data,
                projectRoot: stepsCtx.workingDirectory,
                logger,
              });
            } else {
              logger.warn(
                'Ignoring malformed flow_path input (expected a non-empty array of non-empty strings).'
              );
            }
          }
          flowResults = await parseMaestroResults(junitDirectory, nameToPath);
        }

        if (flowResults.length === 0) {
          logger.info('No maestro test results found, skipping report');
          return;
        }

        // Detect truly conflicting results: the same (path, retryCount) twice means two
        // flow files resolved to the same path, which we can't disambiguate and the API
        // rejects as a duplicate. Same path with different retryCount is expected
        // (per-attempt results from retries).
        const seen = new Set<string>();
        const conflicting = new Set<string>();
        for (const r of flowResults) {
          const key = `${r.path}:${r.retryCount}`;
          if (seen.has(key)) {
            conflicting.add(r.path);
          }
          seen.add(key);
        }
        if (conflicting.size > 0) {
          const conflictList = [...conflicting].join(', ');
          logger.error(
            usedFileAttrs
              ? `The same flow file was reported more than once in a single attempt: ` +
                  `${conflictList}. Skipping report. Check for duplicate flow_path entries ` +
                  `or leftover XML files in the JUnit report directory.`
              : `Duplicate Maestro flow names found: ${conflictList}. Skipping report. ` +
                  `Give each flow a unique name, or upgrade Maestro to >= 2.6.0 (flows are ` +
                  `then identified by file path, so duplicate names are fine).`
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

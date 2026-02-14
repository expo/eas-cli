import { Client } from '@urql/core';
import { vol } from 'memfs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createReportMaestroTestResultsFunction } from '../reportMaestroTestResults';

const JUNIT_PASS = [
  '<?xml version="1.0"?>',
  '<testsuites>',
  '  <testsuite name="Test Suite" tests="1" failures="0">',
  '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
  '  </testsuite>',
  '</testsuites>',
].join('\n');

const JUNIT_FAIL = [
  '<?xml version="1.0"?>',
  '<testsuites>',
  '  <testsuite name="Test Suite" tests="1" failures="1">',
  '    <testcase id="home" name="home" classname="home" time="5.0" status="ERROR">',
  '      <failure>Tap failed</failure>',
  '    </testcase>',
  '  </testsuite>',
  '</testsuites>',
].join('\n');

const FLOW_AI = JSON.stringify({
  flow_name: 'home',
  flow_file_path: '/root/project/.maestro/home.yml',
});

describe(createReportMaestroTestResultsFunction, () => {
  let mockMutationFn: jest.Mock;
  let mockGraphqlClient: Client;

  beforeEach(() => {
    mockMutationFn = jest.fn();
    mockGraphqlClient = {
      mutation: jest.fn().mockReturnValue({
        toPromise: mockMutationFn,
      }),
    } as unknown as Client;
  });

  function createStep(overrides?: {
    callInputs?: Record<string, unknown>;
    staticContextContent?: Record<string, unknown>;
    env?: Record<string, string>;
  }) {
    const ctx = { graphqlClient: mockGraphqlClient };
    const fn = createReportMaestroTestResultsFunction(ctx as any);
    const globalCtx = createGlobalContextMock({
      logger: createMockLogger(),
      projectTargetDirectory: '/root/project',
      staticContextContent: {
        expoApiServerURL: 'https://api.expo.test',
        job: { secrets: { robotAccessToken: 'test-token' } },
        ...overrides?.staticContextContent,
      },
    });
    globalCtx.updateEnv(overrides?.env ?? { __WORKFLOW_JOB_ID: 'job-uuid-123' });
    return fn.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        junit_report_directory: '/junit',
        tests_directory: '/tests',
        ...overrides?.callInputs,
      },
    });
  }

  it('parses JUnit results and calls GraphQL mutation', async () => {
    vol.fromJSON({
      '/junit/report.xml': JUNIT_PASS,
      '/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
    });

    mockMutationFn.mockResolvedValue({
      data: {
        workflowDeviceTestCaseResult: {
          createWorkflowDeviceTestCaseResults: [{ id: 'id-1' }],
        },
      },
    });

    await createStep().executeAsync();

    expect(mockGraphqlClient.mutation).toHaveBeenCalledTimes(1);
    const [, variables] = (mockGraphqlClient.mutation as jest.Mock).mock.calls[0];
    expect(variables.input.workflowJobId).toBe('job-uuid-123');
    expect(variables.input.testCaseResults).toEqual([
      expect.objectContaining({
        name: 'home',
        path: '.maestro/home.yml',
        status: 'PASSED',
        errorMessage: null,
        duration: 10000,
        retryCount: 0,
        properties: [],
      }),
    ]);
  });

  it('sends tags from flow YAML and properties from JUnit', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS">',
        '      <properties>',
        '        <property name="testCaseId" value="TC-001"/>',
        '        <property name="priority" value="high"/>',
        '      </properties>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
      '/root/project/.maestro/home.yml': [
        'appId: com.example.app',
        'tags:',
        '  - e2e',
        '---',
        '- launchApp',
      ].join('\n'),
    });

    mockMutationFn.mockResolvedValue({
      data: {
        workflowDeviceTestCaseResult: {
          createWorkflowDeviceTestCaseResults: [{ id: 'id-1' }],
        },
      },
    });

    await createStep().executeAsync();

    const [, variables] = (mockGraphqlClient.mutation as jest.Mock).mock.calls[0];
    expect(variables.input.testCaseResults[0].tags).toEqual(['e2e']);
    expect(variables.input.testCaseResults[0].properties).toEqual([
      { name: 'testCaseId', value: 'TC-001' },
      { name: 'priority', value: 'high' },
    ]);
  });

  it('reports failed flow with correct status and errorMessage', async () => {
    vol.fromJSON({
      '/junit/report.xml': JUNIT_FAIL,
      '/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
    });

    mockMutationFn.mockResolvedValue({
      data: {
        workflowDeviceTestCaseResult: {
          createWorkflowDeviceTestCaseResults: [{ id: 'id-1' }],
        },
      },
    });

    await createStep().executeAsync();

    const [, variables] = (mockGraphqlClient.mutation as jest.Mock).mock.calls[0];
    expect(variables.input.testCaseResults[0]).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Tap failed',
        duration: 5000,
      })
    );
  });

  // robotAccessToken guard removed — Generic.JobZ requires robotAccessToken (z.string(),
  // not optional), so it's always present in workflow jobs. graphqlClient is already
  // initialized with the token in BuildContext constructor.

  it('skips report when junit_report_directory is empty string (upstream step failed)', async () => {
    const step = createStep({
      callInputs: { junit_report_directory: '' },
    });
    await step.executeAsync();
    expect(mockGraphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('skips report when __WORKFLOW_JOB_ID env is not set', async () => {
    vol.fromJSON({
      '/junit/report.xml': JUNIT_PASS,
      '/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
    });

    const step = createStep({ env: {} });
    await step.executeAsync();
    expect(mockGraphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('skips report when no JUnit files found', async () => {
    const step = createStep();
    await step.executeAsync();
    expect(mockGraphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('does not throw when GraphQL returns error', async () => {
    vol.fromJSON({
      '/junit/report.xml': JUNIT_PASS,
      '/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
    });

    mockMutationFn.mockResolvedValue({
      error: { message: 'Something went wrong' },
    });

    await createStep().executeAsync();
  });

  it('does not throw when mutation rejects', async () => {
    vol.fromJSON({
      '/junit/report.xml': JUNIT_PASS,
      '/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
    });

    mockMutationFn.mockRejectedValue(new Error('Network error'));

    await createStep().executeAsync();
  });

  it('skips report when duplicate testcase names found', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="2" failures="0">',
        '    <testcase id="login" name="login" classname="login" time="10.0" status="SUCCESS"/>',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    await createStep().executeAsync();
    expect(mockGraphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('uses default directories when inputs are not provided', async () => {
    vol.fromJSON({
      '/home/expo/.maestro/tests/report.xml': JUNIT_PASS,
      '/home/expo/.maestro/tests/2026-01-28_055409/ai-home.json': FLOW_AI,
    });

    const ctx = { graphqlClient: mockGraphqlClient };
    const fn = createReportMaestroTestResultsFunction(ctx as any);
    const globalCtx = createGlobalContextMock({
      logger: createMockLogger(),
      projectTargetDirectory: '/root/project',
      staticContextContent: {
        expoApiServerURL: 'https://api.expo.test',
        job: { secrets: { robotAccessToken: 'test-token' } },
      },
    });
    globalCtx.updateEnv({ __WORKFLOW_JOB_ID: 'job-uuid-123', HOME: '/home/expo' });

    mockMutationFn.mockResolvedValue({
      data: {
        workflowDeviceTestCaseResult: {
          createWorkflowDeviceTestCaseResults: [{ id: 'id-1' }],
        },
      },
    });

    const step = fn.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {},
    });
    await step.executeAsync();
    expect(mockGraphqlClient.mutation).toHaveBeenCalledTimes(1);
  });
});

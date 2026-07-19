import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppFragment,
  AppPlatform,
  BuildFragment,
  BuildStatus,
  DistributionType,
  SubmissionFragment,
  SubmissionStatus,
  UpdateFragment,
  WorkflowRunFragment,
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
} from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { SubmissionQuery } from '../../../graphql/queries/SubmissionQuery';
import { UpdateQuery } from '../../../graphql/queries/UpdateQuery';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ProjectStatus from '../status';

jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/BuildQuery');
jest.mock('../../../graphql/queries/SubmissionQuery');
jest.mock('../../../graphql/queries/UpdateQuery');
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockAppByIdAsync = jest.mocked(AppQuery.byIdAsync);
const mockWorkflowRunsAsync = jest.mocked(AppQuery.byIdWorkflowRunsFilteredByStatusAsync);
const mockViewBuildsOnAppAsync = jest.mocked(BuildQuery.viewBuildsOnAppAsync);
const mockAllSubmissionsAsync = jest.mocked(SubmissionQuery.allForAppAsync);
const mockViewUpdateGroupsAsync = jest.mocked(UpdateQuery.viewUpdateGroupsOnAppAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

const projectId = 'test-project-id';

function makeApp(): AppFragment {
  return {
    id: projectId,
    name: 'my-app',
    fullName: '@jester/my-app',
    slug: 'my-app',
    ownerAccount: { id: 'account-1', name: 'jester' },
  } as unknown as AppFragment;
}

function makeBuild(overrides: Partial<BuildFragment> = {}): BuildFragment {
  return {
    id: 'build-1',
    platform: AppPlatform.Ios,
    status: BuildStatus.Finished,
    distribution: DistributionType.Store,
    buildProfile: 'production',
    appVersion: '1.0.0',
    appBuildVersion: '42',
    gitCommitHash: 'abcdef1234567890',
    gitCommitMessage: 'Ship it\nlonger body',
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:10:00.000Z',
    initiatingActor: { id: 'actor-1', displayName: 'jester' },
    project: { id: projectId, name: 'my-app', slug: 'my-app', ownerAccount: { name: 'jester' } },
    ...overrides,
  } as unknown as BuildFragment;
}

function makeWorkflowRun(): WorkflowRunFragment {
  return {
    id: 'run-1',
    status: WorkflowRunStatus.Success,
    gitCommitMessage: 'Automate all the things',
    gitCommitHash: 'fedcba0987654321',
    triggerEventType: WorkflowRunTriggerEventType.Manual,
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:05:00.000Z',
    workflow: { id: 'wf-1', name: 'Publish', fileName: 'publish.yml' },
  } as unknown as WorkflowRunFragment;
}

function makeSubmission(): SubmissionFragment {
  return {
    id: 'submission-1',
    platform: AppPlatform.Android,
    status: SubmissionStatus.Finished,
    androidConfig: { track: 'production' },
  } as unknown as SubmissionFragment;
}

function makeUpdateGroup(): UpdateFragment[] {
  return [
    {
      id: 'update-ios',
      group: 'group-1',
      message: 'Fix crash on launch',
      createdAt: '2026-07-03T00:00:00.000Z',
      runtimeVersion: '1.0.0',
      platform: 'ios',
      isRollBackToEmbedded: false,
      gitCommitHash: '1234567890abcdef',
      branch: { id: 'branch-1', name: 'production' },
    },
    {
      id: 'update-android',
      group: 'group-1',
      message: 'Fix crash on launch',
      createdAt: '2026-07-03T00:00:00.000Z',
      runtimeVersion: '1.0.0',
      platform: 'android',
      isRollBackToEmbedded: false,
      gitCommitHash: '1234567890abcdef',
      branch: { id: 'branch-1', name: 'production' },
    },
  ] as unknown as UpdateFragment[];
}

describe(ProjectStatus, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppByIdAsync.mockResolvedValue(makeApp());
    mockViewBuildsOnAppAsync.mockResolvedValue([makeBuild()]);
    mockWorkflowRunsAsync.mockResolvedValue([makeWorkflowRun()]);
    mockAllSubmissionsAsync.mockResolvedValue([makeSubmission()]);
    mockViewUpdateGroupsAsync.mockResolvedValue([makeUpdateGroup()]);
  });

  function createCommand(argv: string[]): ProjectStatus {
    const command = new ProjectStatus(argv, mockConfig);
    // @ts-expect-error getContextAsync is stubbed for the test
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('splits production and development build queries by filter', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      limit: 3,
      offset: 0,
      filter: { developmentClient: false, distribution: DistributionType.Store },
    });
    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      limit: 3,
      offset: 0,
      filter: { developmentClient: true },
    });
  });

  it('respects the --limit flag across all sections', async () => {
    const command = createCommand(['--limit', '5']);
    await command.runAsync();

    expect(mockWorkflowRunsAsync).toHaveBeenCalledWith(graphqlClient, projectId, undefined, 5);
    expect(mockAllSubmissionsAsync).toHaveBeenCalledWith(graphqlClient, projectId, {
      limit: 5,
      offset: 0,
    });
    expect(mockViewUpdateGroupsAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      limit: 5,
      offset: 0,
    });
  });

  it('renders human-readable text output by default without touching JSON output', async () => {
    const command = createCommand([]);
    await expect(command.runAsync()).resolves.not.toThrow();

    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('renders build statuses unknown to this CLI version', async () => {
    mockViewBuildsOnAppAsync.mockResolvedValue([
      makeBuild({ status: 'WAITING_FOR_CAPACITY' as BuildStatus }),
    ]);

    const command = createCommand([]);
    await command.runAsync();

    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('waiting for capacity'));
  });

  it('handles a project with no activity in any section', async () => {
    mockViewBuildsOnAppAsync.mockResolvedValue([]);
    mockWorkflowRunsAsync.mockResolvedValue([]);
    mockAllSubmissionsAsync.mockResolvedValue([]);
    mockViewUpdateGroupsAsync.mockResolvedValue([]);

    const command = createCommand([]);
    await expect(command.runAsync()).resolves.not.toThrow();
  });

  it('prints an aggregated JSON snapshot with --json', async () => {
    const command = createCommand(['--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledTimes(1);

    const output = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(output.project).toMatchObject({
      id: projectId,
      fullName: '@jester/my-app',
      account: 'jester',
      url: 'https://expo.dev/accounts/jester/projects/my-app',
    });
    expect(output.productionBuilds).toHaveLength(1);
    expect(output.productionBuilds[0]).toMatchObject({
      id: 'build-1',
      status: BuildStatus.Finished,
      gitCommitMessage: 'Ship it',
    });
    expect(output.developmentBuilds).toHaveLength(1);
    expect(output.workflowRuns[0]).toMatchObject({ id: 'run-1', workflowName: 'Publish' });
    expect(output.submissions[0]).toMatchObject({ id: 'submission-1', androidTrack: 'production' });
    expect(output.updates[0]).toMatchObject({
      group: 'group-1',
      branch: 'production',
      platforms: 'android, ios',
      message: 'Fix crash on launch',
    });
  });
});

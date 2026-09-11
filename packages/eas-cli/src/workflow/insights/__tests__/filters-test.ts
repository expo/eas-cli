import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkflowRunStatus, WorkflowRunTriggerEventType } from '../../../graphql/generated';
import { WorkflowQuery } from '../../../graphql/queries/WorkflowQuery';
import {
  getAppliedWorkflowsInsightsFilters,
  normalizeGitRef,
  resolveWorkflowsInsightsFiltersInputAsync,
} from '../filters';

jest.mock('../../../graphql/queries/WorkflowQuery', () => ({
  WorkflowQuery: { byAppIdAndFileNameAsync: jest.fn() },
}));

const mockByAppIdAndFileNameAsync = jest.mocked(WorkflowQuery.byAppIdAndFileNameAsync);
const graphqlClient = {} as ExpoGraphqlClient;

describe(resolveWorkflowsInsightsFiltersInputAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockByAppIdAndFileNameAsync.mockImplementation(async (_client, { fileName }) => ({
      id: `id-of-${fileName}`,
    }));
  });

  it('returns no input when no filter flag is set', async () => {
    const input = await resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {});

    expect(input).toBeUndefined();
    expect(mockByAppIdAndFileNameAsync).not.toHaveBeenCalled();
  });

  it('resolves workflow file names to IDs', async () => {
    const input = await resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {
      workflow: ['build.yml', 'test.yml'],
    });

    expect(mockByAppIdAndFileNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-1',
      fileName: 'build.yml',
    });
    expect(input).toEqual({ workflowIds: ['id-of-build.yml', 'id-of-test.yml'] });
  });

  it('passes statuses and triggers through and normalizes the git ref', async () => {
    const input = await resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {
      status: [WorkflowRunStatus.Failure],
      trigger: [WorkflowRunTriggerEventType.GithubPush],
      'git-ref': 'main',
    });

    expect(input).toEqual({
      statuses: ['FAILURE'],
      triggerEventTypes: ['GITHUB_PUSH'],
      gitRefRequested: ['refs/heads/main'],
    });
  });
});

describe(getAppliedWorkflowsInsightsFilters, () => {
  it('is undefined when no filter flag is set', () => {
    expect(getAppliedWorkflowsInsightsFilters({})).toBeUndefined();
  });

  it('keeps the values as given, with the git ref normalized', () => {
    expect(
      getAppliedWorkflowsInsightsFilters({
        workflow: ['build.yml'],
        status: [WorkflowRunStatus.Failure],
        'git-ref': 'main',
      })
    ).toEqual({
      workflows: ['build.yml'],
      statuses: ['FAILURE'],
      gitRef: 'refs/heads/main',
    });
  });
});

describe(normalizeGitRef, () => {
  it('prefixes bare branch names with refs/heads/', () => {
    expect(normalizeGitRef('main')).toBe('refs/heads/main');
  });

  it('leaves fully qualified refs alone', () => {
    expect(normalizeGitRef('refs/heads/main')).toBe('refs/heads/main');
    expect(normalizeGitRef('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
  });
});

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkflowRunStatus, WorkflowRunTriggerEventType } from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import {
  getAppliedWorkflowsInsightsFilters,
  normalizeGitRef,
  resolveWorkflowsInsightsFiltersInputAsync,
} from '../filters';

jest.mock('../../../graphql/queries/AppQuery');

const mockByIdWorkflowFileNamesAsync = jest.mocked(AppQuery.byIdWorkflowFileNamesAsync);
const graphqlClient = {} as ExpoGraphqlClient;

describe(resolveWorkflowsInsightsFiltersInputAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockByIdWorkflowFileNamesAsync.mockResolvedValue([
      { id: 'id-of-build.yml', fileName: 'build.yml' },
      { id: 'id-of-test.yml', fileName: 'test.yml' },
    ]);
  });

  it('returns no input when no filter flag is set', async () => {
    const input = await resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {});

    expect(input).toBeUndefined();
    expect(mockByIdWorkflowFileNamesAsync).not.toHaveBeenCalled();
  });

  it('resolves workflow file names to IDs', async () => {
    const input = await resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {
      workflow: ['build.yml', 'test.yml'],
    });

    expect(mockByIdWorkflowFileNamesAsync).toHaveBeenCalledWith(graphqlClient, 'app-1');
    expect(input).toEqual({ workflowIds: ['id-of-build.yml', 'id-of-test.yml'] });
  });

  it('rejects unknown workflow file names and lists the ones in the project', async () => {
    await expect(
      resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {
        workflow: ['build.yml', 'deploy.yml'],
      })
    ).rejects.toThrow(
      'Workflow file(s) not found on this project: "deploy.yml". Known: build.yml, test.yml. --workflow takes the workflow file name including the extension; a workflow is listed after its first run.'
    );
  });

  it('says so when the project has no workflows yet', async () => {
    mockByIdWorkflowFileNamesAsync.mockResolvedValue([]);

    await expect(
      resolveWorkflowsInsightsFiltersInputAsync(graphqlClient, 'app-1', {
        workflow: ['build.yml', 'test.yml'],
      })
    ).rejects.toThrow(
      'Workflow file(s) not found on this project: "build.yml", "test.yml". No workflows are known yet. --workflow takes the workflow file name including the extension; a workflow is listed after its first run.'
    );
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
  it('leaves a commit SHA alone, since eas workflow:run records runs under one', () => {
    expect(normalizeGitRef('5f2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d')).toBe(
      '5f2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
    );
    expect(normalizeGitRef('5F2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D')).toBe(
      '5F2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D'
    );
  });

  it('qualifies a short SHA-looking branch name, which git treats as a branch too', () => {
    expect(normalizeGitRef('5f2b3c4')).toBe('refs/heads/5f2b3c4');
  });

  it('prefixes bare branch names with refs/heads/', () => {
    expect(normalizeGitRef('main')).toBe('refs/heads/main');
  });

  it('leaves fully qualified refs alone', () => {
    expect(normalizeGitRef('refs/heads/main')).toBe('refs/heads/main');
    expect(normalizeGitRef('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
  });
});

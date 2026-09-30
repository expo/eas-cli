import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import {
  getAppliedMaestroInsightsFilters,
  resolveMaestroHistoryFiltersInputAsync,
  resolveMaestroInsightsFiltersInputAsync,
} from '../maestroFilters';

jest.mock('../../../graphql/queries/AppQuery');

const mockByIdWorkflowFileNamesAsync = jest.mocked(AppQuery.byIdWorkflowFileNamesAsync);
const graphqlClient = {} as ExpoGraphqlClient;

describe(resolveMaestroInsightsFiltersInputAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockByIdWorkflowFileNamesAsync.mockResolvedValue([
      { id: 'id-of-e2e.yml', fileName: 'e2e.yml' },
    ]);
  });

  it('returns no input when no filter flag is set', async () => {
    await expect(
      resolveMaestroInsightsFiltersInputAsync(graphqlClient, 'app-1', {})
    ).resolves.toBeUndefined();
    expect(mockByIdWorkflowFileNamesAsync).not.toHaveBeenCalled();
  });

  it('maps the dashboard status names onto the server enum and resolves workflows', async () => {
    const input = await resolveMaestroInsightsFiltersInputAsync(graphqlClient, 'app-1', {
      workflow: ['e2e.yml'],
      status: ['PASSED', 'FLAKY', 'FAILED'],
      tag: ['smoke'],
      'git-ref': 'main',
    });

    expect(input).toEqual({
      workflowIds: ['id-of-e2e.yml'],
      statuses: ['PASSED_CLEAN', 'FLAKY', 'FAILED'],
      tags: ['smoke'],
      gitRefs: ['refs/heads/main'],
    });
  });
});

describe(resolveMaestroHistoryFiltersInputAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockByIdWorkflowFileNamesAsync.mockResolvedValue([
      { id: 'id-of-e2e.yml', fileName: 'e2e.yml' },
    ]);
  });

  it('resolves only the workflow and git ref filters', async () => {
    await expect(
      resolveMaestroHistoryFiltersInputAsync(graphqlClient, 'app-1', {
        workflow: ['e2e.yml'],
        'git-ref': 'main',
      })
    ).resolves.toEqual({ workflowIds: ['id-of-e2e.yml'], gitRefs: ['refs/heads/main'] });
  });

  it('is undefined when neither is set', async () => {
    await expect(
      resolveMaestroHistoryFiltersInputAsync(graphqlClient, 'app-1', {})
    ).resolves.toBeUndefined();
  });
});

describe(getAppliedMaestroInsightsFilters, () => {
  it('is undefined when no filter flag is set', () => {
    expect(getAppliedMaestroInsightsFilters({})).toBeUndefined();
  });

  it('keeps the values as given, with the git ref normalized', () => {
    expect(
      getAppliedMaestroInsightsFilters({ status: ['PASSED'], tag: ['smoke'], 'git-ref': 'main' })
    ).toEqual({ statuses: ['PASSED'], tags: ['smoke'], gitRef: 'refs/heads/main' });
  });
});

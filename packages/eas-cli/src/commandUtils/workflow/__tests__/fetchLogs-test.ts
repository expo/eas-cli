import { getMockWorkflowCustomJobFragment } from '../../../__tests__/commands/utils';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';
import { fetchRawLogsForJobAsync } from '../fetchLogs';

jest.mock('../../../graphql/queries/BuildQuery');

describe(fetchRawLogsForJobAsync, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads a custom job from its turtle job run log file', async () => {
    const rawLogs = '{"logId":"1","buildStepId":"install","msg":"from the turtle job run"}';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(rawLogs));

    await expect(
      fetchRawLogsForJobAsync(
        { graphqlClient: {} as ExpoGraphqlClient },
        getMockWorkflowCustomJobFragment()
      )
    ).resolves.toBe(rawLogs);

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/log1');
    expect(BuildQuery.byIdAsync).not.toHaveBeenCalled();
  });
});

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { PublishUpdateGroupInput } from '../../generated';
import { PublishMutation } from '../PublishMutation';

function makeGraphqlClient(): ExpoGraphqlClient {
  return {
    mutation: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({
        data: { updateBranch: { publishUpdateGroups: [] } },
      }),
    }),
  } as unknown as ExpoGraphqlClient;
}

const input: PublishUpdateGroupInput = { branchId: 'branch-id', runtimeVersion: '1.0.0' };

describe('PublishMutation.publishUpdateGroupAsync', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EAS_BUILD_PLATFORM;
    delete process.env.EAS_BUILD_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('sends the id as turtleJobRunId when running inside a job run', async () => {
    process.env.EAS_BUILD_ID = 'job-run-id';
    const client = makeGraphqlClient();

    await PublishMutation.publishUpdateGroupAsync(client, [input]);

    expect(client.mutation).toHaveBeenCalledWith(expect.anything(), {
      publishUpdateGroupsInput: [{ ...input, turtleJobRunId: 'job-run-id' }],
    });
  });

  it('omits turtleJobRunId when running inside a build', async () => {
    process.env.EAS_BUILD_PLATFORM = 'android';
    process.env.EAS_BUILD_ID = 'build-id';
    const client = makeGraphqlClient();

    await PublishMutation.publishUpdateGroupAsync(client, [input]);

    expect(client.mutation).toHaveBeenCalledWith(expect.anything(), {
      publishUpdateGroupsInput: [{ ...input, turtleJobRunId: undefined }],
    });
  });

  it('omits turtleJobRunId when not running in EAS', async () => {
    const client = makeGraphqlClient();

    await PublishMutation.publishUpdateGroupAsync(client, [input]);

    expect(client.mutation).toHaveBeenCalledWith(expect.anything(), {
      publishUpdateGroupsInput: [{ ...input, turtleJobRunId: undefined }],
    });
  });
});

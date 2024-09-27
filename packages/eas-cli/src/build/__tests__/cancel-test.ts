import { instance, mock } from 'ts-mockito';
import { v4 as uuid } from 'uuid';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { selectBuildToCancelAsync } from '../../commands/build/cancel';
import { AppPlatform, BuildFragment, BuildPriority, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { confirmAsync, selectAsync } from '../../prompts';

jest.mock('../../ora', () => ({
  ora: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockImplementation(() => ({
      stop: jest.fn(),
      fail: jest.fn(),
    })),
  })),
}));
jest.mock('../../prompts', () => {
  return {
    selectAsync: jest.fn(),
    confirmAsync: jest.fn(),
  };
});

jest.mock('../../graphql/queries/BuildQuery', () => {
  const actual = jest.requireActual('../../graphql/queries/BuildQuery');
  return {
    BuildQuery: {
      ...actual.BuildQuery,
      viewBuildsOnAppAsync: jest.fn(),
    },
  };
});

describe(selectBuildToCancelAsync.name, () => {
  const selectedBuildId = uuid();
  const projectId = uuid();

  beforeEach(() => {
    jest
      .mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockImplementation(async () => [
        createMockBuildFragment({ projectId, buildId: selectedBuildId }),
      ]);
  });

  it('does not return build id when confirmation is rejected', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(confirmAsync).mockResolvedValueOnce(false);
    await expect(selectBuildToCancelAsync(graphqlClient, projectId, 'blah')).resolves.toEqual(null);
  });

  it('returns build id when confirmation is confirmed', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(selectAsync).mockResolvedValueOnce(selectedBuildId);
    jest.mocked(confirmAsync).mockResolvedValueOnce(true);
    await expect(selectBuildToCancelAsync(graphqlClient, projectId, 'blah')).resolves.toEqual(
      selectedBuildId
    );
  });
});

function createMockBuildFragment({
  projectId,
  buildId,
}: {
  projectId: string;
  buildId?: string;
}): BuildFragment {
  return {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    platform: AppPlatform.Android,
    id: buildId ?? uuid(),
    priority: BuildPriority.Normal,
    project: {
      __typename: 'App',
      slug: 'test-project',
      id: projectId,
      name: 'test-project',
      ownerAccount: {
        __typename: 'Account',
        id: uuid(),
        name: 'test-account',
      },
    },
    status: BuildStatus.InQueue,
    isForIosSimulator: false,
  };
}

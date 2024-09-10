import {getRecentBuildsForSubmissionAsync} from '../builds';
import {v4 as uuidv4} from 'uuid';
import {AppPlatform, BuildFragment, BuildStatus, SubmissionArchiveSourceType} from '../../../graphql/generated';
import {BuildQuery} from "../../../graphql/queries/BuildQuery";
import {ExpoGraphqlClient} from "../../../commandUtils/context/contextUtils/createGraphqlClient";

jest.mock('../../../graphql/queries/BuildQuery', () => ({
  BuildQuery: {
    viewBuildsOnAppAsync: jest.fn(),
  },
}));

const ARCHIVE_SOURCE = {
  type: SubmissionArchiveSourceType.Url,
  url: 'https://url.to/archive.tar.gz',
};

const MOCK_BUILD_FRAGMENTS: Partial<BuildFragment>[] = Array(5).map(() => ({
  id: uuidv4(),
    artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
    platform: AppPlatform.Android,
    updatedAt: Date.now(),
    status: BuildStatus.Finished,
}));
const MOCK_IN_PROGRESS_BUILD_FRAGMENTS: Partial<BuildFragment>[] = Array(5).map(() => ({
  id: uuidv4(),
    artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
    platform: AppPlatform.Android,
    updatedAt: Date.now(),
    status: BuildStatus.InProgress,
}));
describe(getRecentBuildsForSubmissionAsync, () => {
  let graphqlClient: ExpoGraphqlClient;

  beforeEach(() => {
    graphqlClient = {} as any as ExpoGraphqlClient;
  });

  it('returns finished builds if there are no in-progress builds', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest.mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce(MOCK_BUILD_FRAGMENTS.slice(0, limit) as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit },
    )

    expect(result).toMatchObject(MOCK_BUILD_FRAGMENTS.slice(0, limit));
  });
  it('returns in-progress builds if there are no finished builds', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest.mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce(MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(0, limit) as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit },
    )

    expect(result).toMatchObject(MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(0, limit));
  });
  it('returns in-progress builds if there are finished builds, but in-progress ones fill the limit', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest.mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce(MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(0, limit) as BuildFragment[])
      .mockResolvedValueOnce(MOCK_BUILD_FRAGMENTS.slice(0, limit) as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit },
    )

    expect(result).toMatchObject(MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(0, limit));
  });
  it('returns in-progress and finished builds if in-progress ones don\'t fill the limit', async () => {
    const appId = uuidv4();
    const limit = 4;
    jest.mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce(MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(0, 2) as BuildFragment[])
      .mockResolvedValueOnce(MOCK_BUILD_FRAGMENTS.slice(0, 2) as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit },
    )

    expect(result).toMatchObject(MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(0, 2).concat(MOCK_BUILD_FRAGMENTS.slice(0, 2)));
  });
});

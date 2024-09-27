import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  SubmissionArchiveSourceType,
  UploadSessionType,
} from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import { confirmAsync, promptAsync } from '../../prompts';
import { uploadFileAtPathToGCSAsync } from '../../uploads';
import { ArchiveSourceType, BUILD_LIST_ITEM_COUNT, getArchiveAsync } from '../ArchiveSource';
import { getRecentBuildsForSubmissionAsync } from '../utils/builds';

jest.mock('fs');
jest.mock('../../log');
jest.mock('../../prompts');
jest.mock('../utils/builds');
jest.mock('../../uploads');
jest.mock('../../graphql/queries/BuildQuery', () => ({
  BuildQuery: {
    byIdAsync: jest.fn(),
  },
}));

const ARCHIVE_SOURCE = {
  type: SubmissionArchiveSourceType.Url,
  url: 'https://url.to/archive.tar.gz',
};

const MOCK_BUILD_FRAGMENT: Partial<BuildFragment> = {
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
  status: BuildStatus.Finished,
};
const MOCK_IN_PROGRESS_BUILD_FRAGMENT: Partial<BuildFragment> = {
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
  status: BuildStatus.InProgress,
};

const SOURCE_STUB_INPUT = {
  projectId: uuidv4(),
  platform: Platform.ANDROID,
  projectDir: '.',
  nonInteractive: false,
};

describe(getArchiveAsync, () => {
  let graphqlClient: ExpoGraphqlClient;

  beforeEach(() => {
    vol.reset();

    jest.mocked(promptAsync).mockReset();
    jest.mocked(promptAsync).mockImplementation(async () => {
      throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
    });

    jest.mocked(confirmAsync).mockReset();
    jest.mocked(confirmAsync).mockImplementation(async () => {
      throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
    });

    graphqlClient = {} as any as ExpoGraphqlClient;
  });

  it('handles URL source', async () => {
    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.url,
        url: ARCHIVE_SOURCE.url,
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('prompts again if provided URL is invalid', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.url,
        url: 'invalid',
      }
    );

    expect(promptAsync).toHaveBeenCalledTimes(2);
    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('asks the user if use build id instead of build details page url', async () => {
    jest.mocked(confirmAsync).mockResolvedValueOnce(true);
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT as BuildFragment);

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.url,
        url: 'https://expo.dev/accounts/turtle/projects/blah/builds/81da6b36-efe4-4262-8970-84f03efeec81',
      }
    );

    expect(confirmAsync).toHaveBeenCalled();
    expect(archive.sourceType).toBe(ArchiveSourceType.build);
    expect((archive as any).build.id).toBe(MOCK_BUILD_FRAGMENT.id);
  });

  it('handles prompt source', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.prompt,
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('handles Build ID source', async () => {
    const buildId = uuidv4();
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT as BuildFragment);

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.buildId,
        id: buildId,
      }
    );

    expect(BuildQuery.byIdAsync).toBeCalledWith(graphqlClient, buildId);
    expect(archive.sourceType).toBe(ArchiveSourceType.build);
  });

  it('prompts again if build with provided ID doesnt exist', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockRejectedValue(new Error('Build doesnt exist'));
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.buildId,
        id: uuidv4(),
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('prompts again if build with provided ID is expired', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValueOnce({
      ...MOCK_BUILD_FRAGMENT,
      expirationDate: new Date(Date.now() - 1000),
    } as BuildFragment);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.buildId,
        id: uuidv4(),
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('handles latest build source', async () => {
    const projectId = uuidv4();
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_BUILD_FRAGMENT as BuildFragment]);

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient, projectId },
      {
        sourceType: ArchiveSourceType.latest,
      }
    );

    expect(getRecentBuildsForSubmissionAsync).toBeCalledWith(
      graphqlClient,
      toAppPlatform(SOURCE_STUB_INPUT.platform),
      projectId
    );
    expect(archive.sourceType).toBe(ArchiveSourceType.build);
  });

  it('prompts again if the latest build is expired', async () => {
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([
        { ...MOCK_BUILD_FRAGMENT, expirationDate: new Date(Date.now() - 1000) } as BuildFragment,
      ]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.latest,
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('prompts again if no builds exists when selected latest', async () => {
    jest.mocked(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.latest,
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('handles build-list-select source for finished builds', async () => {
    const projectId = uuidv4();
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_BUILD_FRAGMENT as BuildFragment]);
    jest.mocked(promptAsync).mockResolvedValueOnce({ selectedBuild: MOCK_BUILD_FRAGMENT });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient, projectId },
      {
        sourceType: ArchiveSourceType.buildList,
      }
    );

    expect(getRecentBuildsForSubmissionAsync).toBeCalledWith(
      graphqlClient,
      toAppPlatform(SOURCE_STUB_INPUT.platform),
      projectId,
      { limit: BUILD_LIST_ITEM_COUNT }
    );
    expect(archive.sourceType).toBe(ArchiveSourceType.build);
  });

  it('handles build-list-select source for in-progress builds', async () => {
    const projectId = uuidv4();
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_IN_PROGRESS_BUILD_FRAGMENT as BuildFragment]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ selectedBuild: MOCK_IN_PROGRESS_BUILD_FRAGMENT });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient, projectId },
      {
        sourceType: ArchiveSourceType.buildList,
      }
    );

    expect(getRecentBuildsForSubmissionAsync).toBeCalledWith(
      graphqlClient,
      toAppPlatform(SOURCE_STUB_INPUT.platform),
      projectId,
      { limit: BUILD_LIST_ITEM_COUNT }
    );
    expect(archive.sourceType).toBe(ArchiveSourceType.build);
  });

  it('handles build-list-select source for both finished and in-progress builds', async () => {
    const projectId = uuidv4();
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([
        MOCK_IN_PROGRESS_BUILD_FRAGMENT as BuildFragment,
        MOCK_BUILD_FRAGMENT as BuildFragment,
      ]);
    jest.mocked(promptAsync).mockResolvedValueOnce({ selectedBuild: MOCK_BUILD_FRAGMENT });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient, projectId },
      {
        sourceType: ArchiveSourceType.buildList,
      }
    );

    expect(getRecentBuildsForSubmissionAsync).toBeCalledWith(
      graphqlClient,
      toAppPlatform(SOURCE_STUB_INPUT.platform),
      projectId,
      { limit: BUILD_LIST_ITEM_COUNT }
    );
    expect(archive.sourceType).toBe(ArchiveSourceType.build);
  });

  it('prompts again if all builds have expired', async () => {
    jest.mocked(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([
      {
        ...MOCK_BUILD_FRAGMENT,
        // We're setting expirationDate to be in the past,
        // because we want to build to appear expired.
        expirationDate: new Date(Date.now() - 31 * 24 * 3600 * 1000),
      } as BuildFragment,
    ]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.buildList,
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('falls back to prompt if user selected "None of the above"', async () => {
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_BUILD_FRAGMENT as BuildFragment]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ selectedBuild: null })
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.buildList,
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });

  it('handles path source', async () => {
    const path = '/archive.apk';
    await fs.writeFile(path, 'some content');

    jest.mocked(uploadFileAtPathToGCSAsync).mockResolvedValueOnce('wat');

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.path,
        path,
      }
    );

    expect(uploadFileAtPathToGCSAsync).toBeCalledWith(
      graphqlClient,
      UploadSessionType.EasSubmitGcsAppArchive,
      path,
      expect.anything()
    );
    expect(archive).toMatchObject({
      sourceType: ArchiveSourceType.gcs,
      bucketKey: 'wat',
      localSource: {
        sourceType: ArchiveSourceType.path,
        path,
      },
    });
  });

  it('prompts again if provided path doesnt exist', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_SOURCE.url });

    const archive = await getArchiveAsync(
      { ...SOURCE_STUB_INPUT, graphqlClient },
      {
        sourceType: ArchiveSourceType.path,
        path: './doesnt/exist.aab',
      }
    );

    expect(archive.sourceType).toBe(ArchiveSourceType.url);
  });
});

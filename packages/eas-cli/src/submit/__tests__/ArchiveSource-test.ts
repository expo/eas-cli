import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';
import { Headers, Response } from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

import { AppPlatform, BuildFragment, UploadSessionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import { confirmAsync, promptAsync } from '../../prompts';
import { uploadAsync } from '../../uploads';
import {
  Archive,
  ArchiveSourceType,
  BUILD_LIST_ITEM_COUNT,
  getArchiveAsync,
} from '../ArchiveSource';
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

const ARCHIVE_URL = 'https://url.to/archive.tar.gz';

const MOCK_BUILD_FRAGMENT: Partial<BuildFragment> = {
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_URL,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
};

const SOURCE_STUB_INPUT = {
  projectId: uuidv4(),
  platform: Platform.ANDROID,
  projectDir: '.',
  nonInteractive: false,
};

describe(getArchiveAsync, () => {
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
  });

  it('handles URL source', async () => {
    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.url,
      url: ARCHIVE_URL,
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('prompts again if provided URL is invalid', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.url,
      url: 'invalid',
    });

    expect(promptAsync).toHaveBeenCalledTimes(2);
    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('asks the user if use build id instead of build details page url', async () => {
    jest.mocked(confirmAsync).mockResolvedValueOnce(true);
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT as BuildFragment);

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.url,
      url: 'https://expo.dev/accounts/turtle/projects/blah/builds/81da6b36-efe4-4262-8970-84f03efeec81',
    });

    expect(confirmAsync).toHaveBeenCalled();
    assertArchiveResult(archive, ArchiveSourceType.buildId);
    expect((archive.source as any).id).toBe('81da6b36-efe4-4262-8970-84f03efeec81');
  });

  it('handles prompt source', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.prompt,
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('handles Build ID source', async () => {
    const buildId = uuidv4();
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT as BuildFragment);

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildId,
      id: buildId,
    });

    expect(BuildQuery.byIdAsync).toBeCalledWith(buildId);
    assertArchiveResult(archive, ArchiveSourceType.buildId);
  });

  it('prompts again if build with provided ID doesnt exist', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockRejectedValue(new Error('Build doesnt exist'));
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildId,
      id: uuidv4(),
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('handles latest build source', async () => {
    const projectId = uuidv4();
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_BUILD_FRAGMENT as BuildFragment]);

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      projectId,
      sourceType: ArchiveSourceType.latest,
    });

    expect(getRecentBuildsForSubmissionAsync).toBeCalledWith(
      toAppPlatform(SOURCE_STUB_INPUT.platform),
      projectId
    );
    assertArchiveResult(archive, ArchiveSourceType.latest);
  });

  it('prompts again if no builds exists when selected latest', async () => {
    jest.mocked(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.latest,
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('handles build-list-select source', async () => {
    const projectId = uuidv4();
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_BUILD_FRAGMENT as BuildFragment]);
    jest.mocked(promptAsync).mockResolvedValueOnce({ selectedBuild: MOCK_BUILD_FRAGMENT });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      projectId,
      sourceType: ArchiveSourceType.buildList,
    });

    expect(getRecentBuildsForSubmissionAsync).toBeCalledWith(
      toAppPlatform(SOURCE_STUB_INPUT.platform),
      projectId,
      { limit: BUILD_LIST_ITEM_COUNT }
    );
    assertArchiveResult(archive, ArchiveSourceType.buildList);
  });

  it('prompts again if all builds have expired', async () => {
    jest.mocked(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([
      {
        ...MOCK_BUILD_FRAGMENT,
        updatedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
      } as BuildFragment,
    ]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildList,
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('falls back to prompt if user selected "None of the above"', async () => {
    jest
      .mocked(getRecentBuildsForSubmissionAsync)
      .mockResolvedValueOnce([MOCK_BUILD_FRAGMENT as BuildFragment]);
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ selectedBuild: null })
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildList,
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('handles path source', async () => {
    const path = '/archive.apk';
    await fs.writeFile(path, 'some content');

    const response = new Response(undefined, { headers: new Headers([['location', ARCHIVE_URL]]) });
    jest.mocked(uploadAsync).mockResolvedValueOnce({ response, bucketKey: 'wat' });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.path,
      path,
    });

    expect(uploadAsync).toBeCalledWith(
      UploadSessionType.EasSubmitAppArchive,
      path,
      expect.anything()
    );
    assertArchiveResult(archive, ArchiveSourceType.path);
  });

  it('prompts again if provided path doesnt exist', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.path,
      path: './doesnt/exist.aab',
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });
});

function assertArchiveResult(
  archive: Archive,
  expectedSourceType: ArchiveSourceType,
  expectedUrl: string = ARCHIVE_URL
): void {
  expect(archive.source.sourceType).toBe(expectedSourceType);
  if (archive.url) {
    expect(archive.url).toBe(expectedUrl);
  }
}

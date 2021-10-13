import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../__tests__/utils';
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

    asMock(promptAsync).mockReset();
    asMock(promptAsync).mockImplementation(() => {
      throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
    });

    asMock(confirmAsync).mockReset();
    asMock(confirmAsync).mockImplementation(() => {
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
    asMock(promptAsync)
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
    asMock(confirmAsync).mockResolvedValueOnce(true);
    asMock(BuildQuery.byIdAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT);

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
    asMock(promptAsync)
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
    asMock(BuildQuery.byIdAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT);

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildId,
      id: buildId,
    });

    expect(BuildQuery.byIdAsync).toBeCalledWith(buildId);
    assertArchiveResult(archive, ArchiveSourceType.buildId);
  });

  it('prompts again if build with provided ID doesnt exist', async () => {
    asMock(BuildQuery.byIdAsync).mockRejectedValue(new Error('Build doesnt exist'));
    asMock(promptAsync)
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
    asMock(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([MOCK_BUILD_FRAGMENT]);

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
    asMock(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([]);
    asMock(promptAsync)
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
    asMock(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([MOCK_BUILD_FRAGMENT]);
    asMock(promptAsync).mockResolvedValueOnce({ selectedBuild: MOCK_BUILD_FRAGMENT });

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
    asMock(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([
      {
        ...MOCK_BUILD_FRAGMENT,
        updatedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
      },
    ]);
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildList,
    });

    assertArchiveResult(archive, ArchiveSourceType.url);
  });

  it('falls back to prompt if user selected "None of the above"', async () => {
    asMock(getRecentBuildsForSubmissionAsync).mockResolvedValueOnce([MOCK_BUILD_FRAGMENT]);
    asMock(promptAsync)
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
    asMock(uploadAsync).mockResolvedValueOnce({ url: ARCHIVE_URL });

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
    asMock(promptAsync)
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

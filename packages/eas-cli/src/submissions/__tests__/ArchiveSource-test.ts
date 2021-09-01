import fs from 'fs-extra';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../__tests__/utils';
import { AppPlatform, BuildFragment, UploadSessionType } from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { uploadAsync } from '../../uploads';
import { Archive, ArchiveSourceType, getArchiveAsync } from '../ArchiveSource';
import { getBuildByIdForSubmissionAsync, getLatestBuildForSubmissionAsync } from '../utils/builds';

jest.mock('fs');
jest.mock('../../log');
jest.mock('../../prompts');
jest.mock('../utils/builds');
jest.mock('../../uploads');

const ARCHIVE_URL = 'https://url.to/archive.tar.gz';

const MOCK_BUILD_FRAGMENT: Partial<BuildFragment> = {
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_URL,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
};

const SOURCE_STUB_INPUT = {
  projectId: uuidv4(),
  platform: AppPlatform.Android,
  projectDir: '.',
};

describe(getArchiveAsync, () => {
  beforeEach(() => {
    vol.reset();

    asMock(promptAsync).mockReset();
    asMock(promptAsync).mockImplementation(() => {
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
    asMock(getBuildByIdForSubmissionAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT);

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.buildId,
      id: buildId,
    });

    expect(getBuildByIdForSubmissionAsync).toBeCalledWith(SOURCE_STUB_INPUT.platform, buildId);
    assertArchiveResult(archive, ArchiveSourceType.buildId);
  });

  it('prompts again if build with provided ID doesnt exist', async () => {
    asMock(getBuildByIdForSubmissionAsync).mockRejectedValue(new Error('Build doesnt exist'));
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
    asMock(getLatestBuildForSubmissionAsync).mockResolvedValueOnce(MOCK_BUILD_FRAGMENT);

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      projectId,
      sourceType: ArchiveSourceType.latest,
    });

    expect(getLatestBuildForSubmissionAsync).toBeCalledWith(SOURCE_STUB_INPUT.platform, projectId);
    assertArchiveResult(archive, ArchiveSourceType.latest);
  });

  it('prompts again if no builds exists when selected latest', async () => {
    asMock(getLatestBuildForSubmissionAsync).mockResolvedValueOnce(null);
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const archive = await getArchiveAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveSourceType.latest,
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
) {
  expect(archive.source.sourceType).toBe(expectedSourceType);
  expect(archive.url).toBe(expectedUrl);
}

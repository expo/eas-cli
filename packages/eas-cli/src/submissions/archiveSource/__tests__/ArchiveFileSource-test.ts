import fs from 'fs-extra';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { AppPlatform, UploadSessionType } from '../../../graphql/generated';
import { promptAsync } from '../../../prompts';
import { uploadAsync } from '../../../uploads';
import { getBuildArtifactUrlByIdAsync, getLatestBuildArtifactUrlAsync } from '../../utils/builds';
import {
  ArchiveFileSourceType,
  ResolvedArchive,
  getArchiveFileLocationAsync,
} from '../ArchiveFileSource';

jest.mock('fs');
jest.mock('../../../log');
jest.mock('../../../prompts');
jest.mock('../../utils/builds');
jest.mock('../../../uploads');

const ARCHIVE_URL = 'https://url.to/archive.tar.gz';

const SOURCE_STUB_INPUT = {
  projectId: uuidv4(),
  platform: AppPlatform.Android,
  projectDir: '.',
};

describe(getArchiveFileLocationAsync, () => {
  beforeEach(() => {
    vol.reset();

    asMock(promptAsync).mockReset();
    asMock(promptAsync).mockImplementation(() => {
      throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
    });
  });

  it('handles URL source', async () => {
    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.url,
      url: ARCHIVE_URL,
    });

    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.url);
  });

  it('prompts again if provided URL is invalid', async () => {
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveFileSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.url,
      url: 'invalid',
    });

    expect(promptAsync).toHaveBeenCalledTimes(2);
    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.url);
  });

  it('handles prompt source', async () => {
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveFileSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.prompt,
    });

    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.url);
  });

  it('handles Build ID source', async () => {
    const buildId = uuidv4();
    asMock(getBuildArtifactUrlByIdAsync).mockResolvedValueOnce(ARCHIVE_URL);

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.buildId,
      id: buildId,
    });

    expect(getBuildArtifactUrlByIdAsync).toBeCalledWith(SOURCE_STUB_INPUT.platform, buildId);
    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.buildId);
  });

  it('prompts again if build with provided ID doesnt exist', async () => {
    asMock(getBuildArtifactUrlByIdAsync).mockRejectedValue(new Error('Build doesnt exist'));
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveFileSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.buildId,
      id: uuidv4(),
    });

    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.url);
  });

  it('handles latest build source', async () => {
    const projectId = uuidv4();
    asMock(getLatestBuildArtifactUrlAsync).mockResolvedValueOnce(ARCHIVE_URL);

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      projectId,
      sourceType: ArchiveFileSourceType.latest,
    });

    expect(getLatestBuildArtifactUrlAsync).toBeCalledWith(SOURCE_STUB_INPUT.platform, projectId);
    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.latest);
  });

  it('prompts again if no builds exists when selected latest', async () => {
    asMock(getLatestBuildArtifactUrlAsync).mockResolvedValueOnce(null);
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveFileSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.latest,
    });

    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.url);
  });

  it('handles path source', async () => {
    const path = '/archive.apk';
    await fs.writeFile(path, 'some content');
    asMock(uploadAsync).mockResolvedValueOnce({ url: ARCHIVE_URL });

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.path,
      path,
    });

    expect(uploadAsync).toBeCalledWith(
      UploadSessionType.EasSubmitAppArchive,
      path,
      expect.anything()
    );
    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.path);
  });

  it('prompts again if provided path doesnt exist', async () => {
    asMock(promptAsync)
      .mockResolvedValueOnce({ sourceType: ArchiveFileSourceType.url })
      .mockResolvedValueOnce({ url: ARCHIVE_URL });

    const resolvedArchive = await getArchiveFileLocationAsync({
      ...SOURCE_STUB_INPUT,
      sourceType: ArchiveFileSourceType.path,
      path: './doesnt/exist.aab',
    });

    assertArchiveResult(resolvedArchive, ArchiveFileSourceType.url);
  });
});

function assertArchiveResult(
  resolvedArchive: ResolvedArchive,
  expectedSourceType: ArchiveFileSourceType,
  expectedLocation: string = ARCHIVE_URL
) {
  expect(resolvedArchive.realSource.sourceType).toBe(expectedSourceType);
  expect(resolvedArchive.location).toBe(expectedLocation);
}

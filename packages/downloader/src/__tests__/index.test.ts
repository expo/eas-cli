import fs from 'fs-extra';

import downloadFile from '../index';

const tmpPathLocation = '/tmp/turtle-v2-downloader-test';

const fileInPublicS3Bucket =
  'https://turtle-v2-test-fixtures.s3.us-east-2.amazonaws.com/project.tar.gz';
const missingFileInS3Bucket =
  'https://turtle-v2-test-fixtures.s3.us-east-2.amazonaws.com/project123.tar.gz';

describe('downloadFile', () => {
  beforeEach(async () => {
    await fs.remove(tmpPathLocation);
  });

  afterAll(async () => {
    await fs.remove(tmpPathLocation);
  });

  it('should download file', async () => {
    await downloadFile(fileInPublicS3Bucket, tmpPathLocation, { timeout: 2000 });
    const fileExists = await fs.pathExists(tmpPathLocation);
    expect(fileExists).toBe(true);
  });

  it('should throw error when 4xx', async () => {
    await expect(
      downloadFile(missingFileInS3Bucket, tmpPathLocation, { timeout: 2000 })
    ).rejects.toThrow();
  });

  it('should throw error when host unreachable', async () => {
    await expect(
      downloadFile('https://amazonawswueytfgweuyfgvuwefvuweyvf.com', tmpPathLocation, {
        timeout: 2000,
      })
    ).rejects.toThrow();
  });

  it('should throw error when timeout is reached', async () => {
    await expect(
      downloadFile(fileInPublicS3Bucket, tmpPathLocation, { timeout: 1 })
    ).rejects.toThrow();
  });

  it('should cleanup file on error', async () => {
    try {
      await downloadFile(missingFileInS3Bucket, tmpPathLocation, { timeout: 1 });
    } catch {
      /* empty block statement */
    }
    const fileExists = await fs.pathExists(tmpPathLocation);
    expect(fileExists).toBe(false);
  });
});

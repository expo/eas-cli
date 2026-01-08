import { vol } from 'memfs';
import fs from 'fs-extra';

import { findArtifacts } from '../artifacts';

jest.mock('fs');

describe(findArtifacts, () => {
  beforeEach(async () => {
    vol.reset();
  });

  test('with correct path', async () => {
    await fs.mkdirp('/dir1/dir2/dir3/dir4');
    await fs.writeFile('/dir1/dir2/dir3/dir4/file', Buffer.from('some content'));
    const loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
    };
    const paths = await findArtifacts({
      rootDir: '/dir1/dir2/dir3/dir4/',
      patternOrPath: 'file',
      logger: loggerMock as any,
    });
    expect(loggerMock.error).toHaveBeenCalledTimes(0);
    expect(paths.length).toBe(1);
    expect(paths[0]).toBe('/dir1/dir2/dir3/dir4/file');
  });

  test('with absolute path', async () => {
    await fs.mkdirp('/Users/expo/build');
    await fs.mkdirp('/Users/expo/.maestro/tests');
    await fs.writeFile('/Users/expo/.maestro/tests/log', Buffer.from('some content'));
    const loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
    };
    const paths = await findArtifacts({
      rootDir: '/Users/expo/build',
      patternOrPath: '/Users/expo/.maestro/tests',
      logger: loggerMock as any,
    });
    expect(loggerMock.error).toHaveBeenCalledTimes(0);
    expect(paths.length).toBe(1);
    expect(paths[0]).toBe('/Users/expo/.maestro/tests');
  });

  test('with glob pattern', async () => {
    await fs.mkdirp('/dir1/dir2/dir3/dir4');
    await fs.writeFile('/dir1/dir2/dir3/dir4/file.aab', Buffer.from('some content'));
    await fs.writeFile('/dir1/dir2/dir3/dir4/file-release.aab', Buffer.from('some content'));
    const loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
    };
    const paths = await findArtifacts({
      rootDir: '/dir1/dir2/dir3/dir4/',
      patternOrPath: 'file{,-release}.aab',
      logger: loggerMock as any,
    });
    expect(loggerMock.error).toHaveBeenCalledTimes(0);
    expect(paths.length).toBe(2);
  });

  test('with missing file in empty directory', async () => {
    await fs.mkdirp('/dir1/dir2/dir3');
    let errMsg = '';
    const loggerMock = {
      info: jest.fn(),
      error: jest.fn().mockImplementation((msg) => {
        errMsg = msg;
      }),
    };
    await expect(
      findArtifacts({
        rootDir: '/dir1/dir2/dir3/dir4/',
        patternOrPath: 'file',
        logger: loggerMock as any,
      })
    ).rejects.toThrow();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(errMsg).toEqual(
      'There is no such file or directory "/dir1/dir2/dir3/dir4/file". Directory "/dir1/dir2/dir3" is empty.'
    );
  });

  test('with missing file in not empty directory', async () => {
    await fs.mkdirp('/dir1/dir2/dir3/otherdir1');
    await fs.writeFile('/dir1/dir2/dir3/otherfile1', 'content');
    await fs.mkdirp('/dir1/dir2/dir3/otherdir2');
    let errMsg = '';
    const loggerMock = {
      info: jest.fn(),
      error: jest.fn().mockImplementation((msg) => {
        errMsg = msg;
      }),
    };
    await expect(
      findArtifacts({
        rootDir: '/dir1/dir2/dir3/dir4/',
        patternOrPath: 'file',
        logger: loggerMock as any,
      })
    ).rejects.toThrow();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(errMsg).toEqual(
      'There is no such file or directory "/dir1/dir2/dir3/dir4/file". Directory "/dir1/dir2/dir3" contains [otherdir1, otherdir2, otherfile1].'
    );
  });

  test('when checks up root directory', async () => {
    await fs.mkdirp('/');
    let errMsg = '';
    const loggerMock = {
      info: jest.fn(),
      error: jest.fn().mockImplementation((msg) => {
        errMsg = msg;
      }),
    };
    await expect(
      findArtifacts({
        rootDir: '/dir1/dir2/dir3/dir4/',
        patternOrPath: 'file',
        logger: loggerMock as any,
      })
    ).rejects.toThrow();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(errMsg).toEqual('There is no such file or directory "/dir1/dir2/dir3/dir4/file".');
  });
});

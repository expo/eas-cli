import os from 'os';
import path from 'path';

import fs from 'fs-extra';
import { create } from 'tar';

import { extractAppFromLocalArchiveAsync } from '../download';
import * as Paths from '../paths';
import { AppPlatform } from '../../graphql/generated';
import { promptAsync } from '../../prompts';

jest.mock('../../prompts');

const mockPromptAsync = jest.mocked(promptAsync);

describe(extractAppFromLocalArchiveAsync, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-download-test-'));
    jest.spyOn(Paths, 'getTmpDirectory').mockReturnValue(tmpDir);
    mockPromptAsync.mockReset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tmpDir);
  });

  async function makeArchiveAsync(appPaths: string[]): Promise<string> {
    const contentsDir = path.join(tmpDir, 'contents');
    await fs.ensureDir(contentsDir);
    for (const appPath of appPaths) {
      await fs.ensureDir(path.join(contentsDir, appPath));
    }
    const archivePath = path.join(tmpDir, 'apps.tar.gz');
    await create({ file: archivePath, cwd: contentsDir, gzip: true }, ['.']);
    return archivePath;
  }

  it('selects the containing app without prompting for its nested App Clip', async () => {
    const archivePath = await makeArchiveAsync([
      'Bluesky.app',
      'Bluesky.app/AppClips/BlueskyClip.app',
    ]);

    const appPath = await extractAppFromLocalArchiveAsync(archivePath, AppPlatform.Ios);

    expect(path.basename(appPath)).toBe('Bluesky.app');
    expect(await fs.pathExists(path.join(appPath, 'AppClips/BlueskyClip.app'))).toBe(true);
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  it('prompts for separate apps but excludes nested App Clips from the choices', async () => {
    const archivePath = await makeArchiveAsync([
      'Bluesky.app',
      'Bluesky.app/AppClips/BlueskyClip.app',
      'Bluesky.app.backup.app',
    ]);
    mockPromptAsync.mockResolvedValueOnce({ selectedFile: './Bluesky.app.backup.app' });

    const appPath = await extractAppFromLocalArchiveAsync(archivePath, AppPlatform.Ios);

    expect(path.basename(appPath)).toBe('Bluesky.app.backup.app');
    const [question] = mockPromptAsync.mock.calls[0];
    if (Array.isArray(question)) {
      throw new Error('Expected a single app selection prompt');
    }
    expect(question.choices).toHaveLength(2);
    expect(question.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringMatching(/Bluesky\.app$/) }),
        expect.objectContaining({ title: expect.stringMatching(/Bluesky\.app\.backup\.app$/) }),
      ])
    );
  });

  it('throws when the archive contains no apps', async () => {
    const archivePath = await makeArchiveAsync([]);

    await expect(extractAppFromLocalArchiveAsync(archivePath, AppPlatform.Ios)).rejects.toThrow(
      'Did not find any installable apps inside tarball.'
    );
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });
});

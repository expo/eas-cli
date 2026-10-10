import spawn from '@expo/turtle-spawn';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readIosApplicationIdentifierAsync } from '../iosAppArtifact';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

describe(readIosApplicationIdentifierAsync, () => {
  let directory: string;
  let artifactPath: string;

  beforeEach(async () => {
    jest.mocked(spawn).mockReset();
    directory = await mkdtemp(path.join(os.tmpdir(), 'ios-app-artifact-'));
    artifactPath = path.join(directory, 'Example.app');
    await mkdir(artifactPath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads app metadata without installing or launching', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: 'com.example.app\n', stderr: '' } as never);
    await expect(readIosApplicationIdentifierAsync({ artifactPath, env: {} })).resolves.toBe(
      'com.example.app'
    );
    expect(jest.mocked(spawn).mock.calls).toEqual([
      [
        'plutil',
        ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(artifactPath, 'Info.plist')],
        { stdio: 'pipe', env: {} },
      ],
    ]);
  });

  it.each(['missing', 'file', 'wrong extension'])('rejects an invalid artifact: %s', async kind => {
    await rm(artifactPath, { recursive: true });
    if (kind === 'file') {
      await writeFile(artifactPath, 'not an app directory');
    } else if (kind === 'wrong extension') {
      artifactPath = path.join(directory, 'Example.ipa');
      await mkdir(artifactPath);
    }
    await expect(
      readIosApplicationIdentifierAsync({ artifactPath, env: {} })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a missing bundle identifier', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: '  ', stderr: '' } as never);
    await expect(
      readIosApplicationIdentifierAsync({ artifactPath, env: {} })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_MISSING_IDENTIFIER' });
  });
});

import { EnvironmentSecretType } from '@expo/eas-build-job';
import fs from 'fs/promises';
import { vol } from 'memfs';

import {
  createTemporaryEnvironmentSecretFile,
  getStringEnvironmentSecretValue,
} from '../environmentSecrets';

describe(getStringEnvironmentSecretValue, () => {
  it('returns the last string secret with the name, like the build env', () => {
    expect(
      getStringEnvironmentSecretValue(
        [
          { name: 'TOKEN', type: EnvironmentSecretType.STRING, value: 'first' },
          { name: 'OTHER', type: EnvironmentSecretType.STRING, value: 'other' },
          { name: 'TOKEN', type: EnvironmentSecretType.STRING, value: 'last' },
        ],
        'TOKEN'
      )
    ).toBe('last');
  });

  it('returns null when the last secret with the name is a file secret', () => {
    expect(
      getStringEnvironmentSecretValue(
        [
          { name: 'TOKEN', type: EnvironmentSecretType.STRING, value: 'a' },
          { name: 'TOKEN', type: EnvironmentSecretType.FILE, value: 'Yg==' },
        ],
        'TOKEN'
      )
    ).toBeNull();
  });
});

describe(createTemporaryEnvironmentSecretFile, () => {
  beforeEach(async () => {
    vol.reset();
  });

  it('does not expose the secret value in the file name', async () => {
    await fs.mkdir('/test');
    const path = createTemporaryEnvironmentSecretFile({
      secretsDir: '/test',
      name: 'GOOGLE_KEY_JSON',
      contents_base64: Buffer.from('value', 'utf-8').toString('base64'),
    });
    expect(path).not.toContain('GOOGLE_KEY_JSON');
    expect(path).not.toContain('value');
  });

  it('does not produce shared files', async () => {
    await fs.mkdir('/test');
    const path1 = createTemporaryEnvironmentSecretFile({
      secretsDir: '/test',
      name: 'GOOGLE_KEY_JSON1',
      contents_base64: Buffer.from('value', 'utf-8').toString('base64'),
    });
    const path2 = createTemporaryEnvironmentSecretFile({
      secretsDir: '/test',
      name: 'GOOGLE_KEY_JSON2',
      contents_base64: Buffer.from('value', 'utf-8').toString('base64'),
    });
    expect(path1).not.toEqual(path2);
  });
});

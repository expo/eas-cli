import fs from 'fs/promises';

import { vol } from 'memfs';

import { createTemporaryEnvironmentSecretFile } from '../environmentSecrets';

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

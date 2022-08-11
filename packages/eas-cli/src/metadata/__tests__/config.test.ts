import path from 'path';

import { confirmAsync } from '../../prompts';
import { loadConfigAsync } from '../config';

jest.mock('../../prompts', () => ({ confirmAsync: jest.fn(() => true) }));

describe(loadConfigAsync, () => {
  const projectDir = path.resolve(__dirname, 'fixtures');

  it(`throws when file doesn't exists`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'doesnt-exists.json' })
    ).rejects.toThrow('file not found');
  });

  it(`throws when validation errors are found without skipping`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.json' })
    ).rejects.toThrow('errors found');
  });

  it(`returns json config`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'store.config.json' })
    ).resolves.toHaveProperty('apple.copyright', '2022 ACME');
  });

  it(`returns js config`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'store.config.js' })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns json config when skipping validation`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.json' })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns js config when skipping validation`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.js' })
    ).resolves.toMatchObject({ configVersion: -1 });
  });
});

import fs from 'fs';
import path from 'path';
import tempy from 'tempy';

import { confirmAsync } from '../../prompts';
import { loadConfigAsync, saveConfigAsync } from '../config';

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

describe(saveConfigAsync, () => {
  const config = require('./fixtures/store.config');
  let projectDir: string;

  beforeAll(async () => {
    // We can't use memfs in this case, because we are evaluating js modules.
    // Instead, we will write the files to the temporary directory and use that instead.
    projectDir = tempy.directory({ prefix: 'saveConfigAsync' });
  });

  afterAll(async () => {
    await fs.promises.rm(projectDir, { recursive: true });
  });

  it(`throws for unknown extensions`, async () => {
    await expect(
      saveConfigAsync(config, { projectDir, metadataPath: 'not.supported.mjs' })
    ).rejects.toThrow('Unkown store config extension');
  });

  it(`saves valid json config`, async () => {
    await saveConfigAsync(config, { projectDir, metadataPath: 'store.config.json' });
    const savedConfig = await fs.promises
      .readFile(path.join(projectDir, 'store.config.json'))
      .then(content => JSON.parse(content.toString()));

    expect(savedConfig).toMatchObject(config);
  });

  it(`saves valid js config`, async () => {
    await saveConfigAsync(config, { projectDir, metadataPath: 'store.config.js' });
    const savedConfig = require(path.join(projectDir, 'store.config.js'));

    expect(savedConfig).toMatchObject(config);
  });
});

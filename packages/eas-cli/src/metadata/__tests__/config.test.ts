import path from 'path';

import { confirmAsync } from '../../prompts';
import { getStaticConfigFile, loadConfigAsync } from '../config';

jest.mock('../../prompts', () => ({ confirmAsync: jest.fn(() => true) }));

describe(getStaticConfigFile, () => {
  const projectDir = '/app';

  it(`returns same file for store.config.json`, () => {
    const metadataPath = 'store.config.json';
    const expectedFile = path.join(projectDir, metadataPath);

    expect(getStaticConfigFile({ projectDir, metadataPath })).toBe(expectedFile);
  });

  it(`returns store.config.json for store.config.js`, () => {
    const metadataPath = 'store.config.js';
    const expectedFile = path.join(projectDir, 'store.config.json');

    expect(getStaticConfigFile({ projectDir, metadataPath })).toBe(expectedFile);
  });

  it(`returns store.staging.json file for store.staging.js`, () => {
    const metadataPath = 'store.staging.js';
    const expectedFile = path.join(projectDir, 'store.staging.json');

    expect(getStaticConfigFile({ projectDir, metadataPath })).toBe(expectedFile);
  });

  // This shouldn't be used IRL, but it tests if this function is working properly
  it(`returns custom-name.json file for custom-name.js`, () => {
    const metadataPath = 'custom-name.js';
    const expectedFile = path.join(projectDir, 'custom-name.json');

    expect(getStaticConfigFile({ projectDir, metadataPath })).toBe(expectedFile);
  });
});

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

  it(`returns config from "store.config.json"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'store.config.json' })
    ).resolves.toHaveProperty('apple.copyright', 'ACME');
  });

  it(`returns config from "store.config.js"`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'store.config.js' })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns config from "store.function.js"`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'store.function.js' })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns config from "store.async.js"`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'store.async.js' })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns invalid config from "invalid.config.json`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.json' })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.config.js`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.js' })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.function.js`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.function.js' })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.async.js`, async () => {
    jest.mocked(confirmAsync).mockResolvedValue(true);
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.async.js' })
    ).resolves.toMatchObject({ configVersion: -1 });
  });
});

import path from 'path';

import { getStaticConfigFilePath, loadConfigAsync } from '../config';
import { MetadataValidationError } from '../errors';

describe(getStaticConfigFilePath, () => {
  const projectDir = '/app';

  it(`returns same file for store.config.json`, () => {
    const metadataPath = 'store.config.json';
    const expectedFile = path.join(projectDir, metadataPath);

    expect(getStaticConfigFilePath({ projectDir, metadataPath })).toBe(expectedFile);
  });

  it(`returns store.config.json for store.config.js`, () => {
    const metadataPath = 'store.config.js';
    const expectedFile = path.join(projectDir, 'store.config.json');

    expect(getStaticConfigFilePath({ projectDir, metadataPath })).toBe(expectedFile);
  });

  it(`returns store.staging.json file for store.staging.js`, () => {
    const metadataPath = 'store.staging.js';
    const expectedFile = path.join(projectDir, 'store.staging.json');

    expect(getStaticConfigFilePath({ projectDir, metadataPath })).toBe(expectedFile);
  });

  // This shouldn't be used IRL, but it tests if this function is working properly
  it(`returns custom-name.json file for custom-name.js`, () => {
    const metadataPath = 'custom-name.js';
    const expectedFile = path.join(projectDir, 'custom-name.json');

    expect(getStaticConfigFilePath({ projectDir, metadataPath })).toBe(expectedFile);
  });
});

describe(loadConfigAsync, () => {
  const projectDir = path.resolve(__dirname, 'fixtures');

  it(`throws when file doesn't exist`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'doesnt-exist.json' })
    ).rejects.toThrow('file not found');
  });

  it(`throws when validation errors are found without skipping validation`, async () => {
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
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.json', skipValidation: true })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.config.js`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.config.js', skipValidation: true })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.function.js`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.function.js', skipValidation: true })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.async.js`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid.async.js', skipValidation: true })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`throws invalid config type from "invalid-type.config.json"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid-type.config.json' })
    ).rejects.toThrow(MetadataValidationError);
  });

  it(`throws invalid config type from "invalid-type.config.js"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid-type.config.js' })
    ).rejects.toThrow(MetadataValidationError);
  });

  it(`throws invalid config type from "invalid-type.function.js"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid-type.function.js' })
    ).rejects.toThrow(MetadataValidationError);
  });

  it(`throws invalid config type from "invalid-type.async.js"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, metadataPath: 'invalid-type.async.js' })
    ).rejects.toThrow(MetadataValidationError);
  });
});

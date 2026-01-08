import os from 'node:os';

import { vol, fs } from 'memfs';

if (process.env.NODE_ENV !== 'test') {
  throw new Error("NODE_ENV environment variable must be set to 'test'.");
}

// Always mock:
jest.mock('fs');
jest.mock('node:fs', () => fs);
jest.mock('fs/promises');
jest.mock('node:fs/promises', () => fs.promises);
jest.mock('node-fetch');

beforeEach(() => {
  vol.reset();
  vol.fromNestedJSON({
    [os.tmpdir()]: {},
  });
});

import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';

import { EasJsonAccessor } from '../accessor';
import { InvalidEasJsonError } from '../errors';

const fixturesDir = path.join(__dirname, 'fixtures');
const fakeAppPath = '/fake/path/app';

const fsReal = jest.requireActual('fs').promises as typeof fs;
jest.mock('fs');

beforeEach(async () => {
  vol.reset();
});

describe(EasJsonAccessor, () => {
  test('patching JSON file', async () => {
    vol.fromJSON(
      {
        './eas.json': await fsReal.readFile(path.join(fixturesDir, 'eas-json.json'), 'utf-8'),
      },
      fakeAppPath
    );

    const accessor = new EasJsonAccessor(fakeAppPath);
    await accessor.readAsync();
    accessor.patch(o => {
      o.build.production.env.ABC = '456';
      return o;
    });
    await accessor.writeAsync();

    const newEasJsonContents = await fs.readFile(path.join(fakeAppPath, 'eas.json'), 'utf-8');
    expect(newEasJsonContents).toMatchSnapshot();
  });

  test('patching JSON5 file (preserves comments)', async () => {
    vol.fromJSON(
      {
        './eas.json': await fsReal.readFile(path.join(fixturesDir, 'eas-json5.json'), 'utf-8'),
      },
      fakeAppPath
    );

    const accessor = new EasJsonAccessor(fakeAppPath);
    await accessor.readAsync();
    accessor.patch(o => {
      o.build.production.env.ABC = '456';
      return o;
    });
    await accessor.writeAsync();

    const newEasJsonContents = await fs.readFile(path.join(fakeAppPath, 'eas.json'), 'utf-8');
    expect(newEasJsonContents).toMatchSnapshot();
  });

  test('reading invalid JSON5 object', async () => {
    vol.fromJSON(
      {
        './eas.json': await fsReal.readFile(
          path.join(fixturesDir, 'eas-invalid-json5.json'),
          'utf-8'
        ),
      },
      fakeAppPath
    );

    const accessor = new EasJsonAccessor(fakeAppPath);
    await expect(accessor.readAsync()).rejects.toThrowError(InvalidEasJsonError);
    await expect(accessor.readAsync()).rejects.toThrowError(
      /^Found invalid character in.+eas\.json.+/
    );
  });
});

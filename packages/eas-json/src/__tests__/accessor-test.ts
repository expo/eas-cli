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

describe(EasJsonAccessor.fromProjectPath, () => {
  test('patching JSON file', async () => {
    vol.fromJSON(
      {
        './eas.json': await fsReal.readFile(path.join(fixturesDir, 'eas-json.json'), 'utf-8'),
      },
      fakeAppPath
    );

    const accessor = EasJsonAccessor.fromProjectPath(fakeAppPath);
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

    const accessor = EasJsonAccessor.fromProjectPath(fakeAppPath);
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

    const accessor = EasJsonAccessor.fromProjectPath(fakeAppPath);
    await expect(accessor.readAsync()).rejects.toThrowError(InvalidEasJsonError);
    await expect(accessor.readAsync()).rejects.toThrowError(
      /^Found invalid character in .*eas\.json.+/
    );
  });

  test('reading empty JSON file', async () => {
    vol.fromJSON(
      {
        './eas.json': await fsReal.readFile(path.join(fixturesDir, 'eas-empty.json'), 'utf-8'),
      },
      fakeAppPath
    );

    const accessor = EasJsonAccessor.fromProjectPath(fakeAppPath);
    await expect(accessor.readAsync()).rejects.toThrowError(InvalidEasJsonError);
    await expect(accessor.readAsync()).rejects.toThrowError(/^.*eas\.json.* is empty\.$/g);
  });
});

describe(EasJsonAccessor.fromRawString, () => {
  test('patching JSON file', async () => {
    const accessor = EasJsonAccessor.fromRawString(
      await fsReal.readFile(path.join(fixturesDir, 'eas-json.json'), 'utf-8')
    );
    await accessor.readAsync();
    expect(() =>
      accessor.patch(o => {
        o.build.production.env.ABC = '456';
        return o;
      })
    ).toThrowError();
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

    const accessor = EasJsonAccessor.fromRawString(
      await fsReal.readFile(path.join(fixturesDir, 'eas-invalid-json5.json'), 'utf-8')
    );
    await expect(accessor.readAsync()).rejects.toThrowError(InvalidEasJsonError);
    await expect(accessor.readAsync()).rejects.toThrowError(
      /^Found invalid character in .*eas\.json.+/
    );
  });

  test('reading empty JSON file', async () => {
    vol.fromJSON(
      {
        './eas.json': await fsReal.readFile(path.join(fixturesDir, 'eas-empty.json'), 'utf-8'),
      },
      fakeAppPath
    );

    const accessor = EasJsonAccessor.fromRawString(
      await fsReal.readFile(path.join(fixturesDir, 'eas-empty.json'), 'utf-8')
    );
    await expect(accessor.readAsync()).rejects.toThrowError(InvalidEasJsonError);
    await expect(accessor.readAsync()).rejects.toThrowError(/^.*eas\.json.* is empty\.$/g);
  });
});

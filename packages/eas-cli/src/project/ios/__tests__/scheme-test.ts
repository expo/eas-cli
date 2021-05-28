import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { asMock } from '../../../__tests__/utils';
import { promptAsync } from '../../../prompts';
import { selectSchemeAsync } from '../scheme';

jest.mock('fs');
jest.mock('../../../prompts');

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});

beforeEach(() => {
  vol.reset();
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  fs.mkdirpSync(os.tmpdir());

  asMock(promptAsync).mockReset();
});

afterAll(() => {
  fs.removeSync(os.tmpdir());
  console.log = originalConsoleLog;
});

describe(selectSchemeAsync, () => {
  const projectDir = '/app';

  describe('single scheme', () => {
    it('returns its name', async () => {
      vol.fromJSON(
        {
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme1.xcscheme': 'fakecontents',
        },
        projectDir
      );
      const scheme = await selectSchemeAsync({ projectDir });
      expect(scheme).toBe('scheme1');
      expect(promptAsync).not.toHaveBeenCalled();
    });
  });
  describe('multiple schemes', () => {
    it("non-interactive mode: selects the first scheme without 'tvOS' in the name", async () => {
      vol.fromJSON(
        {
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme1-tvOS.xcscheme': 'fakecontents',
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme2.xcscheme': 'fakecontents',
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme3.xcscheme': 'fakecontents',
        },
        projectDir
      );
      const scheme = await selectSchemeAsync({ projectDir, nonInteractive: true });
      expect(scheme).toBe('scheme2');
      expect(promptAsync).not.toHaveBeenCalled();
    });
    it('interactive mode: displays a prompt to select the scheme', async () => {
      vol.fromJSON(
        {
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme1-tvOS.xcscheme': 'fakecontents',
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme2.xcscheme': 'fakecontents',
          'ios/multitarget.xcodeproj/xcshareddata/xcschemes/scheme3.xcscheme': 'fakecontents',
        },
        projectDir
      );
      asMock(promptAsync).mockImplementationOnce(() => ({
        selectedScheme: 'scheme3',
      }));

      const scheme = await selectSchemeAsync({ projectDir });
      expect(scheme).toBe('scheme3');
      expect(promptAsync).toHaveBeenCalled();
    });
  });
});

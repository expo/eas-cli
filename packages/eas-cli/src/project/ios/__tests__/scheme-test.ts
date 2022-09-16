import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { promptAsync } from '../../../prompts';
import { selectSchemeAsync } from '../scheme';

jest.mock('fs');
jest.mock('../../../prompts');

beforeEach(async () => {
  vol.reset();

  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.mkdirp(os.tmpdir());

  jest.mocked(promptAsync).mockReset();
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
      const scheme = await selectSchemeAsync({ projectDir, nonInteractive: true });
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
      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
        selectedScheme: 'scheme3',
      }));

      const scheme = await selectSchemeAsync({ projectDir, nonInteractive: false });
      expect(scheme).toBe('scheme3');
      expect(promptAsync).toHaveBeenCalled();
    });
  });
});

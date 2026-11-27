import { Platform } from '@expo/eas-build-job';

import { BUILD_NUMBER_FORMAT, resolveNextBuildNumber } from '../buildNumberRules';

describe('BUILD_NUMBER_FORMAT', () => {
  it.each(['1', '42', '1.2', '1.2.3', '2026112501', '007'])('accepts %s on iOS', value => {
    expect(BUILD_NUMBER_FORMAT[Platform.IOS].isValid(value)).toBe(true);
  });

  it.each(['', '1.2.3.4', '1.', '.1', '1a', '-1', '$(CURRENT_PROJECT_VERSION)', '1 2'])(
    'rejects "%s" on iOS',
    value => {
      expect(BUILD_NUMBER_FORMAT[Platform.IOS].isValid(value)).toBe(false);
    }
  );

  it.each(['1', '42', '2026112501', '2100000000'])('accepts %s on Android', value => {
    expect(BUILD_NUMBER_FORMAT[Platform.ANDROID].isValid(value)).toBe(true);
  });

  it.each(['', '0', '2100000001', '1.2', '1a', '-1', '1 2', '1e3'])(
    'rejects "%s" on Android',
    value => {
      expect(BUILD_NUMBER_FORMAT[Platform.ANDROID].isValid(value)).toBe(false);
    }
  );
});

describe(resolveNextBuildNumber, () => {
  it.each([
    { storedBuildNumber: undefined, projectBuildNumber: undefined, expected: '1' },
    { storedBuildNumber: undefined, projectBuildNumber: '1', expected: '1' },
    { storedBuildNumber: undefined, projectBuildNumber: '7', expected: '8' },
    { storedBuildNumber: undefined, projectBuildNumber: '1.0', expected: '1.1' },
    { storedBuildNumber: '1', projectBuildNumber: '1', expected: '2' },
    { storedBuildNumber: '42', projectBuildNumber: undefined, expected: '43' },
    { storedBuildNumber: '42', projectBuildNumber: '7', expected: '43' },
    { storedBuildNumber: '42', projectBuildNumber: '42', expected: '43' },
    { storedBuildNumber: '42', projectBuildNumber: '100', expected: '101' },
    { storedBuildNumber: '9', projectBuildNumber: '10', expected: '11' },
    { storedBuildNumber: '1.2.9', projectBuildNumber: '1.2.10', expected: '1.2.11' },
    { storedBuildNumber: '1.3', projectBuildNumber: '1.2.10', expected: '1.4' },
    { storedBuildNumber: '2', projectBuildNumber: '1.9.9', expected: '3' },
    { storedBuildNumber: '1.2', projectBuildNumber: '1.2.0', expected: '1.3' },
    {
      storedBuildNumber: '9007199254740993',
      projectBuildNumber: '1',
      expected: '9007199254740994',
    },
  ])(
    'gives $expected when EAS stores $storedBuildNumber and the project has $projectBuildNumber',
    ({ storedBuildNumber, projectBuildNumber, expected }) => {
      expect(resolveNextBuildNumber({ storedBuildNumber, projectBuildNumber })).toBe(expected);
    }
  );
});

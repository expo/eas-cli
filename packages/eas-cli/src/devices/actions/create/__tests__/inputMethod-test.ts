import prompts from 'prompts';

import { asMock } from '../../../../__tests__/utils';
import { graphqlClient } from '../../../../api';
import { AppleTeam } from '../../../../credentials/ios/api/AppleTeam';
import { AppleDeviceClass, runInputMethodAsync } from '../inputMethod';

jest.mock('prompts');
jest.mock('../../../../api', () => ({
  graphqlClient: {
    mutation: jest.fn().mockReturnValue({
      toPromise: () => ({
        data: {
          appleDevice: {
            createAppleDevice: {},
          },
        },
      }),
    }),
  },
}));

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});

beforeEach(() => {
  jest.resetModules();
  asMock(prompts).mockReset();
  asMock(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe(runInputMethodAsync, () => {
  it('should allow for multiple device registration', async () => {
    mockDeviceData('00001111-001122334455662E', 'my iPhone', AppleDeviceClass.IPHONE);
    asMock(prompts).mockImplementationOnce(() => ({ value: true }));
    mockDeviceData('b12cba9856d89c932ab7a4b813c4d932534e1679', 'my iPad', AppleDeviceClass.IPAD);
    asMock(prompts).mockImplementationOnce(() => ({ value: false }));

    const accountId = 'account-id';
    const appleTeam: AppleTeam = {
      id: 'apple-team-id',
      account: {
        id: accountId,
        name: 'accountname',
      },
      appleTeamIdentifier: 'ABC123XY',
      appleTeamName: 'John Doe (Individual)',
    };

    await runInputMethodAsync(accountId, appleTeam);

    // TODO: refactor this once https://github.com/expo/eas-cli/pull/38 is merged
    expect(graphqlClient.mutation).toHaveBeenCalledTimes(2);
  });
});

function mockDeviceData(udid: string, name: string, deviceClass: AppleDeviceClass): void {
  asMock(prompts).mockImplementationOnce(() => ({ udid }));
  asMock(prompts).mockImplementationOnce(() => ({ name }));
  asMock(prompts).mockImplementationOnce(() => ({ deviceClass }));
  asMock(prompts).mockImplementationOnce(() => ({ value: true }));
}

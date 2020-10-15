import prompts from 'prompts';

import { asMock } from '../../../../__tests__/utils';
import { Account } from '../../../../user/Account';
import DeviceCreateAction, { RegistrationMethod } from '../action';
import { generateDeviceRegistrationURL } from '../registration-url';

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

jest.mock('prompts');
jest.mock('../registration-url');

beforeEach(() => {
  const promptsMock = asMock(prompts);
  promptsMock.mockReset();
  promptsMock.mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe(DeviceCreateAction, () => {
  describe('#runAsync', () => {
    it('calls generateDeviceRegistrationURL if user chooses the website option', async () => {
      asMock(prompts).mockImplementationOnce(() => ({
        method: RegistrationMethod.WEBSITE,
      }));

      const account: Account = {
        id: 'account_id',
        name: 'foobar',
      };
      const appleTeamId = 'ABC123Y';
      const action = new DeviceCreateAction(account, appleTeamId);
      await action.runAsync();

      expect(generateDeviceRegistrationURL).toBeCalled();
    });
  });
});

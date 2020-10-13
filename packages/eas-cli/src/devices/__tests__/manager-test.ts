import prompts from 'prompts';

import { asMock } from '../../__tests__/utils';
import { User } from '../../user/User';
import { AccountResolver } from '../manager';

jest.mock('prompts');

jest.mock('../../project', () => {
  return {
    getProjectAccountNameAsync: () => 'foo',
  };
});

beforeEach(() => {
  asMock(prompts).mockReset();
  asMock(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe(AccountResolver, () => {
  describe('#resolveAccountAsync', () => {
    const user: User = {
      userId: 'user_id_666',
      username: 'dominik',
      accounts: [
        { id: 'account_id_777', name: 'dominik' },
        { id: 'account_id_888', name: 'foo' },
      ],
    };

    describe('when inside project dir', () => {
      const projectDir = '/app';

      it('returns the account defined in app.json/app.config.js if user confirms', async () => {
        asMock(prompts).mockImplementationOnce(() => ({
          value: true,
        }));

        const resolver = new AccountResolver(projectDir, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[1]);
      });

      it('asks the user to choose the account from his account list if he rejects to use the one defined in app.json / app.config.js', async () => {
        asMock(prompts).mockImplementationOnce(() => ({
          useProjectAccount: false,
        }));
        asMock(prompts).mockImplementationOnce(() => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(projectDir, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });

      it(`asks the user to choose the account from his account list if he doesn't have access to the account defined in app.json / app.config.js`, async () => {
        asMock(prompts).mockImplementationOnce(() => ({
          account: user.accounts[0],
        }));

        const userWithAccessToProjectAccount: User = {
          ...user,
          accounts: [user.accounts[0]],
        };

        const originalConsoleWarn = console.warn;
        console.warn = jest.fn();

        const resolver = new AccountResolver(projectDir, userWithAccessToProjectAccount);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
        expect(console.warn).toBeCalledWith(expect.stringMatching(/doesn't have access to the/));

        console.warn = originalConsoleWarn;
      });
    });

    describe('when outside project dir', () => {
      it('asks the user to choose the account from his account list', async () => {
        asMock(prompts).mockImplementationOnce(() => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(null, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });
    });
  });
});

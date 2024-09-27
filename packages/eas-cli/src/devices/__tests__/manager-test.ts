import prompts from 'prompts';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Role } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { Actor } from '../../user/User';
import { AccountResolver } from '../manager';

jest.mock('prompts');

jest.mock('../../credentials/ios/api/graphql/queries/AppleTeamQuery');
jest.mock('../../graphql/queries/AppQuery');

beforeEach(() => {
  jest.mocked(prompts).mockReset();
  jest.mocked(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe(AccountResolver, () => {
  describe('#resolveAccountAsync', () => {
    const user: Actor = {
      __typename: 'User',
      id: 'user_id_666',
      username: 'dominik',
      primaryAccount: {
        id: 'account_id_777',
        name: 'dominik',
        users: [{ role: Role.Owner, actor: { id: 'user_id_666' } }],
      },
      accounts: [
        {
          id: 'account_id_777',
          name: 'dominik',
          users: [{ role: Role.Owner, actor: { id: 'user_id_666' } }],
        },
        {
          id: 'account_id_888',
          name: 'foo',
          users: [{ role: Role.Owner, actor: { id: 'user_id_666' } }],
        },
      ],
      isExpoAdmin: false,
      featureGates: {},
      preferences: {},
    };

    describe('when inside project dir', () => {
      beforeEach(() => {
        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: 'test-project-id',
          fullName: '@foo/wat',
          name: 'wat',
          slug: 'wat',
          ownerAccount: {
            id: 'account_id_888',
            name: 'foo',
            users: [{ role: Role.Owner, actor: { id: 'user_id_666' } }],
          },
        });
      });

      it('returns the account defined in app.json/app.config.js if user confirms', async () => {
        const graphqlClient = instance(mock<ExpoGraphqlClient>());
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          value: true,
        }));

        const resolver = new AccountResolver(graphqlClient, '1234', user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual({
          id: user.accounts[1].id,
          name: user.accounts[1].name,
          users: user.accounts[1].users,
        });
      });

      it('asks the user to choose the account from his account list if he rejects to use the one defined in app.json / app.config.js', async () => {
        const graphqlClient = instance(mock<ExpoGraphqlClient>());
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          useProjectAccount: false,
        }));
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(graphqlClient, '1234', user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });
    });

    describe('when outside project dir', () => {
      it('asks the user to choose the account from his account list', async () => {
        const graphqlClient = instance(mock<ExpoGraphqlClient>());
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(graphqlClient, null, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });
    });
  });
});

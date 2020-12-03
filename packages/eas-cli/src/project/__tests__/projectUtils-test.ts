import { getConfig } from '@expo/config';
import { vol } from 'memfs';

import { asMock } from '../../__tests__/utils';
import { Actor, getUserAsync } from '../../user/User';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../projectUtils';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../../user/User');

describe(findProjectRootAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('returns null if not inside the project directory', async () => {
    vol.fromJSON(
      {
        './README.md': '1',
      },
      '/app'
    );
    const projectRoot = await findProjectRootAsync('/app');
    expect(projectRoot).toBeNull();
  });

  it('returns the root directory of the project', async () => {
    vol.fromJSON(
      {
        './README.md': '1',
        './package.json': '2',
        './src/index.ts': '3',
      },
      '/app'
    );
    const projectRoot = await findProjectRootAsync('/app/src');
    expect(projectRoot).toBe('/app');
  });
});

describe(getProjectAccountNameAsync, () => {
  beforeEach(() => {
    asMock(getConfig).mockReset();
    asMock(getUserAsync).mockReset();
  });

  it(`returns the owner field's value from app.json / app.config.js`, async () => {
    asMock(getConfig).mockImplementation(() => ({
      exp: {
        owner: 'dominik',
      },
    }));
    asMock(getUserAsync).mockImplementation((): Actor | undefined => ({
      __typename: 'User',
      id: 'user_id',
      username: 'notnotbrent',
      accounts: [
        { id: 'account_id_1', name: 'notnotbrent' },
        { id: 'account_id_2', name: 'dominik' },
      ],
    }));

    const projectAccountName = await getProjectAccountNameAsync('/app');
    expect(projectAccountName).toBe('dominik');
  });

  it(`returns the username if owner field is not set in app.json / app.config.js`, async () => {
    asMock(getConfig).mockImplementation(() => ({
      exp: {},
    }));
    asMock(getUserAsync).mockImplementation((): Actor | undefined => ({
      __typename: 'User',
      id: 'user_id',
      username: 'notnotbrent',
      accounts: [
        { id: 'account_id_1', name: 'notnotbrent' },
        { id: 'account_id_2', name: 'dominik' },
      ],
    }));

    const projectAccountName = await getProjectAccountNameAsync('/app');
    expect(projectAccountName).toBe('notnotbrent');
  });

  it(`throws an error if the user is not logged in`, async () => {
    asMock(getConfig).mockImplementation(() => ({
      exp: {
        owner: 'dominik',
      },
    }));
    asMock(getUserAsync).mockImplementation((): Actor | undefined => undefined);

    expect(getProjectAccountNameAsync('/app')).rejects.toThrow(/logged in/);
  });
});

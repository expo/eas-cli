import { vol } from 'memfs';

import { asMock } from '../../__tests__/utils';
import { Actor, getUserAsync } from '../../user/User';
import {
  findProjectRootAsync,
  getProjectAccountName,
  getProjectAccountNameAsync,
} from '../projectUtils';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../../user/User');

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

describe(getProjectAccountName, () => {
  const expWithOwner: any = { owner: 'dominik' };
  const expWithoutOwner: any = {};

  it('returns owner for user actor', () => {
    const projectAccountName = getProjectAccountName(expWithOwner, {
      __typename: 'User',
      id: 'userId',
      username: 'notbrent',
      accounts: [],
      isExpoAdmin: false,
    });
    expect(projectAccountName).toBe(expWithOwner.owner);
  });

  it('returns owner for robot actor', () => {
    const projectAccountName = getProjectAccountName(expWithOwner, {
      __typename: 'Robot',
      id: 'userId',
      firstName: 'notauser',
      accounts: [],
      isExpoAdmin: false,
    });
    expect(projectAccountName).toBe(expWithOwner.owner);
  });

  it('returns username for user actor when owner is undefined', () => {
    const projectAccountName = getProjectAccountName(expWithoutOwner, {
      __typename: 'User',
      id: 'userId',
      username: 'dominik',
      accounts: [],
      isExpoAdmin: false,
    });
    expect(projectAccountName).toBe('dominik');
  });

  it('throws for robot actor when owner is undefined', () => {
    const resolveProjectAccountName = () =>
      getProjectAccountName(expWithoutOwner, {
        __typename: 'Robot',
        id: 'userId',
        firstName: 'notauser',
        accounts: [],
        isExpoAdmin: false,
      });
    expect(resolveProjectAccountName).toThrow('manifest property is required');
  });
});

describe(getProjectAccountNameAsync, () => {
  const expWithOwner: any = { owner: 'dominik' };
  const expWithoutOwner: any = {};

  beforeEach(() => {
    asMock(getUserAsync).mockReset();
  });

  it(`returns the owner field's value from app.json / app.config.js`, async () => {
    asMock(getUserAsync).mockImplementation((): Actor | undefined => ({
      __typename: 'User',
      id: 'user_id',
      username: 'notnotbrent',
      accounts: [
        { id: 'account_id_1', name: 'notnotbrent' },
        { id: 'account_id_2', name: 'dominik' },
      ],
      isExpoAdmin: false,
    }));

    const projectAccountName = await getProjectAccountNameAsync(expWithOwner);
    expect(projectAccountName).toBe('dominik');
  });

  it(`returns the username if owner field is not set in app.json / app.config.js`, async () => {
    asMock(getUserAsync).mockImplementation((): Actor | undefined => ({
      __typename: 'User',
      id: 'user_id',
      username: 'notnotbrent',
      accounts: [
        { id: 'account_id_1', name: 'notnotbrent' },
        { id: 'account_id_2', name: 'dominik' },
      ],
      isExpoAdmin: false,
    }));

    const projectAccountName = await getProjectAccountNameAsync(expWithoutOwner);
    expect(projectAccountName).toBe('notnotbrent');
  });

  it(`throws an error if the user is not logged in`, async () => {
    asMock(getUserAsync).mockImplementation((): Actor | undefined => undefined);

    await expect(getProjectAccountNameAsync(expWithOwner)).rejects.toThrow(
      /Failed to access user data/
    );
  });

  it(`throws when project owner is undefined for robot actors`, async () => {
    asMock(getUserAsync).mockImplementation((): Actor | undefined => ({
      __typename: 'Robot',
      id: 'user_id',
      firstName: 'GLaDOS',
      accounts: [
        { id: 'account_id_1', name: 'notnotbrent' },
        { id: 'account_id_2', name: 'dominik' },
      ],
      isExpoAdmin: false,
    }));
    await expect(getProjectAccountNameAsync(expWithoutOwner)).rejects.toThrow(
      'manifest property is required'
    );
  });
});

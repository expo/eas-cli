import { vol } from 'memfs';

import Build from '..';
import { createTestProject } from '../../../__tests__/project-utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';

// Kirby - cannot be in the commands folder or oclif will pick it up as a valid command
// seems there is some pattern to exclude https://github.com/oclif/config/blob/master/src/plugin.ts#L230 but couldn't get it to work
describe(Build.name, () => {
  const testProject = createTestProject(mockJester, {
    android: {
      package: 'com.expo.test.project',
    },
  });

  const fakeFiles: Record<string, string> = {
    '/apks/fake.apk': 'fake apk',
    '/google-service-account.json': JSON.stringify({ service: 'account' }),
  };

  const originalConsoleLog = console.log;

  beforeAll(() => {
    console.log = jest.fn();
    vol.fromJSON({
      ...testProject.projectTree,
      ...fakeFiles,
    });

    jest.mock('../../user/actions', () => ({
      ensureLoggedInAsync: jest.fn(() => mockJester),
    }));
    jest.mock('../../build/create', () => ({ buildAsync: jest.fn() }));

    const mockManifest = { exp: testProject.appJSON.expo };
    jest.mock('@expo/config', () => ({
      getConfig: jest.fn(() => mockManifest),
    }));

    // jest.mock('../', () => ({
    //   apiClient: {
    //     post: jest.fn(() => {
    //       return {
    //         json: () => Promise.resolve({ data: { sessionSecret: 'SESSION_SECRET' } }),
    //       };
    //     }),
    //   },
    // }));
    // jest.mock('../../graphql/client', () => ({
    //   graphqlClient: {
    //     query: () => {
    //       return {
    //         toPromise: () =>
    //           Promise.resolve({ data: { viewer: { id: 'USER_ID', username: 'USERNAME' } } }),
    //       };
    //     },
    //   },
    // }));
    // jest.mock('../../graphql/queries/UserQuery', () => ({
    //   UserQuery: {
    //     currentUserAsync: async () => ({ __typename: 'User', username: 'USERNAME', id: 'USER_ID' }),
    //   },
    // }));
  });

  afterAll(() => {
    vol.reset();
    jest.unmock('@expo/config');
    console.log = originalConsoleLog;
  });

  it('runs', async () => {
    let spy = jest.spyOn(process.stdout, 'write');
    // await nock(getExpoApiBaseUrl()).
    // await Build.run([]);
    expect(spy).toHaveBeenCalledWith('test');
  });
});

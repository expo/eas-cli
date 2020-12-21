import { getUpdates } from '../updateUtils';

jest.mock('../../graphql/client', () => {
  const response = {
    app: {
      byId: {
        updateReleaseByReleaseName: {
          id: '1',
          updates: [
            {
              id: 'update-id-1',
              updateGroup: 'update-group-id-1',
              updateMessage: 'update-message-1',
              createdAt: '2020-12-04T19:33:47.172Z',
              platform: 'ios',
              runtimeVersion: '10',
              actor: {
                username: 'username',
              },
              __typename: 'Update',
            },
            {
              id: 'update-id-2',
              updateGroup: 'update-group-id-1',
              updateMessage: 'update-message-2',
              createdAt: '2020-12-04T19:33:47.172Z',
              platform: 'android',
              runtimeVersion: '10',
              actor: {
                username: 'username',
              },
              __typename: 'Update',
            },
            {
              id: 'update-id-3',
              updateGroup: 'update-group-id-2',
              updateMessage: 'update-message-3',
              createdAt: '2020-12-04T19:33:47.172Z',
              platform: 'ios',
              runtimeVersion: '10',
              actor: {
                username: 'username',
              },
              __typename: 'Update',
            },
          ],
        },
      },
    },
  };

  return {
    withErrorHandlingAsync: () => response,
    graphqlClient: {
      query: () => ({
        toPromise: () => {},
      }),
    },
  };
});

describe('update:list', () => {
  it('returns updates group by update group id', async () => {
    const result = await getUpdates({
      projectId: 'project-id',
      releaseName: 'release-name',
      platformFlag: undefined,
      allFlag: false,
    });

    expect(result[0].updateGroup).toBe('update-group-id-1');
    expect(result[0].platforms).toBe('android, ios');
    expect(result[1].updateGroup).toBe('update-group-id-2');
    expect(result[1].platforms).toBe('ios');
    expect(result[0].id).not.toBe('update-id-1');
    expect(result.length).toBe(2);
  });

  it('returns updates group by update group id and filtered by platform', async () => {
    const result = await getUpdates({
      projectId: 'project-id',
      releaseName: 'release-name',
      platformFlag: 'android',
      allFlag: false,
    });

    expect(result[0].updateGroup).toBe('update-group-id-1');
    expect(result[0].platforms).toBe('android');
    expect(result.length).toBe(1);
  });

  it('returns all updates', async () => {
    const result = await getUpdates({
      projectId: 'project-id',
      releaseName: 'release-name',
      platformFlag: undefined,
      allFlag: true,
    });

    expect(result[0].id).toBe('update-id-1');
    expect(result[1].id).toBe('update-id-2');
    expect(result[2].id).toBe('update-id-3');
    expect(result.length).toBe(3);
  });

  it('returns all updates filtered by platform', async () => {
    const result = await getUpdates({
      projectId: 'project-id',
      releaseName: 'release-name',
      platformFlag: 'ios',
      allFlag: true,
    });

    expect(result[0].id).toBe('update-id-1');
    expect(result.length).toBe(2);
  });
});

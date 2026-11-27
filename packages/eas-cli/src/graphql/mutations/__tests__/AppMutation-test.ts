import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppMutation } from '../AppMutation';

async function getCreateAppInputAsync(displayName?: string): Promise<unknown> {
  const mutation = jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue({ data: { app: { createApp: { id: 'app-id' } } } }),
  });
  await AppMutation.createAppAsync({ mutation } as unknown as ExpoGraphqlClient, {
    accountId: 'account-id',
    projectName: 'my-app',
    displayName,
  });
  return mutation.mock.calls[0][1].appInput;
}

describe('AppMutation.createAppAsync', () => {
  it('sends the trimmed display name', async () => {
    await expect(getCreateAppInputAsync(' My App ')).resolves.toEqual({
      accountId: 'account-id',
      projectName: 'my-app',
      appInfo: { displayName: 'My App' },
    });
  });

  it.each([undefined, '', '   ', 'my-app', 'x'.repeat(256)])(
    'sends no display name for %p',
    async displayName => {
      await expect(getCreateAppInputAsync(displayName)).resolves.toEqual({
        accountId: 'account-id',
        projectName: 'my-app',
      });
    }
  );
});

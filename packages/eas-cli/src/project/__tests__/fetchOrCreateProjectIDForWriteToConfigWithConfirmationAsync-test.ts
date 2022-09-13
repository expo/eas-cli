import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';

describe(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync, () => {
  it('throws when non-interactive is specified but interaction is required', async () => {
    await expect(
      fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
        { accountName: 'fake', projectName: 'fake' },
        { nonInteractive: true }
      )
    ).rejects.toThrow(
      `Must configure EAS project by running 'eas init' before this command can be run in non-interactive mode.`
    );
  });
});

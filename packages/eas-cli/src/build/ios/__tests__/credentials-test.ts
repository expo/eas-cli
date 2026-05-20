import { Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';

import { BuildContext } from '../../context';
import { ensureIosCredentialsAsync } from '../credentials';

describe(ensureIosCredentialsAsync, () => {
  it('errors when refresh is enabled with local credentials source', async () => {
    const buildCtx = {
      buildProfile: {
        credentialsSource: CredentialsSource.LOCAL,
        simulator: false,
        withoutCredentials: false,
      },
      credentialsCtx: {
        refreshAdHocProvisioningProfile: true,
      },
    } as BuildContext<Platform.IOS>;

    await expect(ensureIosCredentialsAsync(buildCtx, [])).rejects.toThrow(
      '--refresh-ad-hoc-provisioning-profile cannot be used with credentialsSource "local". Use remote credentials or omit the flag.'
    );
  });

  it('does not reject refresh when credentials source is remote', async () => {
    const buildCtx = {
      buildProfile: {
        credentialsSource: CredentialsSource.REMOTE,
        simulator: true,
        withoutCredentials: false,
        distribution: 'internal',
      },
      credentialsCtx: {
        refreshAdHocProvisioningProfile: true,
      },
    } as BuildContext<Platform.IOS>;

    await expect(ensureIosCredentialsAsync(buildCtx, [])).resolves.toBeUndefined();
  });

  it('errors when distribution certificate refresh is enabled with local credentials source', async () => {
    const buildCtx = {
      buildProfile: {
        credentialsSource: CredentialsSource.LOCAL,
        simulator: false,
        withoutCredentials: false,
      },
      credentialsCtx: {
        refreshDistributionCertificate: true,
      },
    } as BuildContext<Platform.IOS>;

    await expect(ensureIosCredentialsAsync(buildCtx, [])).rejects.toThrow(
      '--refresh-distribution-certificate cannot be used with credentialsSource "local". Use remote credentials or omit the flag.'
    );
  });

  it('does not reject distribution certificate refresh when credentials source is remote', async () => {
    const buildCtx = {
      buildProfile: {
        credentialsSource: CredentialsSource.REMOTE,
        simulator: true,
        withoutCredentials: false,
        distribution: 'store',
      },
      credentialsCtx: {
        refreshDistributionCertificate: true,
      },
    } as BuildContext<Platform.IOS>;

    await expect(ensureIosCredentialsAsync(buildCtx, [])).resolves.toBeUndefined();
  });
});

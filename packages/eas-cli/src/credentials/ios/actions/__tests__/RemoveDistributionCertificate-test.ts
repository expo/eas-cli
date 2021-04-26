import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  testDistCertFragmentNoDependencies,
  testDistCertFragmentOneDependency,
} from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemoveDistributionCertificate } from '../RemoveDistributionCertificate';

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

describe('RemoveDistributionCertificate', () => {
  it('deletes the distribution certificate on Expo and Apple servers when there are no App Dependencies in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeDistCertAction = new RemoveDistributionCertificate(
      appLookupParams.account,
      testDistCertFragmentNoDependencies
    );
    await removeDistCertAction.runAsync(ctx);

    // expect dist cert to be deleted on expo servers
    expect((ctx.ios.deleteDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect dist cert to be deleted on apple portal
    expect((ctx.appStore.revokeDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile deletion to be skipped because there arent any associated with the dist cert
    expect((ctx.ios.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(0);
  });
  it('deletes the distribution certificate on Expo servers when there are no App Dependencies in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeDistCertAction = new RemoveDistributionCertificate(
      appLookupParams.account,
      testDistCertFragmentNoDependencies
    );
    await removeDistCertAction.runAsync(ctx);

    // expect dist cert to be deleted on expo servers
    expect((ctx.ios.deleteDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // not supported in non-interactive mode
    expect((ctx.appStore.revokeDistributionCertificateAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile deletion to be skipped because there arent any associated with the dist cert
    expect((ctx.ios.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(0);
  });
  it('deletes the distribution certificate and its provisioning profile on Expo and Apple servers when there are App Dependencies in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeDistCertAction = new RemoveDistributionCertificate(
      appLookupParams.account,
      testDistCertFragmentOneDependency
    );
    await removeDistCertAction.runAsync(ctx);

    // expect dist cert to be deleted on expo servers
    expect((ctx.ios.deleteDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect dist cert to be deleted on apple portal
    expect((ctx.appStore.revokeDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile deletion to be invoked on expo servers
    expect((ctx.ios.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(1);
  });
  it('errors when the distribution certificate has App Dependencies in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeDistCertAction = new RemoveDistributionCertificate(
      appLookupParams.account,
      testDistCertFragmentOneDependency
    );

    // fail if users are trying to delete a dist cert with dependencies in non-interactive mode
    await expect(removeDistCertAction.runAsync(ctx)).rejects.toThrowError();
  });
});

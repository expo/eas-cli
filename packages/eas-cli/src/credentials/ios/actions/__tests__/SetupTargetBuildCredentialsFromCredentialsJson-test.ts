import { asMock } from '../../../../__tests__/utils';
import { IosDistributionType } from '../../../../graphql/generated';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testAppleAppIdentifierFragment,
  testCommonIosAppCredentialsFragment,
  testDistCert,
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testProvisioningProfileFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { IosTargetCredentials } from '../../../credentialsJson/types';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetupTargetBuildCredentialsFromCredentialsJson } from '../SetupTargetBuildCredentialsFromCredentialsJson';

jest.mock('../../../../prompts');
jest.mock('../../../credentialsJson/read');

beforeEach(() => {
  asMock(confirmAsync).mockReset();
  asMock(confirmAsync).mockImplementation(() => true);
});

describe('SetupTargetBuildCredentialsFromCredentialsJson', () => {
  const targetCredentials: IosTargetCredentials = {
    distributionCertificate: {
      certificateP12: testDistCert.certP12,
      certificatePassword: testDistCert.certPassword,
    },
    provisioningProfile: testProvisioningProfile.provisioningProfile,
  };

  it('sets up build credentials with same prior configuration in Interactive Mode', async () => {
    // create deep clone the quick and dirty way
    const testBuildCreds = JSON.parse(JSON.stringify(testCommonIosAppCredentialsFragment));
    testBuildCreds.iosAppBuildCredentialsList[0].distributionCertificate.certificateP12 =
      testDistCert.certP12;
    testBuildCreds.iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile =
      testProvisioningProfile.provisioningProfile;
    const ctx = createCtxMock({
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => testBuildCreds),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(() => testBuildCreds),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetupTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials not to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(0);
    // expect distribution certificate not to be uploaded on expo servers
    expect(asMock(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be uploaded on expo servers
    expect(asMock(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
  it('sets up build credentials with no prior configuration in Interactive Mode', async () => {
    const ctx = createCtxMock({
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => null),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetupTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(1);
    // expect distribution certificate to be uploaded on expo servers
    expect(asMock(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect(asMock(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
  });
  it('sets up build credentials with different prior configuration in Interactive Mode', async () => {
    // create deep clone the quick and dirty way
    const testBuildCreds = JSON.parse(JSON.stringify(testCommonIosAppCredentialsFragment));
    testBuildCreds.iosAppBuildCredentialsList[0].distributionCertificate.certificateP12 =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    testBuildCreds.iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    const ctx = createCtxMock({
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => testBuildCreds),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(() => testBuildCreds),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetupTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(1);
    // expect distribution certificate to be uploaded on expo servers
    expect(asMock(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect(asMock(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
  });
  it('works in Non Interactive Mode - sets up build credentials with different prior configuration', async () => {
    // create deep clone the quick and dirty way
    const testBuildCreds = JSON.parse(JSON.stringify(testCommonIosAppCredentialsFragment));
    testBuildCreds.iosAppBuildCredentialsList[0].distributionCertificate.certificateP12 =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    testBuildCreds.iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    const ctx = createCtxMock({
      nonInteractive: true,
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => testBuildCreds),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(() => testBuildCreds),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetupTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect no prompts to be called
    expect(asMock(confirmAsync).mock.calls.length).toBe(0);
    // expect build credentials to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(1);
    // expect distribution certificate to be uploaded on expo servers
    expect(asMock(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect(asMock(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
  });
});

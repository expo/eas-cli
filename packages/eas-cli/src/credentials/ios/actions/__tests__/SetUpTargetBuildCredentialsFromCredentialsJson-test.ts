import { IosDistributionType } from '../../../../graphql/generated';
import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
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
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpTargetBuildCredentialsFromCredentialsJson } from '../SetUpTargetBuildCredentialsFromCredentialsJson';

jest.mock('../../../../prompts');
jest.mock('../../../credentialsJson/read');
jest.mock('../../../../graphql/queries/AppQuery');

beforeEach(() => {
  jest.mocked(confirmAsync).mockReset();
  jest.mocked(confirmAsync).mockImplementation(async () => true);
});

describe('SetUpTargetBuildCredentialsFromCredentialsJson', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetUpTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials not to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    // expect distribution certificate not to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(0);
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetUpTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      1
    );
    // expect distribution certificate to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetUpTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      1
    );
    // expect distribution certificate to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupBuildCredentialsFromCredentialsJsonAction =
      new SetUpTargetBuildCredentialsFromCredentialsJson(
        appLookupParams,
        IosDistributionType.AppStore,
        targetCredentials
      );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect no prompts to be called
    expect(jest.mocked(confirmAsync).mock.calls.length).toBe(0);
    // expect build credentials to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      1
    );
    // expect distribution certificate to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
  });
});

import { asMock } from '../../../../__tests__/utils';
import { IosDistributionType } from '../../../../graphql/generated';
import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMockWithoutCredentials,
  testAppleAppIdentifierFragment,
  testDistCert,
  testDistCertFragmentNoDependencies,
  testIosAppCredentialsWithBuildCredentialsQueryResult,
  testProvisioningProfile,
  testProvisioningProfileFragment,
} from '../../../__tests__/fixtures-ios';
import { readIosCredentialsAsync } from '../../../credentialsJson/read';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetupBuildCredentialsFromCredentialsJson } from '../SetupBuildCredentialsFromCredentialsJson';
jest.mock('../../../../prompts');
jest.mock('../../../credentialsJson/read');

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

beforeEach(() => {
  asMock(confirmAsync).mockReset();
  asMock(readIosCredentialsAsync).mockReset();
  (confirmAsync as jest.Mock).mockImplementation(() => true);
  (readIosCredentialsAsync as jest.Mock).mockImplementation(() => ({
    provisioningProfile: testProvisioningProfile.provisioningProfile,
    distributionCertificate: {
      certificateP12: testDistCert.certP12,
      certificatePassword: testDistCert.certPassword,
    },
  }));
});

describe('SetupBuildCredentialsFromCredentialsJson', () => {
  it('sets up build credentials with same prior configuration in Interactive Mode', async () => {
    // configure to be the same creds that are returned by readIosCredentialsAsync in the mock above
    // create deep clone the quick and dirty way
    const testBuildCreds = JSON.parse(
      JSON.stringify(testIosAppCredentialsWithBuildCredentialsQueryResult)
    );
    testBuildCreds.iosAppBuildCredentialsList[0].distributionCertificate.certificateP12 =
      testDistCert.certP12;
    testBuildCreds.iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile =
      testProvisioningProfile.provisioningProfile;
    const ctx = createCtxMock({
      ios: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => testBuildCreds),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(() => testBuildCreds),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsFromCredentialsJsonAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials not to be created or updated on expo servers
    expect((ctx.ios.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(0);
    // expect distribution certificate not to be uploaded on expo servers
    expect((ctx.ios.createDistributionCertificateAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile not to be uploaded on expo servers
    expect((ctx.ios.createProvisioningProfileAsync as any).mock.calls.length).toBe(0);
  });
  it('sets up build credentials with no prior configuration in Interactive Mode', async () => {
    const ctx = createCtxMock({
      ios: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => null),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(
          () => testIosAppCredentialsWithBuildCredentialsQueryResult
        ),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsFromCredentialsJsonAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect((ctx.ios.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(1);
    // expect distribution certificate to be uploaded on expo servers
    expect((ctx.ios.createDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect((ctx.ios.createProvisioningProfileAsync as any).mock.calls.length).toBe(1);
  });
  it('sets up build credentials with different prior configuration in Interactive Mode', async () => {
    // create deep clone the quick and dirty way
    const testBuildCreds = JSON.parse(
      JSON.stringify(testIosAppCredentialsWithBuildCredentialsQueryResult)
    );
    testBuildCreds.iosAppBuildCredentialsList[0].distributionCertificate.certificateP12 =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    testBuildCreds.iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    const ctx = createCtxMock({
      ios: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => testBuildCreds),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(() => testBuildCreds),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsFromCredentialsJsonAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect((ctx.ios.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(1);
    // expect distribution certificate to be uploaded on expo servers
    expect((ctx.ios.createDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect((ctx.ios.createProvisioningProfileAsync as any).mock.calls.length).toBe(1);
  });
  it('works in Non Interactive Mode - sets up build credentials with different prior configuration', async () => {
    // create deep clone the quick and dirty way
    const testBuildCreds = JSON.parse(
      JSON.stringify(testIosAppCredentialsWithBuildCredentialsQueryResult)
    );
    testBuildCreds.iosAppBuildCredentialsList[0].distributionCertificate.certificateP12 =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    testBuildCreds.iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile =
      'something different so SetupBuildCredentialsFromCredentialsJson doesnt think we want to exact the same cert and skip upload to expo servers';
    const ctx = createCtxMock({
      nonInteractive: true,
      ios: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => testBuildCreds),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createDistributionCertificateAsync: jest.fn(() => ({ testDistCertFragmentNoDependencies })),
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfileFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(() => testBuildCreds),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsFromCredentialsJsonAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupBuildCredentialsFromCredentialsJsonAction.runAsync(ctx);

    // expect no prompts to be called
    expect((confirmAsync as any).mock.calls.length).toBe(0);
    // expect build credentials to be created or updated on expo servers
    expect((ctx.ios.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(1);
    // expect distribution certificate to be uploaded on expo servers
    expect((ctx.ios.createDistributionCertificateAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile to be uploaded on expo servers
    expect((ctx.ios.createProvisioningProfileAsync as any).mock.calls.length).toBe(1);
  });
});

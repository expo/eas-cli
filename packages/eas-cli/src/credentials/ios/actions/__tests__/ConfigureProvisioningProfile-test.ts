import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testProvisioningProfileFragment,
  testTarget,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../../errors';
import { AuthenticationMode } from '../../appstore/authenticateTypes';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { ConfigureProvisioningProfile } from '../ConfigureProvisioningProfile';

jest.mock('../../../../ora');
jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe('ConfigureProvisioningProfile', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  const testCases = ['NON_INTERACTIVE', 'INTERACTIVE'];
  test.each(testCases)('configures a Provisioning Profile in %s Mode', async mode => {
    const mockProvisioningProfileFromApple = {
      provisioningProfileId: testProvisioningProfileFragment.developerPortalIdentifier,
      provisioningProfile: testProvisioningProfileFragment.provisioningProfile,
    };
    const ctx = createCtxMock({
      nonInteractive: mode === 'NON_INTERACTIVE',
      appStore: {
        ...getAppstoreMock(),
        defaultAuthenticationMode:
          mode === 'NON_INTERACTIVE' ? AuthenticationMode.API_KEY : AuthenticationMode.USER,
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
        listProvisioningProfilesAsync: jest.fn(() => [mockProvisioningProfileFromApple]),
        useExistingProvisioningProfileAsync: jest.fn(() => mockProvisioningProfileFromApple),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const provProfConfigurator = new ConfigureProvisioningProfile(
      appLookupParams,
      testTarget,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await provProfConfigurator.runAsync(ctx);

    // expect provisioning profile not to be updated on expo servers
    expect(jest.mocked(ctx.ios.updateProvisioningProfileAsync).mock.calls.length).toBe(1);
    // expect provisioning profile not to be updated on apple portal
    expect(jest.mocked(ctx.appStore.useExistingProvisioningProfileAsync).mock.calls.length).toBe(1);
  });
  it('errors with --freeze-credentials flag', async () => {
    const ctx = createCtxMock({
      freezeCredentials: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const provProfConfigurator = new ConfigureProvisioningProfile(
      appLookupParams,
      testTarget,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await expect(provProfConfigurator.runAsync(ctx)).rejects.toThrowError(
      ForbidCredentialModificationError
    );

    // expect provisioning profile not to be updated on expo servers
    expect(jest.mocked(ctx.ios.updateProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be updated on apple portal
    expect(jest.mocked(ctx.appStore.useExistingProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
  it('errors with wrong authentication type in nonInteractive mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const provProfConfigurator = new ConfigureProvisioningProfile(
      appLookupParams,
      testTarget,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await expect(provProfConfigurator.runAsync(ctx)).rejects.toThrowError(
      InsufficientAuthenticationNonInteractiveError
    );

    // expect provisioning profile not to be updated on expo servers
    expect(jest.mocked(ctx.ios.updateProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be updated on apple portal
    expect(jest.mocked(ctx.appStore.useExistingProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
});

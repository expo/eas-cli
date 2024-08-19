import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testTarget,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../../errors';
import { AuthenticationMode } from '../../appstore/authenticateTypes';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateProvisioningProfile } from '../CreateProvisioningProfile';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe('CreateProvisioningProfile', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });

  const testCases = ['NON_INTERACTIVE', 'INTERACTIVE'];
  test.each(testCases)('creates a Provisioning Profile in in %s Mode', async mode => {
    const ctx = createCtxMock({
      nonInteractive: mode === 'NON_INTERACTIVE',
      appStore: {
        ...getAppstoreMock(),
        defaultAuthenticationMode:
          mode === 'NON_INTERACTIVE' ? AuthenticationMode.API_KEY : AuthenticationMode.USER,
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createProvProfAction = new CreateProvisioningProfile(
      appLookupParams,
      testTarget,
      testDistCertFragmentNoDependencies
    );
    await createProvProfAction.runAsync(ctx);

    // expect provisioning profile to be created on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be created on apple portal
    expect(jest.mocked(ctx.appStore.createProvisioningProfileAsync).mock.calls.length).toBe(1);
  });
  it('errors with --freeze-credentials flag', async () => {
    const ctx = createCtxMock({
      freezeCredentials: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createProvProfAction = new CreateProvisioningProfile(
      appLookupParams,
      testTarget,
      testDistCertFragmentNoDependencies
    );
    await expect(createProvProfAction.runAsync(ctx)).rejects.toThrowError(
      ForbidCredentialModificationError
    );

    // expect provisioning profile not to be created on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be created on apple portal
    expect(jest.mocked(ctx.appStore.createProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
  it('errors with wrong authentication type in nonInteractive mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createProvProfAction = new CreateProvisioningProfile(
      appLookupParams,
      testTarget,
      testDistCertFragmentNoDependencies
    );
    await expect(createProvProfAction.runAsync(ctx)).rejects.toThrowError(
      InsufficientAuthenticationNonInteractiveError
    );

    // expect provisioning profile not to be created on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be created on apple portal
    expect(jest.mocked(ctx.appStore.createProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
});

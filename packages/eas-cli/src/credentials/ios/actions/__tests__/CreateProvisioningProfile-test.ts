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
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateProvisioningProfile } from '../CreateProvisioningProfile';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe('CreateProvisioningProfile', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('creates a Provisioning Profile in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
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

  it('creates a Provisioning Profile in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        nonInteractive: true,
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

  it('errors in Non Interactive Mode if not authenticated', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        nonInteractive: true,
        ensureAuthenticatedAsync: async () => {
          throw new MissingCredentialsNonInteractiveError();
        },
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
    await expect(createProvProfAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );

    // expect provisioning profile not to be created on expo servers
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be created on apple portal
    expect(jest.mocked(ctx.appStore.createProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
});

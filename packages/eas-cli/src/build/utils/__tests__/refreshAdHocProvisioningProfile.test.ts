import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import {
  assertExplicitRefreshAdHocProvisioningProfileFlagValid,
  assertRefreshAdHocProvisioningProfileCompatibleWithFreezeCredentials,
  resolveRefreshAdHocProvisioningProfile,
} from '../refreshAdHocProvisioningProfile';

const iosProfileWithRefresh = {
  distribution: 'internal',
  credentialsSource: 'remote',
  refreshAdHocProvisioningProfile: true,
} as BuildProfile<Platform.IOS>;

const iosProfileWithoutRefresh = {
  distribution: 'internal',
  credentialsSource: 'remote',
} as BuildProfile<Platform.IOS>;

const androidProfileWithRefresh = {
  distribution: 'internal',
  credentialsSource: 'remote',
  refreshAdHocProvisioningProfile: true,
} as BuildProfile<Platform.ANDROID>;

describe(resolveRefreshAdHocProvisioningProfile, () => {
  it('enables refresh when eas.json sets refreshAdHocProvisioningProfile and no flag is passed', () => {
    expect(
      resolveRefreshAdHocProvisioningProfile({
        platform: Platform.IOS,
        buildProfile: iosProfileWithRefresh,
      })
    ).toBe(true);
  });

  it('disables refresh when eas.json omits refreshAdHocProvisioningProfile and no flag is passed', () => {
    expect(
      resolveRefreshAdHocProvisioningProfile({
        platform: Platform.IOS,
        buildProfile: iosProfileWithoutRefresh,
      })
    ).toBe(false);
  });

  it('disables refresh when eas.json sets true but explicit --no-refresh-ad-hoc-provisioning-profile is passed', () => {
    expect(
      resolveRefreshAdHocProvisioningProfile({
        platform: Platform.IOS,
        buildProfile: iosProfileWithRefresh,
        refreshAdHocProvisioningProfileFlag: false,
      })
    ).toBe(false);
  });

  it('enables refresh when explicit --refresh-ad-hoc-provisioning-profile is passed', () => {
    expect(
      resolveRefreshAdHocProvisioningProfile({
        platform: Platform.IOS,
        buildProfile: iosProfileWithoutRefresh,
        refreshAdHocProvisioningProfileFlag: true,
      })
    ).toBe(true);
  });

  it('ignores refreshAdHocProvisioningProfile on Android profiles', () => {
    expect(
      resolveRefreshAdHocProvisioningProfile({
        platform: Platform.ANDROID,
        buildProfile: androidProfileWithRefresh,
      })
    ).toBe(false);
  });
});

describe(assertRefreshAdHocProvisioningProfileCompatibleWithFreezeCredentials, () => {
  it('throws when resolved refresh is enabled with freeze-credentials', () => {
    expect(() =>
      assertRefreshAdHocProvisioningProfileCompatibleWithFreezeCredentials(true, true)
    ).toThrow(/Cannot refresh ad-hoc provisioning profile when credentials are frozen/);
  });

  it('does not throw when refresh is disabled with freeze-credentials', () => {
    expect(() =>
      assertRefreshAdHocProvisioningProfileCompatibleWithFreezeCredentials(false, true)
    ).not.toThrow();
  });
});

describe(assertExplicitRefreshAdHocProvisioningProfileFlagValid, () => {
  it('throws when explicit flag is used in interactive mode', () => {
    expect(() =>
      assertExplicitRefreshAdHocProvisioningProfileFlagValid({
        refreshAdHocProvisioningProfileFlag: true,
        nonInteractive: false,
        freezeCredentials: false,
      })
    ).toThrow('--refresh-ad-hoc-provisioning-profile can only be used in non-interactive mode.');
  });

  it('throws when explicit flag is used with freeze-credentials', () => {
    expect(() =>
      assertExplicitRefreshAdHocProvisioningProfileFlagValid({
        refreshAdHocProvisioningProfileFlag: true,
        nonInteractive: true,
        freezeCredentials: true,
      })
    ).toThrow('Cannot use --refresh-ad-hoc-provisioning-profile with --freeze-credentials.');
  });

  it('does not throw when flag is omitted', () => {
    expect(() =>
      assertExplicitRefreshAdHocProvisioningProfileFlagValid({
        nonInteractive: false,
        freezeCredentials: false,
      })
    ).not.toThrow();
  });

  it('does not throw when explicit --no-refresh-ad-hoc-provisioning-profile is passed', () => {
    expect(() =>
      assertExplicitRefreshAdHocProvisioningProfileFlagValid({
        refreshAdHocProvisioningProfileFlag: false,
        nonInteractive: false,
        freezeCredentials: true,
      })
    ).not.toThrow();
  });
});

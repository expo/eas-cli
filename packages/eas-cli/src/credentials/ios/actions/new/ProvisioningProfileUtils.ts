import isEqual from 'lodash/isEqual';

import { AppleDevice, AppleDistributionCertificate } from '../../../../graphql/generated';
import log from '../../../../log';
import { ProvisioningProfileStoreInfo } from '../../appstore/Credentials.types';

export function isDevPortalAdhocProfileValid(
  profileFromDevPortal: ProvisioningProfileStoreInfo | null,
  distCert: AppleDistributionCertificate,
  expectedDevices: AppleDevice[]
): boolean {
  if (!profileFromDevPortal) {
    return false;
  }

  if (profileFromDevPortal.status === 'Invalid' || profileFromDevPortal.certificates.length === 0) {
    log('Provisioning Profile is invalid');
    return false;
  }

  const currentDistCertId = profileFromDevPortal.certificates[0].id;
  if (
    distCert.developerPortalIdentifier &&
    distCert.developerPortalIdentifier !== currentDistCertId
  ) {
    log(
      `Provisioning Profile was generated for Distribution Certificate with ID "${currentDistCertId}", expected ID "${distCert.developerPortalIdentifier}"`
    );
    return false;
  }

  const profileDeviceUdids = (profileFromDevPortal.devices ?? []).map(({ udid }) => udid);
  const expectedDeviceUdids = expectedDevices.map(({ identifier }) => identifier);
  if (!doUDIDsMatch(profileDeviceUdids, expectedDeviceUdids)) {
    log('Provisioning Profile was generated for another set of devices');
    return false;
  }

  return true;
}

export function doUDIDsMatch(udidsA: string[], udidsB: string[]): boolean {
  return isEqual(new Set(udidsA), new Set(udidsB));
}

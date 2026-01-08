import assert from 'assert';
import os from 'os';
import path from 'path';

import { Ios } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { orderBy } from 'lodash';
import { v4 as uuid } from 'uuid';
import { bunyan } from '@expo/logger';

import * as distributionCertificateUtils from './distributionCertificate';
import Keychain from './keychain';
import ProvisioningProfile, {
  DistributionType,
  ProvisioningProfileData,
} from './provisioningProfile';

export interface Credentials {
  applicationTargetProvisioningProfile: ProvisioningProfile;
  keychainPath: string;
  targetProvisioningProfiles: TargetProvisioningProfiles;
  distributionType: DistributionType;
  teamId: string;
}

export type TargetProvisioningProfiles = Record<string, ProvisioningProfileData>;

export default class IosCredentialsManager {
  private keychain?: Keychain;
  private readonly provisioningProfiles: ProvisioningProfile[] = [];
  private cleanedUp = false;

  constructor(private readonly buildCredentials: Ios.BuildCredentials) {}

  public async prepare(logger: bunyan): Promise<Credentials> {
    logger.info('Preparing credentials');

    logger.info('Creating keychain');
    this.keychain = new Keychain();
    await this.keychain.create(logger);

    const targets = Object.keys(this.buildCredentials);
    const targetProvisioningProfiles: TargetProvisioningProfiles = {};
    for (const target of targets) {
      const provisioningProfile = await this.prepareTargetCredentials(
        logger,
        target,
        this.buildCredentials[target]
      );
      this.provisioningProfiles.push(provisioningProfile);
      targetProvisioningProfiles[target] = provisioningProfile.data;
    }

    const applicationTargetProvisioningProfile = this.getApplicationTargetProvisioningProfile();

    // TODO: ensure that all dist types and team ids in the array are the same
    const { distributionType, teamId } = applicationTargetProvisioningProfile.data;

    return {
      applicationTargetProvisioningProfile,
      keychainPath: this.keychain.data.path,
      targetProvisioningProfiles,
      distributionType,
      teamId,
    };
  }

  public async cleanUp(logger: bunyan): Promise<void> {
    if (this.cleanedUp || (!this.keychain && this.provisioningProfiles.length === 0)) {
      return;
    }

    if (this.keychain) {
      await this.keychain.destroy(logger);
    }
    if (this.provisioningProfiles) {
      for (const provisioningProfile of this.provisioningProfiles) {
        await provisioningProfile.destroy(logger);
      }
    }
    this.cleanedUp = true;
  }

  private async prepareTargetCredentials(
    logger: bunyan,
    target: string,
    targetCredentials: Ios.TargetCredentials
  ): Promise<ProvisioningProfile> {
    try {
      assert(this.keychain, 'Keychain should be initialized');

      logger.info(`Preparing credentials for target '${target}'`);
      const distCertPath = path.join(os.tmpdir(), `${uuid()}.p12`);

      logger.info('Getting distribution certificate fingerprint and common name');
      const certificateFingerprint = distributionCertificateUtils.getFingerprint(
        targetCredentials.distributionCertificate
      );
      const certificateCommonName = distributionCertificateUtils.getCommonName(
        targetCredentials.distributionCertificate
      );
      logger.info(
        `Fingerprint = "${certificateFingerprint}", common name = ${certificateCommonName}`
      );

      logger.info(`Writing distribution certificate to ${distCertPath}`);
      await fs.writeFile(
        distCertPath,
        Buffer.from(targetCredentials.distributionCertificate.dataBase64, 'base64')
      );

      logger.info('Importing distribution certificate into the keychain');
      await this.keychain.importCertificate(
        logger,
        distCertPath,
        targetCredentials.distributionCertificate.password
      );

      logger.info('Initializing provisioning profile');
      const provisioningProfile = new ProvisioningProfile(
        Buffer.from(targetCredentials.provisioningProfileBase64, 'base64'),
        this.keychain.data.path,
        target,
        certificateCommonName
      );
      await provisioningProfile.init(logger);

      logger.info('Validating whether distribution certificate has been imported successfully');
      await this.keychain.ensureCertificateImported(
        provisioningProfile.data.teamId,
        certificateFingerprint
      );

      logger.info('Verifying whether the distribution certificate and provisioning profile match');
      provisioningProfile.verifyCertificate(certificateFingerprint);

      return provisioningProfile;
    } catch (err) {
      await this.cleanUp(logger);
      throw err;
    }
  }

  private getApplicationTargetProvisioningProfile(): ProvisioningProfile {
    // sorting works because bundle ids share common prefix
    const sorted = orderBy(this.provisioningProfiles, 'data.bundleIdentifier', 'asc');
    return sorted[0];
  }
}

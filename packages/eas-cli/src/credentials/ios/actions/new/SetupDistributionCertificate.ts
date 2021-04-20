import assert from 'assert';
import sortBy from 'lodash/sortBy';

import {
  AppleDistributionCertificate,
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleDistributionCertificateMutationResult } from '../../api/graphql/mutations/AppleDistributionCertificateMutation';
import { getValidCertSerialNumbers } from '../../appstore/CredentialsUtils';
import { AppleTeamMissingError, MissingCredentialsNonInteractiveError } from '../../errors';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { CreateDistributionCertificate } from './CreateDistributionCertificate';
import { formatDistributionCertificate } from './DistributionCertificateUtils';

export class SetupDistributionCertificate {
  private validDistCerts?: AppleDistributionCertificateFragment[];

  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  public async runAsync(ctx: Context): Promise<AppleDistributionCertificateFragment> {
    const appleTeam = await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app);

    try {
      const currentCertificate = await ctx.newIos.getDistributionCertificateForAppAsync(
        this.app,
        this.distributionType,
        { appleTeam }
      );

      if (ctx.nonInteractive) {
        return await this.runNonInteractiveAsync(ctx, currentCertificate);
      } else {
        return await this.runInteractiveAsync(ctx, currentCertificate);
      }
    } catch (err) {
      if (err instanceof AppleTeamMissingError && ctx.nonInteractive) {
        throw new MissingCredentialsNonInteractiveError();
      }
      throw err;
    }
  }

  private async runNonInteractiveAsync(
    ctx: Context,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    // TODO: implement validation
    Log.addNewLineIfNone();
    Log.warn('Distribution Certificate is not validated for non-interactive builds.');
    if (!currentCertificate) {
      throw new MissingCredentialsNonInteractiveError();
    }
    return currentCertificate;
  }

  private async runInteractiveAsync(
    ctx: Context,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    if (await this.isCurrentCertificateValidAsync(ctx, currentCertificate)) {
      assert(currentCertificate, 'currentCertificate is defined here');
      return currentCertificate;
    }

    const validDistCertsOnFile = await this.getValidDistCertsAsync(ctx);
    return validDistCertsOnFile.length === 0
      ? await this.createNewDistCertAsync(ctx)
      : await this.createOrReuseDistCert(ctx);
  }

  private async isCurrentCertificateValidAsync(
    ctx: Context,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<boolean> {
    if (!currentCertificate) {
      return false;
    }

    const now = new Date();
    if (
      now < new Date(currentCertificate.validityNotBefore) ||
      now > new Date(currentCertificate.validityNotAfter)
    ) {
      return false;
    }

    if (!ctx.appStore.authCtx) {
      Log.warn(
        "Skipping Distribution Certificate validation on Apple Servers because we aren't authenticated."
      );
      return true;
    }

    const validCertSerialNumbers = (await this.getValidDistCertsAsync(ctx)).map(
      i => i.serialNumber
    );
    const isValid = validCertSerialNumbers.includes(currentCertificate.serialNumber);
    if (!isValid) {
      Log.warn('Current distribution certificate is no longer valid in Apple Dev Portal');
    }
    return isValid;
  }

  private async createOrReuseDistCert(ctx: Context): Promise<AppleDistributionCertificateFragment> {
    const validDistCerts = await this.getValidDistCertsAsync(ctx);
    const autoselectedDistCert = validDistCerts[0];

    const useAutoselected = await confirmAsync({
      message: `Reuse this distribution certificate?\n${formatDistributionCertificate(
        autoselectedDistCert
      )}`,
    });

    if (useAutoselected) {
      Log.log(
        `Using distribution certificate with serial number ${autoselectedDistCert.serialNumber}`
      );
      return autoselectedDistCert;
    }

    const { action } = await promptAsync({
      type: 'select',
      name: 'action',
      message: 'Select the iOS distribution certificate to use for code signing:',
      choices: [
        {
          title: '[Choose another existing certificate] (Recommended)',
          value: 'CHOOSE_EXISTING',
        },
        { title: '[Add a new certificate]', value: 'GENERATE' },
      ],
    });

    if (action === 'GENERATE') {
      return await this.createNewDistCertAsync(ctx);
    } else {
      return await this.reuseDistCertAsync(ctx);
    }
  }

  private async createNewDistCertAsync(
    ctx: Context
  ): Promise<AppleDistributionCertificateMutationResult> {
    return new CreateDistributionCertificate(this.app).runAsync(ctx);
  }

  private async reuseDistCertAsync(ctx: Context): Promise<AppleDistributionCertificate> {
    const validDistCerts = await this.getValidDistCertsAsync(ctx);
    const { distCert } = await promptAsync({
      type: 'select',
      name: 'distCert',
      message: 'Select the iOS Distribution Certificate from the list:',
      choices: validDistCerts.map(distCert => ({
        title: formatDistributionCertificate(distCert),
        value: distCert,
      })),
    });
    return distCert;
  }

  private async getValidDistCertsAsync(
    ctx: Context
  ): Promise<AppleDistributionCertificateFragment[]> {
    if (this.validDistCerts) {
      return this.validDistCerts;
    }

    const validDistCertSerialNumbers = getValidCertSerialNumbers(
      await ctx.appStore.listDistributionCertificatesAsync()
    );
    const validDistCertSerialNumberSet = new Set(validDistCertSerialNumbers);

    const distCertsForAccount = await ctx.newIos.getDistributionCertificatesForAccountAsync(
      this.app.account
    );
    const distCertsForAppleTeam = distCertsForAccount.filter(distCert => {
      return (
        !distCert.appleTeam ||
        distCert.appleTeam.appleTeamIdentifier === ctx.appStore.authCtx?.team.id
      );
    });

    const validDistCerts = distCertsForAppleTeam.filter(distCert => {
      return validDistCertSerialNumberSet.has(distCert.serialNumber);
    });
    this.validDistCerts = sortBy(validDistCerts, 'validityNotAfter', 'desc');
    return this.validDistCerts;
  }
}

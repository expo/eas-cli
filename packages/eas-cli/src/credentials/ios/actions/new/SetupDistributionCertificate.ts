import assert from 'assert';
import sortBy from 'lodash/sortBy';

import {
  AppleDistributionCertificate,
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { Action, CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleDistributionCertificateMutationResult } from '../../api/graphql/mutations/AppleDistributionCertificateMutation';
import { getValidCertSerialNumbers } from '../../appstore/CredentialsUtils';
import { AppleTeamMissingError, MissingCredentialsNonInteractiveError } from '../../errors';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { CreateDistributionCertificate } from './CreateDistributionCertificate';
import { formatDistributionCertificate } from './DistributionCertificateUtils';

export class SetupDistributionCertificate implements Action {
  private validDistCerts?: AppleDistributionCertificateFragment[];
  private _distributionCertificate?: AppleDistributionCertificateFragment;

  constructor(private app: AppLookupParams) {}

  public get distributionCertificate(): AppleDistributionCertificateFragment {
    assert(
      this._distributionCertificate,
      'distributionCertificate can be accessed only after calling .runAsync()'
    );
    return this._distributionCertificate;
  }

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const appleTeam = await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app);

    try {
      const currentCertificate = await ctx.newIos.getDistributionCertificateForAppAsync(
        this.app,
        IosDistributionType.AdHoc,
        { appleTeam }
      );

      if (ctx.nonInteractive) {
        await this.runNonInteractiveAsync(ctx, currentCertificate);
      } else {
        await this.runInteractiveAsync(ctx, manager, currentCertificate);
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
  ): Promise<void> {
    // TODO: implement validation
    Log.addNewLineIfNone();
    Log.warn(
      'Distribution Certificate is not validated for non-interactive internal distribution builds.'
    );
    if (!currentCertificate) {
      throw new MissingCredentialsNonInteractiveError();
    }
    this._distributionCertificate = currentCertificate;
  }

  private async runInteractiveAsync(
    ctx: Context,
    manager: CredentialsManager,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<void> {
    if (await this.isCurrentCertificateValidAsync(ctx, currentCertificate)) {
      assert(currentCertificate, 'currentCertificate is defined here');
      this._distributionCertificate = currentCertificate;
      return;
    }

    const validDistCertsOnFile = await this.getValidDistCertsAsync(ctx);
    this._distributionCertificate =
      validDistCertsOnFile.length === 0
        ? await this.createNewDistCertAsync(manager)
        : await this.createOrReuseDistCert(manager, ctx);
  }

  private async isCurrentCertificateValidAsync(
    ctx: Context,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<boolean> {
    if (!currentCertificate) {
      return false;
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

  private async createOrReuseDistCert(
    manager: CredentialsManager,
    ctx: Context
  ): Promise<AppleDistributionCertificateFragment> {
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
      return await this.createNewDistCertAsync(manager);
    } else {
      return await this.reuseDistCertAsync(ctx);
    }
  }

  private async createNewDistCertAsync(
    manager: CredentialsManager
  ): Promise<AppleDistributionCertificateMutationResult> {
    const action = new CreateDistributionCertificate(this.app);
    await manager.runActionAsync(action);
    return action.distributionCertificate;
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

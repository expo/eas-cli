import Log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { AppLookupParams } from '../credentials';
import { validateDistributionCertificateAsync } from '../validators/validateDistributionCertificate';
import { CreateDistributionCertificate } from './CreateDistributionCertificate';
import {
  formatDistributionCertificate,
  getValidDistCertsAsync,
} from './DistributionCertificateUtils';
import {
  UseExistingDistributionCertificate,
  UseSpecificDistributionCertificate,
} from './UseDistributionCertificate';

export class SetupDistributionCertificateForApp implements Action {
  constructor(private app: AppLookupParams) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    if (await this.isCurrentCertificateValidAsync(ctx)) {
      return;
    }

    if (ctx.nonInteractive) {
      throw new Error(
        'Distribution Certificate is not configured correctly. Please run this command again in interactive mode.'
      );
    }

    const existingCertificates = await getValidDistCertsAsync(ctx, this.app.accountName);

    if (existingCertificates.length === 0) {
      await this.createNewCertificateAsync(manager, ctx);
      return;
    }

    // autoselect credentials if we find valid certs
    const autoselectedCertificate = existingCertificates[0];

    const credentials = await ctx.ios.getAllCredentialsAsync(this.app.accountName);
    const usedByApps = credentials.appCredentials.filter(
      cred => cred.distCredentialsId === autoselectedCertificate.id
    );
    const confirm = await confirmAsync({
      message: `${formatDistributionCertificate(
        autoselectedCertificate,
        usedByApps,
        ctx.appStore.authCtx ? 'VALID' : 'UNKNOWN'
      )} \n  Would you like to use this certificate?`,
    });
    if (!confirm) {
      await this.createOrReuseAsync(manager, ctx);
      return;
    }

    Log.log(`Using Distribution Certificate: ${autoselectedCertificate.certId || '-----'}`);
    await manager.runActionAsync(
      new UseSpecificDistributionCertificate(this.app, autoselectedCertificate.id)
    );
  }

  private async isCurrentCertificateValidAsync(ctx: Context): Promise<boolean> {
    const currentCertificate = await ctx.ios.getDistributionCertificateAsync(this.app);
    if (!currentCertificate) {
      return false;
    }
    if (ctx.appStore.authCtx) {
      const isValid = await validateDistributionCertificateAsync(ctx, currentCertificate);
      if (!isValid) {
        Log.warn("Current Distribution Certificate is no longer valid on Apple's server");
      }
      return isValid;
    }
    return true;
  }

  private async createNewCertificateAsync(
    manager: CredentialsManager,
    ctx: Context
  ): Promise<void> {
    const action = new CreateDistributionCertificate(this.app.accountName);
    await manager.runActionAsync(action);
    await manager.runActionAsync(
      new UseSpecificDistributionCertificate(this.app, action.distCredentials.id)
    );
  }

  private async createOrReuseAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const { action } = await promptAsync({
      type: 'select',
      name: 'action',
      message: 'Select an iOS Distribution Certificate to use for code signing:',
      choices: [
        {
          title: '[Choose existing certificate] (Recommended)',
          value: 'CHOOSE_EXISTING',
        },
        { title: '[Add a new certificate]', value: 'GENERATE' },
      ],
    });

    if (action === 'GENERATE') {
      await this.createNewCertificateAsync(manager, ctx);
    } else if (action === 'CHOOSE_EXISTING') {
      await manager.runActionAsync(new UseExistingDistributionCertificate(this.app));
    }
  }
}

import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { tryAuthenticateAppStoreWithEasAscApiKeyAsync } from './AscApiKeyUtils';
import { CreateDistributionCertificate } from './CreateDistributionCertificate';
import { formatDistributionCertificate } from './DistributionCertificateUtils';
import {
  AppleDistributionCertificate,
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import sortBy from '../../../utils/expodash/sortBy';
import { CredentialsContext } from '../../context';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
  MissingCredentialsNonInteractiveError,
} from '../../errors';
import { AppleDistributionCertificateMutationResult } from '../api/graphql/mutations/AppleDistributionCertificateMutation';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { getValidCertSerialNumbers } from '../appstore/CredentialsUtils';
import { AppleTeamType } from '../appstore/authenticateTypes';
import { AppleTeamMissingError } from '../errors';

export class SetUpDistributionCertificate {
  private validDistCerts?: AppleDistributionCertificateFragment[];

  constructor(
    private readonly app: AppLookupParams,
    private readonly distributionType: IosDistributionType
  ) {}

  public async runAsync(ctx: CredentialsContext): Promise<AppleDistributionCertificateFragment> {
    const appleTeam = await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app);

    try {
      const currentCertificate = await ctx.ios.getDistributionCertificateForAppAsync(
        ctx.graphqlClient,
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
    ctx: CredentialsContext,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    if (!ctx.refreshDistributionCertificate) {
      Log.addNewLineIfNone();
      Log.warn(
        'Using the existing distribution certificate without validating it against Apple servers. Use --refresh-distribution-certificate to validate and refresh if needed.'
      );
      if (!currentCertificate) {
        throw new MissingCredentialsNonInteractiveError();
      }
      return currentCertificate;
    }

    if (!currentCertificate) {
      throw new MissingCredentialsNonInteractiveError();
    }

    await tryAuthenticateAppStoreWithEasAscApiKeyAsync(
      ctx,
      this.app,
      AppleTeamType.COMPANY_OR_ORGANIZATION
    );

    if (
      currentCertificate &&
      (await this.isCurrentCertificateValidAsync(ctx, currentCertificate))
    ) {
      Log.log('Using existing valid distribution certificate.');
      return currentCertificate;
    }

    if (ctx.freezeCredentials) {
      throw new ForbidCredentialModificationError(
        'Distribution certificate is not configured correctly. Remove the --freeze-credentials flag to configure it.'
      );
    }

    if (!ctx.appStore.authCtx) {
      throw new InsufficientAuthenticationNonInteractiveError(
        'Authentication with an ASC API key is required to validate and refresh a distribution certificate in non-interactive mode. Provide one via:\n' +
          '  - Environment variables: EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID\n' +
          '  - EAS credentials service: configure an App Store Connect API Key for submissions on this app'
      );
    }

    const validDistCerts = await this.getValidDistCertsAsync(ctx);
    if (validDistCerts.length > 0) {
      const cert = validDistCerts[0];
      Log.log(`Reusing distribution certificate with serial number ${cert.serialNumber}`);
      return cert;
    }
    Log.warn('Current distribution certificate is invalid. Creating a new one...');
    return await this.createNewDistCertAsync(ctx);
  }

  private async runInteractiveAsync(
    ctx: CredentialsContext,
    currentCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    if (
      currentCertificate &&
      (await this.isCurrentCertificateValidAsync(ctx, currentCertificate))
    ) {
      return currentCertificate;
    }

    const validDistCertsOnFile = await this.getValidDistCertsAsync(ctx);
    return validDistCertsOnFile.length === 0
      ? await this.createNewDistCertAsync(ctx)
      : await this.createOrReuseDistCertAsync(ctx);
  }

  private async isCurrentCertificateValidAsync(
    ctx: CredentialsContext,
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

  private async createOrReuseDistCertAsync(
    ctx: CredentialsContext
  ): Promise<AppleDistributionCertificateFragment> {
    const validDistCerts = await this.getValidDistCertsAsync(ctx);
    const autoselectedDistCert = validDistCerts[0];

    const useAutoselected =
      ctx.autoAcceptCredentialReuse ||
      (await confirmAsync({
        message: `Reuse this distribution certificate?\n${formatDistributionCertificate(
          autoselectedDistCert
        )}`,
      }));

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
    ctx: CredentialsContext
  ): Promise<AppleDistributionCertificateMutationResult> {
    return await new CreateDistributionCertificate(this.app.account).runAsync(ctx);
  }

  async reuseDistCertAsync(ctx: CredentialsContext): Promise<AppleDistributionCertificate> {
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
    ctx: CredentialsContext
  ): Promise<AppleDistributionCertificateFragment[]> {
    if (this.validDistCerts) {
      return this.validDistCerts;
    }

    const validDistCertSerialNumbers = getValidCertSerialNumbers(
      await ctx.appStore.listDistributionCertificatesAsync()
    );
    const validDistCertSerialNumberSet = new Set(validDistCertSerialNumbers);

    const distCertsForAccount = await ctx.ios.getDistributionCertificatesForAccountAsync(
      ctx.graphqlClient,
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

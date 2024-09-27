import { getAllBuildCredentialsAsync } from './BuildCredentialsUtils';
import { SetUpAdhocProvisioningProfile } from './SetUpAdhocProvisioningProfile';
import { SetUpProvisioningProfile } from './SetUpProvisioningProfile';
import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { Target } from '../types';

/**
 * It's used when setting up credentials for internal distribution but `enterpriseProvisioning` is not set.
 *
 * TLDR: If the user authenticates with an account with Apple Developer Enterprise Program membership we ask them
 * to choose if they want to set up an adhoc or universal distribution provisioning profile. Otherwise, always
 * set up an adhoc provisioning profile.
 */

interface Options {
  app: AppLookupParams;
  target: Target;
}

export class SetUpInternalProvisioningProfile {
  constructor(private readonly options: Options) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
    const buildCredentials = await getAllBuildCredentialsAsync(ctx, this.options.app);

    const adhocBuildCredentialsExist =
      buildCredentials.filter(
        ({ iosDistributionType }) => iosDistributionType === IosDistributionType.AdHoc
      ).length > 0;
    const enterpriseBuildCredentialsExist =
      buildCredentials.filter(
        ({ iosDistributionType }) => iosDistributionType === IosDistributionType.Enterprise
      ).length > 0;

    if (!ctx.nonInteractive) {
      if (ctx.appStore.authCtx) {
        if (ctx.appStore.authCtx.team.inHouse) {
          return await this.askForDistributionTypeAndSetupAsync(
            ctx,
            'Which credentials would you like to set up?'
          );
        } else {
          return await this.setupAdhocProvisioningProfileAsync(ctx);
        }
      } else {
        if (adhocBuildCredentialsExist && enterpriseBuildCredentialsExist) {
          Log.log('You have set up both adhoc and universal distribution credentials.');
          return await this.askForDistributionTypeAndSetupAsync(
            ctx,
            'Which credentials would you like to use?'
          );
        } else if (adhocBuildCredentialsExist) {
          return await this.setupAdhocProvisioningProfileAsync(ctx);
        } else if (enterpriseBuildCredentialsExist) {
          return await this.setupUniversalProvisioningProfileAsync(ctx);
        } else {
          Log.addNewLineIfNone();
          Log.log(
            'You need to log in to your Apple Developer account to generate credentials for internal distribution builds, or provide credentials via credentials.json'
          );
          Log.log(learnMore('https://docs.expo.dev/app-signing/local-credentials/'));
          const { team } = await ctx.appStore.ensureAuthenticatedAsync();
          if (team.inHouse) {
            return await this.askForDistributionTypeAndSetupAsync(
              ctx,
              'Which credentials would you like to set up?'
            );
          } else {
            return await this.setupAdhocProvisioningProfileAsync(ctx);
          }
        }
      }
    } else {
      if (adhocBuildCredentialsExist && enterpriseBuildCredentialsExist) {
        throw new Error(
          `You're in non-interactive mode. You have set up both adhoc and universal distribution credentials. Set the 'enterpriseProvisioning' property (to 'adhoc' or 'universal') in eas.json to choose the credentials to use.`
        );
      } else if (adhocBuildCredentialsExist) {
        return await this.setupAdhocProvisioningProfileAsync(ctx);
      } else if (enterpriseBuildCredentialsExist) {
        return await this.setupUniversalProvisioningProfileAsync(ctx);
      } else {
        throw new Error(
          `You're in non-interactive mode. EAS CLI couldn't find any credentials suitable for internal distribution. Run this command again in interactive mode.`
        );
      }
    }
  }

  private async setupAdhocProvisioningProfileAsync(
    ctx: CredentialsContext
  ): Promise<IosAppBuildCredentialsFragment> {
    const { app, target } = this.options;
    return await new SetUpAdhocProvisioningProfile({ app, target }).runAsync(ctx);
  }

  private async setupUniversalProvisioningProfileAsync(
    ctx: CredentialsContext
  ): Promise<IosAppBuildCredentialsFragment> {
    return await new SetUpProvisioningProfile(
      this.options.app,
      this.options.target,
      IosDistributionType.Enterprise
    ).runAsync(ctx);
  }

  private async askForDistributionTypeAndSetupAsync(
    ctx: CredentialsContext,
    message: string
  ): Promise<IosAppBuildCredentialsFragment> {
    const { distributionType } = await promptAsync({
      type: 'select',
      name: 'distributionType',
      message,
      choices: [
        { title: 'Universal Distribution', value: IosDistributionType.Enterprise },
        { title: 'Adhoc Distribution', value: IosDistributionType.AdHoc },
      ],
    });
    if (distributionType === IosDistributionType.Enterprise) {
      return await this.setupUniversalProvisioningProfileAsync(ctx);
    } else {
      return await this.setupAdhocProvisioningProfileAsync(ctx);
    }
  }
}

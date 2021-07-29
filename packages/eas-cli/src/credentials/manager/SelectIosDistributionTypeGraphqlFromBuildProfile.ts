import { IosBuildProfile } from '@expo/eas-json';

import { IosDistributionType as IosDistributionTypeGraphql } from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { Context } from '../context';

export class SelectIosDistributionTypeGraphqlFromBuildProfile {
  constructor(private buildProfile: IosBuildProfile) {}

  async runAsync(ctx: Context): Promise<IosDistributionTypeGraphql> {
    const { distribution, simulator } = this.buildProfile;
    if (simulator) {
      throw new Error('A simulator distribution does not require credentials to be configured.');
    } else if (distribution === 'store') {
      return IosDistributionTypeGraphql.AppStore;
    } else {
      return this.resolveInternalDistributionAsync(ctx);
    }
  }

  async resolveInternalDistributionAsync(ctx: Context): Promise<IosDistributionTypeGraphql> {
    // check if the type is specified in eas config
    const maybeEnterpriseProvisioning = this.buildProfile.enterpriseProvisioning;
    if (maybeEnterpriseProvisioning) {
      switch (maybeEnterpriseProvisioning) {
        case 'universal':
          return IosDistributionTypeGraphql.Enterprise;
        case 'adhoc':
          return IosDistributionTypeGraphql.AdHoc;
        default:
          throw new Error(
            `Unsupported Enterprise Provisioning type: ${maybeEnterpriseProvisioning}`
          );
      }
    }

    // only enterprise accounts support enterprise distributions
    const isDefinitelyNotAnEnterpriseAccount = ctx.appStore.authCtx?.team.inHouse === false;
    if (isDefinitelyNotAnEnterpriseAccount) {
      return IosDistributionTypeGraphql.AdHoc;
    }

    if (ctx.nonInteractive) {
      throw new Error(
        'Unable to determine type of internal distribution. Please run this command in interactive mode.'
      );
    }

    // ask the user as a last resort
    const { iosDistributionTypeGraphql } = await promptAsync({
      type: 'select',
      name: 'iosDistributionTypeGraphql',
      message: 'Which type of internal distribution would you like to configure?',
      choices: [
        {
          value: IosDistributionTypeGraphql.AdHoc,
          title: 'Adhoc: distribution to a small number of test users',
        },
        {
          value: IosDistributionTypeGraphql.Enterprise,
          title:
            'Enterprise: distribution to members of your company. Restricted to Apple Enterprise Accounts.',
        },
      ],
    });
    return iosDistributionTypeGraphql;
  }
}

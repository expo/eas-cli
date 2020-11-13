import wordwrap from 'wordwrap';

import { authenticateAsync } from '../../credentials/ios/appstore/authenticate';
import log from '../../log';
import { runFastlaneAsync, travelingFastlane } from '../utils/fastlane';

/////////////////////////////////////////////////////////

interface ProduceOptions {
  appleId?: string;
  appName?: string;
  bundleIdentifier?: string;
  appleTeamId?: string;
  itcTeamId?: string;
  language?: string;
  companyName?: string;
}

interface ProduceCredentials {
  appleId?: string;
  appleIdPassword?: string;
  appleTeamId?: string;
  itcTeamId?: string;
  companyName?: string;
}

export async function runProduceAsync(
  options: ProduceOptions
): Promise<{
  appleId: string;
  appAppleId: string;
}> {
  const { bundleIdentifier, appName, language, companyName } = options;

  const { appleId, appleIdPassword, team } = await authenticateAsync({
    appleId: options.appleId,
    teamId: options.appleTeamId,
  });

  const appleCreds: ProduceCredentials = {
    appleId,
    appleIdPassword,
    appleTeamId: team.id,
    companyName,
  };
  const itcTeamId = options.itcTeamId ?? (await resolveItcTeamId(appleCreds));
  const updatedAppleCreds = {
    ...appleCreds,
    itcTeamId,
  };

  log('Ensuring the app exists on App Store Connect, this may take a while...');
  try {
    const { appleId: appAppleId } = await runFastlaneAsync(
      travelingFastlane.appProduce,
      [bundleIdentifier, appName, appleId, language],
      updatedAppleCreds,
      true
    );

    return { appleId, appAppleId };
  } catch (err) {
    const wrap = wordwrap(process.stdout.columns || 80);
    if (err.message.match(/You must provide a company name to use on the App Store/)) {
      log.error(
        wrap(
          'You haven\'t uploaded any app to App Store yet. Please provide your company name with --company-name "COMPANY NAME"'
        )
      );

      //TODO: Old travelingFastlane throws these errors. New fastlane should just skip in cases below
    } else if (err.message.match(/The Bundle ID you entered has already been used./)) {
      log.warn(
        wrap(
          'The Bundle ID you entered has already been used. If you already have app on App Store Connect, ' +
            'please skip this step and provide App Apple ID directly'
        )
      );
    } else if (err.message.match(/The app name you entered is already being used./)) {
      log.error('The app name you entered is already being used.');
    }
    throw err;
  }
}

async function resolveItcTeamId(appleCreds: ProduceCredentials): Promise<string> {
  log('Resolving the ITC team ID...');
  const { itc_team_id: itcTeamId } = await runFastlaneAsync(
    travelingFastlane.resolveItcTeamId,
    [],
    appleCreds
  );
  log(`ITC team ID is ${itcTeamId}`);

  return itcTeamId;
}

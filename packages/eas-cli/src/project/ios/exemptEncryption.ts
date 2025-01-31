import { ExpoConfig, getProjectConfigDescription, modifyConfigAsync } from '@expo/config';
import chalk from 'chalk';

import Log, { learnMore } from '../../log';
import { confirmAsync } from '../../prompts';

/** Non-exempt encryption must be set on every build in App Store Connect, we move it to before the build process to attempt only setting it once for the entire life-cycle of the project. */
export async function ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
  projectDir,
  exp,
  nonInteractive,
}: {
  projectDir: string;
  exp: ExpoConfig;
  nonInteractive: boolean;
}): Promise<void> {
  // TODO: We could add bare workflow support in the future.
  // TODO: We could add wizard support for non-exempt encryption in the future.

  const ITSAppUsesNonExemptEncryption =
    exp.ios?.infoPlist?.ITSAppUsesNonExemptEncryption ?? exp.ios?.config?.usesNonExemptEncryption;

  if (ITSAppUsesNonExemptEncryption == null) {
    await configureNonExemptEncryptionAsync({
      projectDir,
      exp,
      nonInteractive,
    });
  } else {
    Log.debug(`ITSAppUsesNonExemptEncryption is defined in the app config.`);
  }
}

async function configureNonExemptEncryptionAsync({
  projectDir,
  exp,
  nonInteractive,
}: {
  projectDir: string;
  exp: ExpoConfig;
  nonInteractive: boolean;
}): Promise<void> {
  const description = getProjectConfigDescription(projectDir);
  if (nonInteractive) {
    Log.warn(
      chalk`${description} is missing {bold ios.infoPlist.ITSAppUsesNonExemptEncryption} boolean. Manual configuration is required in App Store Connect before the app can be tested.`
    );
    return;
  }

  let onlyExemptEncryption = await confirmAsync({
    message: `iOS app only uses standard/exempt encryption? ${chalk.dim(
      learnMore(
        'https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations'
      )
    )}`,
    initial: true,
  });

  if (!onlyExemptEncryption) {
    const confirm = await confirmAsync({
      message: `Are you sure your app uses non-exempt encryption? Selecting 'Yes' will require annual self-classification reports for the US government.`,
      initial: true,
    });

    if (!confirm) {
      Log.warn(
        chalk`Set {bold ios.infoPlist.ITSAppUsesNonExemptEncryption} in ${description} to release Apple builds faster.`
      );
      onlyExemptEncryption = true;
    }
  }

  const ITSAppUsesNonExemptEncryption = !onlyExemptEncryption;

  // Only set this value if the answer is no, this enables developers to see the more in-depth prompt in App Store Connect. They can set the value manually in the app.json to avoid the EAS prompt in subsequent builds.
  if (ITSAppUsesNonExemptEncryption) {
    Log.warn(
      `You'll need to manually configure the encryption status in App Store Connect before your build can be tested.`
    );
    return;
  }
  // NOTE: Is is it possible to assert that the config needs to be modifiable before building the app?
  const modification = await modifyConfigAsync(
    projectDir,
    {
      ios: {
        ...(exp.ios ?? {}),
        infoPlist: {
          ...(exp.ios?.infoPlist ?? {}),
          ITSAppUsesNonExemptEncryption,
        },
      },
    },
    {
      skipSDKVersionRequirement: true,
    }
  );

  if (modification.type !== 'success') {
    Log.log();
    if (modification.type === 'warn') {
      // The project is using a dynamic config, give the user a helpful log and bail out.
      Log.log(chalk.yellow(modification.message));
    }

    const edits = {
      ios: {
        infoPlist: {
          ITSAppUsesNonExemptEncryption,
        },
      },
    };

    Log.log(chalk.cyan(`Add the following to ${description}:`));
    Log.log();
    Log.log(JSON.stringify(edits, null, 2));
    Log.log();
  }
}

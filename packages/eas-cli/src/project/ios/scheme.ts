import { IOSConfig } from '@expo/config-plugins';
import chalk from 'chalk';
import sortBy from 'lodash/sortBy';

import Log from '../../log';
import { promptAsync } from '../../prompts';

export async function selectSchemeAsync({
  projectDir,
  nonInteractive = false,
}: {
  projectDir: string;
  nonInteractive?: boolean;
}): Promise<string> {
  const schemes = IOSConfig.BuildScheme.getSchemesFromXcodeproj(projectDir);
  if (schemes.length === 1) {
    return schemes[0];
  }

  const sortedSchemes = sortBy(schemes);
  Log.newLine();
  Log.log(
    `We've found multiple schemes in your Xcode project: ${chalk.bold(sortedSchemes.join(', '))}`
  );
  if (nonInteractive) {
    const withoutTvOS = sortedSchemes.filter(i => !i.includes('tvOS'));
    const scheme = withoutTvOS.length > 0 ? withoutTvOS[0] : sortedSchemes[0];
    Log.log(
      `You've run Expo CLI in non-interactive mode, choosing the ${chalk.bold(scheme)} scheme.`
    );
    Log.newLine();
    return scheme;
  } else {
    const { selectedScheme } = await promptAsync({
      type: 'select',
      name: 'selectedScheme',
      message: 'Which scheme would you like to use?',
      choices: sortedSchemes.map(scheme => ({ title: scheme, value: scheme })),
    });
    Log.newLine();
    return selectedScheme as string;
  }
}

import { promptAsync } from '../../prompts';

export enum AndroidPackageSourceType {
  userDefined,
  prompt,
}

interface AndroidPackageSourceBase {
  sourceType: AndroidPackageSourceType;
}

interface AndroidPackageUserDefinedSource extends AndroidPackageSourceBase {
  sourceType: AndroidPackageSourceType.userDefined;
  androidPackage: string;
}

interface AndroidPackagePromptSource extends AndroidPackageSourceBase {
  sourceType: AndroidPackageSourceType.prompt;
}

export type AndroidPackageSource = AndroidPackageUserDefinedSource | AndroidPackagePromptSource;

export async function getAndroidPackageAsync(source: AndroidPackageSource): Promise<string> {
  if (source.sourceType === AndroidPackageSourceType.userDefined) {
    return source.androidPackage;
  } else if (source.sourceType === AndroidPackageSourceType.prompt) {
    const { androidPackage } = await promptAsync({
      name: 'androidPackage',
      message: 'Android package name:',
      type: 'text',
      validate: (val: string) => val !== '' || 'Package name cannot be empty!',
    });
    return androidPackage;
  } else {
    throw new Error('This should never happen');
  }
}

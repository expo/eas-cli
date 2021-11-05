export enum AppSpecificPasswordSourceType {
  userDefined,
}

interface AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType;
}

interface AppSpecificPasswordUserDefinedSource extends AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType.userDefined;
  appSpecificPassword: string;
}

export type AppSpecificPasswordSource = AppSpecificPasswordUserDefinedSource;

export async function getAppSpecificPasswordAsync(
  source: AppSpecificPasswordSource
): Promise<string> {
  if (source.sourceType === AppSpecificPasswordSourceType.userDefined) {
    return source.appSpecificPassword;
  } else {
    // exhaustive -- should never happen
    throw new Error(`Unknown app specific password source type "${(source as any)?.sourceType}"`);
  }
}

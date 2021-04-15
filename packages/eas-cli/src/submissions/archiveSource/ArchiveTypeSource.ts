import { AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { AndroidArchiveType, ArchiveType, IosArchiveType } from '../types';

export enum ArchiveTypeSourceType {
  infer,
  parameter,
  prompt,
}

interface ArchiveTypeSourceBase {
  sourceType: ArchiveTypeSourceType;
}

interface ArchiveTypeInferSource extends ArchiveTypeSourceBase {
  sourceType: ArchiveTypeSourceType.infer;
}

interface ArchiveTypeParameterSource extends ArchiveTypeSourceBase {
  sourceType: ArchiveTypeSourceType.parameter;
  archiveType: ArchiveType;
}

interface ArchiveTypePromptSource extends ArchiveTypeSourceBase {
  sourceType: ArchiveTypeSourceType.prompt;
}

export type ArchiveTypeSource =
  | ArchiveTypeInferSource
  | ArchiveTypeParameterSource
  | ArchiveTypePromptSource;

export async function getArchiveTypeAsync(
  platform: AppPlatform,
  source: ArchiveTypeSource,
  location: string
): Promise<ArchiveType> {
  // for iOS we have only one archive type
  if (platform === AppPlatform.Ios) {
    return IosArchiveType.ipa;
  }

  switch (source.sourceType) {
    case ArchiveTypeSourceType.infer:
      return handleInferSourceAsync(platform, source, location);
    case ArchiveTypeSourceType.parameter:
      return handleParameterSourceAsync(platform, source, location);
    case ArchiveTypeSourceType.prompt:
      return handlePromptSourceAsync(platform, source, location);
  }
}

async function handleInferSourceAsync(
  platform: AppPlatform,
  _source: ArchiveTypeInferSource,
  location: string
): Promise<ArchiveType> {
  const inferredArchiveType = inferArchiveTypeFromLocation(platform, location);
  if (inferredArchiveType) {
    return inferredArchiveType;
  } else {
    Log.warn("We couldn't auto detect the archive type");
    return getArchiveTypeAsync(platform, { sourceType: ArchiveTypeSourceType.prompt }, location);
  }
}

async function handleParameterSourceAsync(
  platform: AppPlatform,
  source: ArchiveTypeParameterSource,
  location: string
): Promise<ArchiveType> {
  const inferredArchiveType = inferArchiveTypeFromLocation(platform, location);
  if (inferredArchiveType) {
    if (source.archiveType === inferredArchiveType) {
      return source.archiveType;
    } else {
      Log.warn(
        `The archive seems to be .${inferredArchiveType} and you passed: --type ${source.archiveType}`
      );
      return getArchiveTypeAsync(platform, { sourceType: ArchiveTypeSourceType.prompt }, location);
    }
  } else {
    return source.archiveType;
  }
}

async function handlePromptSourceAsync(
  platform: AppPlatform,
  _source: ArchiveTypePromptSource,
  location: string
): Promise<ArchiveType> {
  const inferredArchiveType = inferArchiveTypeFromLocation(platform, location);
  const { archiveType: archiveTypeRaw } = await promptAsync({
    name: 'archiveType',
    type: 'select',
    message: "What's the archive type?",
    choices: [
      { title: 'APK', value: AndroidArchiveType.apk },
      { title: 'AAB', value: AndroidArchiveType.aab },
    ],
    ...(inferredArchiveType && { default: inferredArchiveType }),
  });
  return archiveTypeRaw as ArchiveType;
}

type ArchiveInferredType = ArchiveType | null;

function inferArchiveTypeFromLocation(
  platform: AppPlatform,
  location: string
): ArchiveInferredType {
  if (platform === AppPlatform.Ios) {
    return IosArchiveType.ipa;
  } else {
    if (location.endsWith('.apk')) {
      return AndroidArchiveType.apk;
    } else if (location.endsWith('.aab')) {
      return AndroidArchiveType.aab;
    } else {
      return null;
    }
  }
}

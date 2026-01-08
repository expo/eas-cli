import assert from 'assert';

import { GenericArtifactType, Job, ManagedArtifactType } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import { FindArtifactsError, findArtifacts } from '../../utils/artifacts';

const artifactTypeInputToManagedArtifactType: Record<string, ManagedArtifactType | undefined> = {
  'application-archive': ManagedArtifactType.APPLICATION_ARCHIVE,
  'build-artifact': ManagedArtifactType.BUILD_ARTIFACTS,
};

export function createUploadArtifactBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'upload_artifact',
    name: 'Upload artifact',
    __metricsId: 'eas/upload_artifact',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'type',
        allowedValues: [
          ManagedArtifactType.APPLICATION_ARCHIVE,
          ManagedArtifactType.BUILD_ARTIFACTS,
          ...Object.keys(artifactTypeInputToManagedArtifactType),
          ...Object.values(GenericArtifactType),
        ],
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'key',
        defaultValue: '',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'name',
        defaultValue: '',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      /**
       * path inputs expects a list of newline-delimited search paths.
       * Valid examples include:
       * - path: app/artifact.app
       * - path: app/*.app
       * - path: |
       *     assets/*.png
       *     assets/*.jpg
       *     public/another-photo.jpg
       */
      BuildStepInput.createProvider({
        id: 'path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'ignore_error',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'artifact_id',
        required: false,
      }),
    ],
    fn: async ({ logger, global }, { inputs, outputs }) => {
      assert(inputs.path.value, 'Path input cannot be empty.');

      const artifactSearchPaths = inputs.path.value
        .toString()
        .split('\n')
        // It's easy to get an empty line with YAML
        .filter((entry) => entry);

      const artifactsSearchResults = await Promise.allSettled(
        artifactSearchPaths.map((patternOrPath) =>
          findArtifacts({
            rootDir: global.projectTargetDirectory,
            patternOrPath,
            // We're logging the error ourselves.
            logger: null,
          })
        )
      );

      const artifactPaths = artifactsSearchResults.flatMap((result, index) => {
        if (result.status === 'fulfilled') {
          logger.info(
            `Found ${result.value.length} paths matching "${artifactSearchPaths[index]}".`
          );
          return result.value;
        }

        if (result.status === 'rejected' && result.reason instanceof FindArtifactsError) {
          logger.warn(`Did not find any paths matching "${artifactSearchPaths[index]}. Ignoring.`);
          return [];
        }

        throw result.reason;
      });

      const artifact = {
        type: parseArtifactTypeInput({
          platform: ctx.job.platform,
          inputValue: `${inputs.type.value ?? ''}`,
        }),
        paths: artifactPaths,
        name: (inputs.name.value || inputs.key.value) as string,
      };

      try {
        const { artifactId } = await ctx.runtimeApi.uploadArtifact({
          artifact,
          logger,
        });

        if (artifactId) {
          outputs.artifact_id.set(artifactId);
        }
      } catch (error) {
        if (inputs.ignore_error.value) {
          logger.error(`Failed to upload ${artifact.type}. Ignoring error.`, error);
          // Ignoring error.
          return;
        }

        throw error;
      }
    },
  });
}

/**
 * Initially, upload_artifact supported application-archive and build-artifact.
 * Then, mistakenly, support for it was removed in favor of supporting ManagedArtifactType
 * values. This makes sure we support all:
 * - kebab-case managed artifact types (the original)
 * - snake-caps-case managed artifact types (the mistake)
 * - generic artifact types.
 */
function parseArtifactTypeInput({
  inputValue,
  platform,
}: {
  inputValue: string;
  platform: Job['platform'];
}): GenericArtifactType | ManagedArtifactType {
  if (!inputValue) {
    // In build jobs the default artifact type is application-archive.
    return platform ? ManagedArtifactType.APPLICATION_ARCHIVE : GenericArtifactType.OTHER;
  }

  // Step's allowedValues ensures input is either
  // a key of artifactTypeInputToManagedArtifactType
  // or a value of an artifact type.
  const translatedManagedArtifactType = artifactTypeInputToManagedArtifactType[inputValue];
  if (translatedManagedArtifactType) {
    return translatedManagedArtifactType;
  }

  return inputValue as GenericArtifactType | ManagedArtifactType;
}

import { BuildJob, SystemError, sanitizeMetadata } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { describeError } from '../../../utils/networkErrors';
import { requestGraphqlDataWithRetriesAsync } from '../../../utils/retryOnNetworkFailure';

const UPDATE_BUILD_METADATA_MUTATION = graphql(`
  mutation NativeBuildUpdateBuildMetadataMutation($buildId: ID!, $metadata: BuildMetadataInput!) {
    build {
      updateBuildMetadata(buildId: $buildId, metadata: $metadata) {
        id
      }
    }
  }
`);

const GIT_COMMIT_MESSAGE_MAX_LENGTH = 4096;

export function createUpdateRemoteBuildMetadataBuildFunction(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'update_remote_build_metadata',
    name: 'Update the build metadata',
    __metricsId: 'eas/update_remote_build_metadata',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'app_name',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'application_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'app_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_number',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ logger, global }, { inputs }) => {
      const buildId = ctx.env.EAS_BUILD_ID;
      if (!buildId) {
        logger.info('EAS_BUILD_ID not set, skipping.');
        return;
      }
      const nonEmptyValueOf = (inputId: string): string | undefined =>
        (inputs[inputId].value as string | undefined) || undefined;
      const metadata = {
        appName: nonEmptyValueOf('app_name'),
        appIdentifier: nonEmptyValueOf('application_identifier'),
        appVersion: nonEmptyValueOf('app_version'),
        appBuildVersion: nonEmptyValueOf('build_number'),
        ...(await readCheckedOutCommitAsync(global.projectTargetDirectory)),
      };

      try {
        await requestGraphqlDataWithRetriesAsync(
          () =>
            ctx.graphqlClient
              .mutation(UPDATE_BUILD_METADATA_MUTATION, { buildId, metadata })
              .toPromise(),
          { operation: 'native_build.update_build_metadata' }
        );
      } catch (error) {
        throw new SystemError(
          `EAS could not save the name, identifier and version of the built app to this build: ${describeError(error)}\nThe build fails because these values cannot be added after it finishes, and the install link of the build needs them. Run the build again, and contact Expo support if it keeps failing.`,
          { cause: error }
        );
      }

      logger.info(`Saved to the build: ${JSON.stringify(metadata)}`);
    },
  });
}

async function readCheckedOutCommitAsync(
  repositoryDirectory: string
): Promise<{ gitCommitHash?: string; gitCommitMessage?: string }> {
  try {
    const { stdout } = await spawn('git', ['--no-pager', 'log', '-1', '--pretty=%H%n%B'], {
      cwd: repositoryDirectory,
      stdio: 'pipe',
    });
    const [hash, ...messageLines] = stdout.split('\n');
    const { gitCommitHash, gitCommitMessage } = sanitizeMetadata({
      gitCommitHash: hash,
      gitCommitMessage: truncateGitCommitMessage(messageLines.join('\n').trim()) || undefined,
    });
    return { gitCommitHash, gitCommitMessage };
  } catch (error) {
    Sentry.capture('Failed to read the commit of the checkout', error as Error);
    return {};
  }
}

function truncateGitCommitMessage(message: string): string {
  if (message.length <= GIT_COMMIT_MESSAGE_MAX_LENGTH) {
    return message;
  }
  const truncated = message
    .substring(0, GIT_COMMIT_MESSAGE_MAX_LENGTH - 3)
    .replace(/[\uD800-\uDBFF]$/, '');
  return `${truncated}...`;
}

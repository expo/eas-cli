import { BuildJob, SystemError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepGlobalContext, BuildStepOutput } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { Client, CombinedError } from '@urql/core';

import { createGlobalContextMock } from '../../../../__tests__/utils/context';
import { CustomBuildContext } from '../../../../customBuildContext';
import { Sentry } from '../../../../sentry';
import { createUpdateRemoteBuildMetadataBuildFunction } from '../updateRemoteBuildMetadata';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../../sentry');

const BUILD_ID = 'build-id';
const APP_METADATA_INPUTS = {
  app_name: 'Native App',
  application_identifier: 'dev.expo.nativeapp',
  app_version: '1.2.0',
  build_number: '43',
};

function createGraphqlClient(result: object): Client {
  return {
    mutation: jest.fn(() => ({ toPromise: jest.fn().mockResolvedValue(result) })),
  } as unknown as Client;
}

function createStep({
  graphqlClient,
  env = { EAS_BUILD_ID: BUILD_ID },
  callInputs = APP_METADATA_INPUTS,
  globalCtx = createGlobalContextMock(),
}: {
  graphqlClient: Client;
  env?: Record<string, string>;
  callInputs?: Record<string, unknown>;
  globalCtx?: BuildStepGlobalContext;
}): ReturnType<
  ReturnType<typeof createUpdateRemoteBuildMetadataBuildFunction>['createBuildStepFromFunctionCall']
> {
  return createUpdateRemoteBuildMetadataBuildFunction({
    graphqlClient,
    env,
  } as unknown as CustomBuildContext<BuildJob>).createBuildStepFromFunctionCall(globalCtx, {
    callInputs,
  });
}

async function runStepThatOutputsAsync(
  globalCtx: BuildStepGlobalContext,
  outputValues: Record<string, string>
): Promise<void> {
  await new BuildFunction({
    namespace: 'test',
    id: 'read_app',
    name: 'Read app',
    outputProviders: Object.keys(APP_METADATA_INPUTS).map(id =>
      BuildStepOutput.createProvider({ id, required: false })
    ),
    fn: async (_stepCtx, { outputs }) => {
      for (const [id, value] of Object.entries(outputValues)) {
        outputs[id].set(value);
      }
    },
  })
    .createBuildStepFromFunctionCall(globalCtx, { id: 'read_app' })
    .executeAsync();
}

const updatedBuildResult = { data: { build: { updateBuildMetadata: { id: BUILD_ID } } } };

function sentMetadataOf(graphqlClient: Client): Record<string, unknown> {
  const [, variables] = jest.mocked(graphqlClient.mutation).mock.calls[0];
  return (variables as { metadata: Record<string, unknown> }).metadata;
}

const COMMIT_HASH = 'aab03fbdabb6e536ea78b28df91575ad488f5f21';

function mockCheckedOutCommit(message: string): void {
  jest.mocked(spawn).mockResolvedValue({ stdout: `${COMMIT_HASH}\n${message}` } as never);
}

beforeEach(() => {
  mockCheckedOutCommit('Fix the login screen\n\nIt did not scroll.\n');
});

describe(createUpdateRemoteBuildMetadataBuildFunction, () => {
  it('saves the name, the identifier, the version and the build version of the app, and the commit of the checkout, to the build', async () => {
    const graphqlClient = createGraphqlClient(updatedBuildResult);
    const step = createStep({ graphqlClient });

    await step.executeAsync();

    expect(graphqlClient.mutation).toHaveBeenCalledTimes(1);
    expect(graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      buildId: BUILD_ID,
      metadata: {
        appName: 'Native App',
        appIdentifier: 'dev.expo.nativeapp',
        appVersion: '1.2.0',
        appBuildVersion: '43',
        gitCommitHash: COMMIT_HASH,
        gitCommitMessage: 'Fix the login screen\n\nIt did not scroll.',
      },
    });
    expect(spawn).toHaveBeenCalledWith('git', ['--no-pager', 'log', '-1', '--pretty=%H%n%B'], {
      cwd: step.ctx.global.projectTargetDirectory,
      stdio: 'pipe',
    });
    expect(step.ctx.logger.info).toHaveBeenCalledWith(
      `Saved to the build: {"appName":"Native App","appIdentifier":"dev.expo.nativeapp","appVersion":"1.2.0","appBuildVersion":"43","gitCommitHash":"${COMMIT_HASH}","gitCommitMessage":"Fix the login screen\\n\\nIt did not scroll."}`
    );
  });

  it('leaves out the values that the step before it did not output, and the empty ones', async () => {
    const graphqlClient = createGraphqlClient(updatedBuildResult);
    const globalCtx = createGlobalContextMock();
    await runStepThatOutputsAsync(globalCtx, {
      app_name: 'NativeApp',
      application_identifier: 'dev.expo.nativeapp',
      app_version: '',
    });

    const step = createStep({
      graphqlClient,
      globalCtx,
      callInputs: Object.fromEntries(
        Object.keys(APP_METADATA_INPUTS).map(id => [id, `\${{ steps.read_app.outputs.${id} }}`])
      ),
    });

    await step.executeAsync();

    expect(graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      buildId: BUILD_ID,
      metadata: {
        appName: 'NativeApp',
        appIdentifier: 'dev.expo.nativeapp',
        appVersion: undefined,
        appBuildVersion: undefined,
        gitCommitHash: COMMIT_HASH,
        gitCommitMessage: 'Fix the login screen\n\nIt did not scroll.',
      },
    });
  });

  it('shortens a commit message that is longer than the build metadata takes', async () => {
    mockCheckedOutCommit('a'.repeat(5000));
    const graphqlClient = createGraphqlClient(updatedBuildResult);

    await createStep({ graphqlClient }).executeAsync();

    expect(sentMetadataOf(graphqlClient).gitCommitMessage).toBe(`${'a'.repeat(4093)}...`);
  });

  it('saves the commit hash without a message when the commit has none', async () => {
    mockCheckedOutCommit('\n');
    const graphqlClient = createGraphqlClient(updatedBuildResult);

    await createStep({ graphqlClient }).executeAsync();

    expect(sentMetadataOf(graphqlClient)).toMatchObject({
      gitCommitHash: COMMIT_HASH,
      gitCommitMessage: undefined,
    });
  });

  it.each([
    [
      'prints another line before the hash',
      `gpg: Signature made today\n${COMMIT_HASH}\nFix the login screen\n`,
    ],
    ['prints nothing', ''],
  ])('saves the values of the app without a commit when git %s', async (_description, stdout) => {
    jest.mocked(spawn).mockResolvedValue({ stdout } as never);
    const graphqlClient = createGraphqlClient(updatedBuildResult);

    await createStep({ graphqlClient }).executeAsync();

    expect(sentMetadataOf(graphqlClient)).toEqual({
      appName: 'Native App',
      appIdentifier: 'dev.expo.nativeapp',
      appVersion: '1.2.0',
      appBuildVersion: '43',
    });
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Failed to read the commit of the checkout',
      expect.any(Error)
    );
  });

  it('saves the values of the app without a commit, and reports to Sentry and not to the build log, when git cannot read one', async () => {
    const error = new Error('not a git repository');
    jest.mocked(spawn).mockRejectedValue(error);
    const graphqlClient = createGraphqlClient(updatedBuildResult);
    const step = createStep({ graphqlClient });

    await step.executeAsync();

    expect(sentMetadataOf(graphqlClient)).toEqual({
      appName: 'Native App',
      appIdentifier: 'dev.expo.nativeapp',
      appVersion: '1.2.0',
      appBuildVersion: '43',
    });
    expect(Sentry.capture).toHaveBeenCalledWith('Failed to read the commit of the checkout', error);
    const { info, warn, error: logError } = step.ctx.logger;
    for (const log of [info, warn, logError]) {
      expect(JSON.stringify(jest.mocked(log).mock.calls)).not.toContain('not a git repository');
    }
  });

  it('fails the build with the reason of the server and the way out when EAS does not save the values', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'Updating metadata is allowed only for unfinished builds',
          extensions: { errorCode: 'VALIDATION_ERROR', isTransient: false },
        },
      ],
    });
    const graphqlClient = createGraphqlClient({ error });

    const promise = createStep({ graphqlClient }).executeAsync();

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({
      message:
        'EAS could not save the name, identifier and version of the built app to this build: [GraphQL] Updating metadata is allowed only for unfinished builds\nThe build fails because these values cannot be added after it finishes, and the install link of the build needs them. Run the build again, and contact Expo support if it keeps failing.',
      cause: error,
    });
    expect(graphqlClient.mutation).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the job does not run for a build on EAS', async () => {
    const graphqlClient = createGraphqlClient(updatedBuildResult);
    const step = createStep({ graphqlClient, env: {} });

    await step.executeAsync();

    expect(graphqlClient.mutation).not.toHaveBeenCalled();
    expect(step.ctx.logger.info).toHaveBeenCalledWith('EAS_BUILD_ID not set, skipping.');
  });
});

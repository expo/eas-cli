import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionMutation } from '../../graphql/mutations/DeviceRunSessionMutation';
import Log from '../../log';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  DEVICE_RUN_SESSION_ANNOTATION_CATEGORIES,
  DeviceRunSessionAnnotationUploadError,
  appendAndUploadDeviceRunSessionAnnotationAsync,
  createDeviceRunSessionAnnotation,
} from '../../simulator/annotations';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorAnnotate extends EasCommand {
  static override hidden = true;
  static override aliases = ['sim:annotate'];
  static override description = '[EXPERIMENTAL] add agent commentary to a remote simulator session';

  static override args = {
    message: Args.string({
      required: true,
      description: 'Concise commentary to attach to the simulator session.',
    }),
  };

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    category: Flags.option({
      description: 'Kind of commentary being recorded.',
      options: [...DEVICE_RUN_SESSION_ANNOTATION_CATEGORIES],
      default: 'commentary',
    })(),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(SimulatorAnnotate);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const annotation = createDeviceRunSessionAnnotation({
      category: flags.category,
      message: args.message,
    });
    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorAnnotate, { nonInteractive });
    await loadSimulatorEnvAsync(projectDir);
    const deviceRunSessionId = flags.id ?? process.env[EAS_SIMULATOR_SESSION_ID];
    if (!deviceRunSessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const { artifact, uploadSession } =
      await DeviceRunSessionMutation.createAnnotationLogUploadSessionAsync(
        graphqlClient,
        deviceRunSessionId
      );

    let fileSizeBytes: number;
    try {
      ({ fileSizeBytes } = await appendAndUploadDeviceRunSessionAnnotationAsync({
        annotation,
        deviceRunSessionId,
        uploadSession: {
          downloadUrl: artifact.downloadUrl,
          uploadUrl: uploadSession.url,
          uploadHeaders: uploadSession.headers,
        },
      }));
    } catch (error) {
      if (error instanceof DeviceRunSessionAnnotationUploadError) {
        throw new Error(
          `The annotation was saved locally but could not be uploaded. The next annotation command will retry the complete log.`,
          { cause: error }
        );
      }
      throw error;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        annotation,
        artifactId: artifact.id,
        deviceRunSessionId,
        fileSizeBytes,
      });
      return;
    }

    Log.log(`Added ${annotation.category} annotation to simulator session ${deviceRunSessionId}.`);
  }
}

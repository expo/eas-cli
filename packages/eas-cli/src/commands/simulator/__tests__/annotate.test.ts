import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionMutation } from '../../../graphql/mutations/DeviceRunSessionMutation';
import Log from '../../../log';
import {
  DeviceRunSessionAnnotationUploadError,
  appendAndUploadDeviceRunSessionAnnotationAsync,
  createDeviceRunSessionAnnotation,
} from '../../../simulator/annotations';
import { EAS_SIMULATOR_SESSION_ID, loadSimulatorEnvAsync } from '../../../simulator/env';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorAnnotate from '../annotate';

jest.mock('../../../graphql/mutations/DeviceRunSessionMutation');
jest.mock('../../../log');
jest.mock('../../../simulator/annotations', () => ({
  ...jest.requireActual('../../../simulator/annotations'),
  appendAndUploadDeviceRunSessionAnnotationAsync: jest.fn(),
  createDeviceRunSessionAnnotation: jest.fn(),
}));
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../utils/json');

const mockAppendAndUpload = jest.mocked(appendAndUploadDeviceRunSessionAnnotationAsync);
const mockCreateAnnotation = jest.mocked(createDeviceRunSessionAnnotation);
const mockCreateUploadSession = jest.mocked(
  DeviceRunSessionMutation.createAnnotationLogUploadSessionAsync
);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockLoadSimulatorEnvAsync = jest.mocked(loadSimulatorEnvAsync);
const mockLog = jest.mocked(Log.log);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  return config;
}

describe(SimulatorAnnotate, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const annotation = {
    v: 1 as const,
    annotationId: 'annotation-id',
    ts: '2026-08-11T12:00:00.000Z',
    category: 'commentary' as const,
    message: 'Opening settings.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    mockCreateAnnotation.mockReturnValue(annotation);
    mockCreateUploadSession.mockResolvedValue({
      artifact: {
        id: 'artifact-id',
        downloadUrl: 'https://example.test/annotations',
      },
      uploadSession: {
        url: 'https://storage.test/annotations',
        headers: { 'x-goog-content-length-range': '0,5242880' },
      },
    });
    mockAppendAndUpload.mockResolvedValue({
      filePath: '/data/annotations.ndjson',
      fileSizeBytes: 123,
    });
    mockLoadSimulatorEnvAsync.mockImplementation(async () => {
      process.env[EAS_SIMULATOR_SESSION_ID] = 'session-from-env';
    });
  });

  afterEach(() => {
    delete process.env[EAS_SIMULATOR_SESSION_ID];
  });

  it('appends commentary to the dotenv session and uploads it directly', async () => {
    const command = createCommand(['Opening settings.']);

    await command.runAsync();

    expect(mockCreateAnnotation).toHaveBeenCalledWith({
      category: 'commentary',
      message: 'Opening settings.',
    });
    expect(mockLoadSimulatorEnvAsync).toHaveBeenCalledWith('/test/project');
    expect(mockCreateUploadSession).toHaveBeenCalledWith(graphqlClient, 'session-from-env');
    expect(mockAppendAndUpload).toHaveBeenCalledWith({
      annotation,
      deviceRunSessionId: 'session-from-env',
      uploadSession: {
        downloadUrl: 'https://example.test/annotations',
        uploadUrl: 'https://storage.test/annotations',
        uploadHeaders: { 'x-goog-content-length-range': '0,5242880' },
      },
    });
    expect(mockLog).toHaveBeenCalledWith(
      'Added commentary annotation to simulator session session-from-env.'
    );
  });

  it('accepts an explicit session and category and prints JSON output', async () => {
    const command = createCommand([
      'Enabling dark mode.',
      '--id',
      'explicit-session',
      '--category',
      'decision',
      '--json',
    ]);

    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockCreateAnnotation).toHaveBeenCalledWith({
      category: 'decision',
      message: 'Enabling dark mode.',
    });
    expect(mockCreateUploadSession).toHaveBeenCalledWith(graphqlClient, 'explicit-session');
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      annotation,
      artifactId: 'artifact-id',
      deviceRunSessionId: 'explicit-session',
      fileSizeBytes: 123,
    });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('requires a session id', async () => {
    mockLoadSimulatorEnvAsync.mockResolvedValue();
    const command = createCommand(['Opening settings.']);

    await expect(command.runAsync()).rejects.toThrow('No simulator session ID provided');
    expect(mockCreateUploadSession).not.toHaveBeenCalled();
  });

  it('explains that a failed upload remains in the local spool', async () => {
    mockAppendAndUpload.mockRejectedValue(
      new DeviceRunSessionAnnotationUploadError(
        '/data/annotations.ndjson',
        new Error('network unavailable')
      )
    );
    const command = createCommand(['Opening settings.']);

    await expect(command.runAsync()).rejects.toThrow(
      'The annotation was saved locally but could not be uploaded'
    );
  });

  function createCommand(argv: string[]): SimulatorAnnotate {
    const command = new SimulatorAnnotate(argv, getMockOclifConfig());
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir: '/test/project',
    });
    return command;
  }
});

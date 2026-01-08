import { randomBytes, randomUUID } from 'crypto';

import { JobInterpolationContext } from '@expo/eas-build-job';
import {
  BuildRuntimePlatform,
  BuildStep,
  BuildStepGlobalContext,
  BuildStepOutput,
} from '@expo/steps';
import { createLogger } from '@expo/logger';
import fetch, { Response } from 'node-fetch';

import { collectJobOutputs, uploadJobOutputsToWwwAsync } from '../outputs';
import { TurtleFetchError } from '../turtleFetch';

jest.mock('node-fetch');

const workflowJobId = randomUUID();
const robotAccessToken = randomBytes(32).toString('hex');

const env = {
  __WORKFLOW_JOB_ID: workflowJobId,
};

const context = new BuildStepGlobalContext(
  {
    buildLogsDirectory: 'test',
    projectSourceDirectory: 'test',
    projectTargetDirectory: 'test',
    defaultWorkingDirectory: 'test',
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    staticContext: () => ({
      job: {
        outputs: {
          fingerprintHash: '${{ steps.setup.outputs.fingerprint_hash }}',
          nodeVersion: '${{ steps.node_setup.outputs.node_version }}',
        },
        secrets: {
          robotAccessToken,
        },
      } as any,
      metadata: {} as any,
      env,
      expoApiServerURL: 'https://api.expo.test',
    }),
    env,
    logger: createLogger({ name: 'test' }),
    updateEnv: () => {},
  },
  false
);

const fingerprintHashStepOutput = new BuildStepOutput(context, {
  id: 'fingerprint_hash',
  stepDisplayName: 'test',
  required: true,
});
fingerprintHashStepOutput.set('mock-fingerprint-hash');

const unusedStepOutput = new BuildStepOutput(context, {
  id: 'test3',
  stepDisplayName: 'test',
  required: false,
});

context.registerStep(
  new BuildStep(context, {
    id: 'setup',
    displayName: 'test',
    command: 'test',
    outputs: [fingerprintHashStepOutput, unusedStepOutput],
  })
);

const nodeVersionStepOutput = new BuildStepOutput(context, {
  id: 'node_version',
  stepDisplayName: 'test2',
  required: false,
});

context.registerStep(
  new BuildStep(context, {
    id: 'node_setup',
    displayName: 'test2',
    command: 'test2',
    outputs: [nodeVersionStepOutput],
  })
);

const interpolationContext: JobInterpolationContext = {
  ...context.staticContext,
  env: {},
  always: () => true,
  never: () => false,
  success: () => !context.hasAnyPreviousStepFailed,
  failure: () => context.hasAnyPreviousStepFailed,
  fromJSON: (json: string) => JSON.parse(json),
  toJSON: (value: unknown) => JSON.stringify(value),
  contains: (value: string, substring: string) => value.includes(substring),
  startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  endsWith: (value: string, suffix: string) => value.endsWith(suffix),
  hashFiles: (...value: string[]) => value.join(','),
  replaceAll: (input: string, stringToReplace: string, replacementString: string) => {
    while (input.includes(stringToReplace)) {
      input = input.replace(stringToReplace, replacementString);
    }
    return input;
  },
  substring: (input: string, start: number, end?: number) => input.substring(start, end),
};

describe(collectJobOutputs, () => {
  it('returns empty object for outputs of a step with no outputs', () => {
    expect(
      collectJobOutputs({
        jobOutputDefinitions: {},
        interpolationContext,
      })
    ).toEqual({});
  });

  it('interpolates outputs', () => {
    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          test: '${{ 1 + 1 }}',
          substring: '${{ substring("hello", 1, 3) }}',
        },
        interpolationContext,
      })
    ).toEqual({ test: '2', substring: 'el' });

    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          fingerprint_hash: '${{ steps.setup.outputs.fingerprint_hash }}',
        },
        interpolationContext,
      })
    ).toEqual({ fingerprint_hash: 'mock-fingerprint-hash' });
  });

  it('defaults missing values to empty string', () => {
    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          missing_output: '${{ steps.setup.outputs.missing_output }}',
          not_set_output: '${{ steps.setup.outputs.test_3 }}',
        },
        interpolationContext,
      })
    ).toEqual({ missing_output: '', not_set_output: '' });
  });

  it('interpolates hashFiles function', () => {
    const mockHash = 'mockhash';
    const contextWithHash: JobInterpolationContext = {
      ...interpolationContext,
      hashFiles: jest.fn(() => mockHash),
    };

    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          file_hash: '${{ hashFiles("package.json") }}',
        },
        interpolationContext: contextWithHash,
      })
    ).toEqual({ file_hash: mockHash });

    expect(contextWithHash.hashFiles).toHaveBeenCalledWith('package.json');
  });

  it('interpolates hashFiles with multiple patterns', () => {
    const mockHash = 'mockhash';
    const contextWithHash: JobInterpolationContext = {
      ...interpolationContext,
      hashFiles: jest.fn(() => mockHash),
    };

    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          combined: 'key-${{ hashFiles("*.lock") }}-v1',
        },
        interpolationContext: contextWithHash,
      })
    ).toEqual({ combined: `key-${mockHash}-v1` });

    expect(contextWithHash.hashFiles).toHaveBeenCalledWith('*.lock');

    const contextWithMultiPattern: JobInterpolationContext = {
      ...interpolationContext,
      hashFiles: jest.fn(() => mockHash),
    };

    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          multi_pattern: '${{ hashFiles("**/package-lock.json", "**/Gemfile.lock") }}',
        },
        interpolationContext: contextWithMultiPattern,
      })
    ).toEqual({ multi_pattern: mockHash });

    expect(contextWithMultiPattern.hashFiles).toHaveBeenCalledWith(
      '**/package-lock.json',
      '**/Gemfile.lock'
    );
  });

  it('handles hashFiles with empty result', () => {
    const contextWithEmptyHash: JobInterpolationContext = {
      ...interpolationContext,
      hashFiles: () => '',
    };

    expect(
      collectJobOutputs({
        jobOutputDefinitions: {
          cache_key: 'prefix-${{ hashFiles("nonexistent.txt") }}-suffix',
        },
        interpolationContext: contextWithEmptyHash,
      })
    ).toEqual({ cache_key: 'prefix--suffix' });
  });
});

describe(uploadJobOutputsToWwwAsync, () => {
  it('uploads outputs', async () => {
    const logger = createLogger({ name: 'test' }).child('test');

    const fetchMock = jest.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response);
    await uploadJobOutputsToWwwAsync(context, {
      logger,
      expoApiV2BaseUrl: 'http://exp.test/--/api/v2/',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://exp.test/--/api/v2/workflows/${workflowJobId}`, // URL
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        body: JSON.stringify({
          outputs: { fingerprintHash: 'mock-fingerprint-hash', nodeVersion: '' },
        }),
      })
    );
  });

  it('outputs upload fails, succeeds on retry', async () => {
    const logger = createLogger({ name: 'test' }).child('test');

    const fetchMock = jest.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Request failed',
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response);
    await uploadJobOutputsToWwwAsync(context, {
      logger,
      expoApiV2BaseUrl: 'http://exp.test/--/api/v2/',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://exp.test/--/api/v2/workflows/${workflowJobId}`, // URL
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        body: JSON.stringify({
          outputs: { fingerprintHash: 'mock-fingerprint-hash', nodeVersion: '' },
        }),
      })
    );
  });

  it('outputs upload fails', async () => {
    const logger = createLogger({ name: 'test' }).child('test');

    const loggerErrorSpy = jest.spyOn(logger, 'error');
    const fetchMock = jest.mocked(fetch);
    const expectedFetchResponse = {
      ok: false,
      status: 400,
      statusText: 'Request failed',
    } as unknown as Response;
    fetchMock.mockResolvedValue(expectedFetchResponse);
    const expectedThrownError = new TurtleFetchError(
      'Request failed with status 400',
      expectedFetchResponse
    );
    await expect(
      uploadJobOutputsToWwwAsync(context, {
        logger,
        expoApiV2BaseUrl: 'http://exp.test/--/api/v2/',
      })
    ).rejects.toThrow(expectedThrownError);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://exp.test/--/api/v2/workflows/${workflowJobId}`, // URL
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        body: JSON.stringify({
          outputs: { fingerprintHash: 'mock-fingerprint-hash', nodeVersion: '' },
        }),
      })
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      { err: expectedThrownError },
      'Failed to upload outputs'
    );
  });
});

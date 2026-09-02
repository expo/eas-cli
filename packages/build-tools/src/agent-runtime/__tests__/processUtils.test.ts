import { errors } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';

import {
  SecretRedactingTransform,
  assertAgentExecutableVersionAsync,
  runBoundedAgentProcessAsync,
} from '../processUtils';

describe(SecretRedactingTransform, () => {
  it('redacts secrets split between output chunks', async () => {
    const transform = new SecretRedactingTransform(['access-token']);
    let output = '';
    transform.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    transform.write('before access-');
    transform.write('token after');
    transform.end();
    await new Promise<void>((resolve, reject) => {
      transform.on('end', resolve);
      transform.on('error', reject);
    });

    expect(output).toBe('before ************ after');
    expect(output).not.toContain('access-token');
  });
});

describe(assertAgentExecutableVersionAsync, () => {
  it('accepts the expected executable version', async () => {
    await expect(
      assertAgentExecutableVersionAsync({
        executable: process.execPath,
        expectedVersion: process.versions.node,
        displayName: 'Node.js',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects a different version', async () => {
    await expect(
      assertAgentExecutableVersionAsync({
        executable: process.execPath,
        expectedVersion: '0.0.0',
        displayName: 'Node.js',
      })
    ).rejects.toBeInstanceOf(errors.UserError);
  });
});

describe(runBoundedAgentProcessAsync, () => {
  it('closes stdin for a non-interactive process', async () => {
    await expect(
      runBoundedAgentProcessAsync({
        command: process.execPath,
        args: ['-e', 'process.stdin.resume()'],
        env: process.env,
        logger: { info: jest.fn(), error: jest.fn() } as unknown as bunyan,
        maximumInvocationSeconds: 5,
        secrets: [],
      })
    ).resolves.toBeDefined();
  });
});

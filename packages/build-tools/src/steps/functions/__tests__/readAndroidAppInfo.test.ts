import spawn from '@expo/spawn-async';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';

import { aabPath, apkPath, packageName } from './fixtures/androidTestUtils';
import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { prepareAndroidArtifactAsync } from '../../utils/android/appArtifact';
import { createReadAndroidAppInfoBuildFunction } from '../readAndroidAppInfo';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.mock('@expo/spawn-async');

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'android-artifact-test-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it.each([
  [
    'apk',
    apkPath,
    `package: name='${packageName}' versionCode='42' versionName='1.0'\nsdkVersion:'23'\n`,
  ],
  ['aab', aabPath, `${packageName}\n`],
])(
  'reads %s contents with a misleading extension and returns step outputs',
  async (type, source, stdout) => {
    const artifactPath = path.join(directory, 'misleading.tar.gz');
    await fs.copyFile(source, artifactPath);
    jest.mocked(spawn).mockReturnValue(
      Object.assign(Promise.resolve({ stdout }), {
        child: { kill: jest.fn() },
      }) as unknown as ReturnType<typeof spawn>
    );
    const step = createReadAndroidAppInfoBuildFunction().createBuildStepFromFunctionCall(
      createGlobalContextMock({ staticContextContent: { job: {} } }),
      { callInputs: { artifact_path: artifactPath } }
    );
    await step.executeAsync();
    expect(step.outputById.package_name.value).toBe(packageName);
    expect(step.outputById.artifact_type.value).toBe(type);
    expect(step.outputById.artifact_path.value).toBe(artifactPath);
    // This is the external tool contract, not an internal implementation call.
    expect(spawn).toHaveBeenCalledWith(
      type === 'apk' ? 'aapt2' : 'bundletool',
      type === 'apk'
        ? ['dump', 'badging', artifactPath]
        : ['dump', 'manifest', '--bundle', artifactPath, '--xpath', '/manifest/@package'],
      { stdio: 'pipe' }
    );
  }
);

it('finds the only app binary in a tar.gz and preserves it for the next step', async () => {
  await fs.mkdir(path.join(directory, 'nested'));
  await fs.copyFile(aabPath, path.join(directory, 'nested/app.unknown'));
  await fs.writeFile(path.join(directory, 'readme.txt'), 'Build output');
  const archive = path.join(directory, 'download');
  await tar.create({ cwd: directory, gzip: true, file: archive }, ['nested', 'readme.txt']);
  const result = await prepareAndroidArtifactAsync(archive);
  try {
    expect(result.artifactType).toBe('aab');
    expect(await fs.readFile(result.artifactPath)).toEqual(await fs.readFile(aabPath));
  } finally {
    await fs.rm(result.extractionDirectory!, { recursive: true, force: true });
  }
});

it('rejects ambiguous extracted artifacts instead of choosing the first app', async () => {
  await fs.copyFile(apkPath, path.join(directory, 'one.apk'));
  await fs.copyFile(aabPath, path.join(directory, 'two.aab'));
  await expect(prepareAndroidArtifactAsync(directory)).rejects.toThrow('found 2');
});

it('does not silently skip a damaged app in a directory that also has a valid app', async () => {
  await fs.copyFile(apkPath, path.join(directory, 'valid.apk'));
  await fs.writeFile(path.join(directory, 'damaged.aab'), 'not a zip');
  await expect(prepareAndroidArtifactAsync(directory)).rejects.toThrow(
    'Cannot read Android artifact'
  );
});

it.each(['empty', 'corrupt.apk'])('rejects invalid binary %s', async name => {
  const artifact = path.join(directory, name);
  await fs.writeFile(artifact, name === 'empty' ? '' : 'PK corrupt');
  await expect(prepareAndroidArtifactAsync(artifact)).rejects.toThrow(
    'Cannot read Android artifact'
  );
});

it('fails without outputs when the manifest tool returns no package name', async () => {
  jest.mocked(spawn).mockReturnValue(
    Object.assign(Promise.resolve({ stdout: 'badging without a package' }), {
      child: { kill: jest.fn() },
    }) as unknown as ReturnType<typeof spawn>
  );
  const step = createReadAndroidAppInfoBuildFunction().createBuildStepFromFunctionCall(
    createGlobalContextMock({ staticContextContent: { job: {} } }),
    { callInputs: { artifact_path: apkPath } }
  );
  await expect(step.executeAsync()).rejects.toThrow('Cannot read the app package');
  expect(() => step.outputById.package_name.value).toThrow('was not set');
});

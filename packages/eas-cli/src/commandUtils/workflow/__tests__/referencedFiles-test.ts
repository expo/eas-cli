import { vol } from 'memfs';

import { collectReferencedWorkflowFilesAsync } from '../referencedFiles';

jest.mock('fs');

const projectDir = '/app';
const workflowsDir = `${projectDir}/.eas/workflows`;

function callerYaml(calls: Record<string, string>): string {
  return [
    'jobs:',
    ...Object.entries(calls).flatMap(([jobKey, fileName]) => [
      `  ${jobKey}:`,
      `    uses: ./.eas/workflows/${fileName}`,
    ]),
    '',
  ].join('\n');
}

const calleeYaml = [
  'on:',
  '  workflow_call: {}',
  'jobs:',
  '  job:',
  '    steps:',
  '      - run: echo hi',
  '',
].join('\n');

async function collectAsync(
  rootYamlConfig: string
): Promise<{ fileName: string; yamlConfig: string }[]> {
  return await collectReferencedWorkflowFilesAsync({
    projectDir,
    rootFileName: 'root.yml',
    rootYamlConfig,
  });
}

describe(collectReferencedWorkflowFilesAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('returns no files and reads nothing when the root has no uses jobs', async () => {
    vol.fromJSON({ [`${workflowsDir}/unused.yml`]: 'jobs: [not: valid' });

    await expect(collectAsync(calleeYaml)).resolves.toEqual([]);
  });

  it('returns no files when the root is not valid YAML', async () => {
    await expect(collectAsync('jobs: [not: valid')).resolves.toEqual([]);
  });

  it('collects a file called from one job', async () => {
    vol.fromJSON({ [`${workflowsDir}/build.yml`]: calleeYaml });

    await expect(collectAsync(callerYaml({ ship: 'build.yml' }))).resolves.toEqual([
      { fileName: 'build.yml', yamlConfig: calleeYaml },
    ]);
  });

  it('collects nested calls in discovery order', async () => {
    const releaseYaml = `on:\n  workflow_call: {}\n${callerYaml({ build: 'build.yml' })}`;
    vol.fromJSON({
      [`${workflowsDir}/release.yml`]: releaseYaml,
      [`${workflowsDir}/build.yaml`]: calleeYaml,
      [`${workflowsDir}/build.yml`]: calleeYaml,
    });

    await expect(collectAsync(callerYaml({ release: 'release.yml' }))).resolves.toEqual([
      { fileName: 'release.yml', yamlConfig: releaseYaml },
      { fileName: 'build.yml', yamlConfig: calleeYaml },
    ]);
  });

  it('collects each file once and stops at cycles', async () => {
    const aYaml = callerYaml({ b: 'b.yml' });
    const bYaml = callerYaml({ a: 'a.yml', root: 'root.yml', c: 'c.yml' });
    vol.fromJSON({
      [`${workflowsDir}/a.yml`]: aYaml,
      [`${workflowsDir}/b.yml`]: bYaml,
      [`${workflowsDir}/c.yml`]: calleeYaml,
    });

    await expect(
      collectAsync(callerYaml({ first: 'a.yml', second: 'c.yml', third: 'a.yml' }))
    ).resolves.toEqual([
      { fileName: 'a.yml', yamlConfig: aYaml },
      { fileName: 'c.yml', yamlConfig: calleeYaml },
      { fileName: 'b.yml', yamlConfig: bYaml },
    ]);
  });

  it('fails when a called file does not exist', async () => {
    await expect(collectAsync(callerYaml({ ship: 'missing.yml' }))).rejects.toThrow(
      'Job "ship" in root.yml uses ./.eas/workflows/missing.yml, but /app/.eas/workflows/missing.yml does not exist.'
    );
  });

  it('fails when a nested called file does not exist', async () => {
    vol.fromJSON({ [`${workflowsDir}/release.yml`]: callerYaml({ build: 'missing.yml' }) });

    await expect(collectAsync(callerYaml({ release: 'release.yml' }))).rejects.toThrow(
      'Job "build" in release.yml uses ./.eas/workflows/missing.yml, but /app/.eas/workflows/missing.yml does not exist.'
    );
  });

  it('fails when a called file is not valid YAML', async () => {
    vol.fromJSON({ [`${workflowsDir}/build.yml`]: 'jobs: [not: valid' });

    await expect(collectAsync(callerYaml({ ship: 'build.yml' }))).rejects.toThrow(
      /^Job "ship" in root\.yml uses \.\/\.eas\/workflows\/build\.yml, but \/app\/\.eas\/workflows\/build\.yml is not valid YAML: /
    );
  });

  it('skips uses values the server does not accept', async () => {
    const rootYaml = [
      'jobs:',
      '  nested:',
      '    uses: ./.eas/workflows/nested/build.yml',
      '  interpolated:',
      '    uses: ./.eas/workflows/${{ inputs.name }}.yml',
      '  notString:',
      '    uses: { path: ./.eas/workflows/build.yml }',
      '  valid:',
      '    uses: ./.eas/workflows/build.yml',
      '',
    ].join('\n');
    vol.fromJSON({ [`${workflowsDir}/build.yml`]: calleeYaml });

    await expect(collectAsync(rootYaml)).resolves.toEqual([
      { fileName: 'build.yml', yamlConfig: calleeYaml },
    ]);
  });
});

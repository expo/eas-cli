import fs from 'fs';
import path from 'path';

import { parsedYamlFromWorkflowContents } from './parse';
import { WorkflowReferencedFileInput } from '../../graphql/generated';

const WORKFLOW_CALL_USES_REGEX = /^\.\/\.eas\/workflows\/(?:(?!\$\{\{)[^/\\])+\.ya?ml$/;

type WorkflowCall = { callerFileName: string; callerJobKey: string; uses: string };

export async function collectReferencedWorkflowFilesAsync({
  projectDir,
  rootFileName,
  rootYamlConfig,
}: {
  projectDir: string;
  rootFileName: string;
  rootYamlConfig: string;
}): Promise<WorkflowReferencedFileInput[]> {
  let rootYaml: unknown;
  try {
    rootYaml = parsedYamlFromWorkflowContents({ yamlConfig: rootYamlConfig });
  } catch {
    return [];
  }

  const collectedFileNames = new Set<string>([rootFileName]);
  const referencedFiles: WorkflowReferencedFileInput[] = [];
  const pendingCalls = getWorkflowCalls(rootFileName, rootYaml);
  for (const call of pendingCalls) {
    const fileName = path.posix.basename(call.uses);
    if (collectedFileNames.has(fileName)) {
      continue;
    }
    collectedFileNames.add(fileName);
    const { yamlConfig, parsedYaml } = await readReferencedWorkflowFileAsync(
      projectDir,
      fileName,
      call
    );
    referencedFiles.push({ fileName, yamlConfig });
    pendingCalls.push(...getWorkflowCalls(fileName, parsedYaml));
  }
  return referencedFiles;
}

function getWorkflowCalls(callerFileName: string, parsedYaml: unknown): WorkflowCall[] {
  const jobs = (parsedYaml as { jobs?: unknown } | null)?.jobs;
  if (!jobs || typeof jobs !== 'object') {
    return [];
  }
  return Object.entries(jobs).flatMap(([callerJobKey, job]) => {
    const uses = (job as { uses?: unknown } | null)?.uses;
    return typeof uses === 'string' && WORKFLOW_CALL_USES_REGEX.test(uses)
      ? [{ callerFileName, callerJobKey, uses }]
      : [];
  });
}

async function readReferencedWorkflowFileAsync(
  projectDir: string,
  fileName: string,
  { callerFileName, callerJobKey, uses }: WorkflowCall
): Promise<{ yamlConfig: string; parsedYaml: unknown }> {
  const filePath = path.join(projectDir, '.eas', 'workflows', fileName);
  const describeCall = `Job "${callerJobKey}" in ${callerFileName} uses ${uses}, but ${filePath}`;

  let yamlConfig: string;
  try {
    yamlConfig = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${describeCall} does not exist.`);
    }
    throw new Error(`${describeCall} could not be read: ${(error as Error).message}`);
  }

  try {
    return { yamlConfig, parsedYaml: parsedYamlFromWorkflowContents({ yamlConfig }) };
  } catch (error) {
    throw new Error(`${describeCall} is not valid YAML: ${(error as Error).message}`);
  }
}

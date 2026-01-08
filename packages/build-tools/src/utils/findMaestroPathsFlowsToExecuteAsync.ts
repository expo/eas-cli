import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { bunyan } from '@expo/logger';
import * as yaml from 'yaml';
import { z } from 'zod';
import { asyncResult } from '@expo/results';
import fg from 'fast-glob';

const FlowConfigSchema = z.object({
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const WorkspaceConfigSchema = z.object({
  flows: z.array(z.string()).optional(),
  executionOrder: z.record(z.string(), z.unknown()).optional(),
  includeTags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
});

type FlowConfig = z.infer<typeof FlowConfigSchema>;
type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export async function findMaestroPathsFlowsToExecuteAsync({
  workingDirectory,
  flowPath,
  includeTags: _includeTags,
  excludeTags: _excludeTags,
  logger,
}: {
  workingDirectory: string;
  flowPath: string;
  includeTags: string[] | undefined;
  excludeTags: string[] | undefined;
  logger: bunyan;
}): Promise<string[]> {
  const absoluteFlowPath = path.resolve(workingDirectory, flowPath);
  // If it's a file, just return it (no validation needed)
  const stat = await fs.stat(absoluteFlowPath);

  if (stat.isFile()) {
    logger.info(`Found a file: ${path.relative(workingDirectory, absoluteFlowPath)}`);
    return [absoluteFlowPath];
  }

  // It's a directory - discover flow files
  logger.info(`Found a directory: ${path.relative(workingDirectory, absoluteFlowPath)}`);

  // Check for workspace config
  logger.info(`Searching for workspace config...`);
  const workspaceConfig = await findAndParseWorkspaceConfigAsync({
    dirPath: absoluteFlowPath,
    workingDirectory,
    logger,
  });
  logger.info(`Using workspace config: ${JSON.stringify(workspaceConfig)}`);

  if (workspaceConfig?.executionOrder) {
    logger.warn(`Execution order is not supported yet. Ignoring.`);
  }

  logger.info(`Searching for flow files...`);
  const { flows } = await findAndParseFlowFilesAsync({
    dirPath: absoluteFlowPath,
    workingDirectory,
    workspaceConfig,
    logger,
  });

  if (flows.length === 0) {
    logger.info(
      `No valid flow files found in: ${path.relative(workingDirectory, absoluteFlowPath)}`
    );
    return [];
  }

  const includeTags = [...(_includeTags ?? []), ...(workspaceConfig?.includeTags ?? [])];
  const excludeTags = [...(_excludeTags ?? []), ...(workspaceConfig?.excludeTags ?? [])];

  if (includeTags.length === 0 && excludeTags.length === 0) {
    logger.info(`No tags provided, returning all flows.`);
    return flows.map(({ path }) => path);
  }

  logger.info(
    `Filtering flows by tags. Tags to include: ${JSON.stringify(includeTags)}. Tags to exclude: ${JSON.stringify(excludeTags) ?? 'none'}.`
  );
  return flows
    .filter(({ config, path: flowPath }) => {
      const shouldInclude = matchesTags({
        flowTags: config?.tags ?? [],
        includeTags,
        excludeTags,
      });

      logger.info(
        shouldInclude
          ? `- ${path.relative(workingDirectory, flowPath)} matches tags, including.`
          : `- ${path.relative(workingDirectory, flowPath)} does not match tags, excluding.`
      );

      return shouldInclude;
    })
    .map(({ path }) => path);
}

async function findAndParseWorkspaceConfigAsync({
  dirPath,
  workingDirectory,
  logger,
}: {
  dirPath: string;
  workingDirectory: string;
  logger: bunyan;
}): Promise<WorkspaceConfig | null> {
  const configPaths = await fg(['config.yaml', 'config.yml'], {
    cwd: dirPath,
    absolute: true,
  });

  if (configPaths.length === 0) {
    logger.info(`No workspace config found in: ${path.relative(workingDirectory, dirPath)}`);
    return null;
  }

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const configDoc = yaml.parse(content);
      if (!configDoc) {
        logger.warn(
          `No content found in workspace config: ${path.relative(workingDirectory, configPath)}`
        );
        continue;
      }
      logger.info(`Using workspace config from: ${path.relative(workingDirectory, configPath)}`);
      return WorkspaceConfigSchema.parse(configDoc);
    } catch (err) {
      logger.warn(
        { err },
        `Failed to parse workspace config: ${path.relative(workingDirectory, configPath)}`
      );
      continue;
    }
  }

  logger.info(`No valid workspace config found in: ${path.relative(workingDirectory, dirPath)}`);
  return null;
}

async function findAndParseFlowFilesAsync({
  workingDirectory,
  dirPath,
  workspaceConfig,
  logger,
}: {
  workingDirectory: string;
  dirPath: string;
  workspaceConfig: WorkspaceConfig | null;
  logger: bunyan;
}): Promise<{ flows: { config: FlowConfig; path: string }[] }> {
  const flows: { config: FlowConfig; path: string }[] = [];

  // Determine flow patterns from config or use default
  const flowPatterns = workspaceConfig?.flows ?? ['*'];
  logger.info(`Using flow patterns: ${JSON.stringify(flowPatterns)}`);

  // Use fast-glob to find matching files
  const matchedFiles = await fg(flowPatterns, {
    cwd: dirPath,
    absolute: true,
    onlyFiles: true,
    ignore: ['*/config.yaml', '*/config.yml'], // Skip workspace config files
  });

  logger.info(`Found ${matchedFiles.length} potential flow files`);

  // Parse each matched file
  for (const filePath of matchedFiles) {
    // Skip non-YAML files
    const ext = path.extname(filePath);
    if (ext !== '.yaml' && ext !== '.yml') {
      logger.info(`Skipping non-YAML file: ${path.relative(workingDirectory, filePath)}`);
      continue;
    }

    const result = await asyncResult(parseFlowFile(filePath));
    if (result.ok) {
      logger.info(`Found flow file: ${path.relative(workingDirectory, filePath)}`);
      flows.push({ config: result.value, path: filePath });
    } else {
      logger.info(
        { err: result.reason },
        `Skipping flow file: ${path.relative(workingDirectory, filePath)}`
      );
    }
  }

  return { flows };
}

async function parseFlowFile(filePath: string): Promise<FlowConfig> {
  const content = await fs.readFile(filePath, 'utf-8');
  const documents = yaml.parseAllDocuments(content);
  const configDoc = documents[0];
  if (!configDoc) {
    throw new Error(`No config section found in ${filePath}`);
  }
  return FlowConfigSchema.parse(configDoc.toJS());
}

function matchesTags({
  flowTags,
  includeTags,
  excludeTags,
}: {
  flowTags: string[];
  includeTags: string[];
  excludeTags: string[];
}): boolean {
  // Include logic: if includeTags is empty OR flow has any of the include tags
  const includeMatch =
    includeTags.length === 0 || includeTags.some((tag) => flowTags.includes(tag));

  // Exclude logic: if excludeTags is empty OR flow has none of the exclude tags
  const excludeMatch =
    excludeTags.length === 0 || !excludeTags.some((tag) => flowTags.includes(tag));

  return includeMatch && excludeMatch;
}

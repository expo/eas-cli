import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';

export interface FlowMetadata {
  flowName: string;
  flowFilePath: string;
}

export interface MaestroFlowResult {
  name: string;
  path: string;
  status: 'passed' | 'failed';
  errorMessage: string | null;
  duration: number; // milliseconds
  retryCount: number;
  tags: string[];
  properties: Record<string, string>;
}

const TIMESTAMP_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{6}$/;

export function extractFlowKey(filename: string, prefix: string): string | null {
  const match = filename.match(new RegExp(`^${prefix}-(.+)\\.json$`));
  return match?.[1] ?? null;
}

export interface JUnitTestCaseResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number; // milliseconds
  errorMessage: string | null;
  properties: Record<string, string>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Ensure single-element arrays are always arrays
  isArray: name => ['testsuite', 'testcase', 'property'].includes(name),
});

export async function parseJUnitTestCases(junitDirectory: string): Promise<JUnitTestCaseResult[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(junitDirectory);
  } catch {
    return [];
  }

  const xmlFiles = entries.filter(f => f.endsWith('.xml'));
  if (xmlFiles.length === 0) {
    return [];
  }

  const results: JUnitTestCaseResult[] = [];

  for (const xmlFile of xmlFiles) {
    try {
      const content = await fs.readFile(path.join(junitDirectory, xmlFile), 'utf-8');
      const parsed = xmlParser.parse(content);

      const testsuites = parsed?.testsuites?.testsuite;
      if (!Array.isArray(testsuites)) {
        continue;
      }

      for (const suite of testsuites) {
        const testcases = suite?.testcase;
        if (!Array.isArray(testcases)) {
          continue;
        }

        for (const tc of testcases) {
          const name = tc['@_name'];
          if (!name) {
            continue;
          }

          const timeStr = tc['@_time'];
          const timeSeconds = timeStr ? parseFloat(timeStr) : 0;
          const duration = Number.isFinite(timeSeconds) ? Math.round(timeSeconds * 1000) : 0;

          // Use @_status as primary indicator (more robust than checking <failure> presence)
          const status: 'passed' | 'failed' = tc['@_status'] === 'SUCCESS' ? 'passed' : 'failed';
          // Extract error message from <failure> or <error> elements
          const failureText =
            tc.failure != null
              ? typeof tc.failure === 'string'
                ? tc.failure
                : (tc.failure?.['#text'] ?? null)
              : null;
          const errorText =
            tc.error != null
              ? typeof tc.error === 'string'
                ? tc.error
                : (tc.error?.['#text'] ?? null)
              : null;
          const errorMessage: string | null = failureText ?? errorText ?? null;

          // Extract properties
          const rawProperties: { '@_name': string; '@_value': string }[] =
            tc.properties?.property ?? [];
          const properties: Record<string, string> = {};

          for (const prop of rawProperties) {
            const propName = prop['@_name'];
            const value = prop['@_value'];
            if (typeof propName !== 'string' || typeof value !== 'string') {
              continue;
            }
            properties[propName] = value;
          }

          results.push({ name, status, duration, errorMessage, properties });
        }
      }
    } catch {
      // Skip malformed XML files
      continue;
    }
  }

  return results;
}

const FlowMetadataFileSchema = z.object({
  flow_name: z.string(),
  flow_file_path: z.string(),
});

/**
 * Parses an `ai-*.json` file produced by Maestro's TestDebugReporter.
 *
 * The file contains:
 * - `flow_name`: derived from the YAML `config.name` field if present, otherwise
 *   the flow filename without extension.
 *   See: https://github.com/mobile-dev-inc/Maestro/blob/c0e95fd/maestro-cli/src/main/java/maestro/cli/runner/TestRunner.kt#L70
 * - `flow_file_path`: absolute path to the original flow YAML file.
 * - `outputs`: screenshot defect data (unused here).
 *
 * Filename format: `ai-(flowName).json` where `/` in flowName is replaced with `_`.
 * See: https://github.com/mobile-dev-inc/Maestro/blob/c0e95fd/maestro-cli/src/main/java/maestro/cli/report/TestDebugReporter.kt#L67
 */
export async function parseFlowMetadata(filePath: string): Promise<FlowMetadata | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const parsed = FlowMetadataFileSchema.parse(data);
    return {
      flowName: parsed.flow_name,
      flowFilePath: parsed.flow_file_path,
    };
  } catch {
    return null;
  }
}

/**
 * Reads tags from a Maestro flow YAML file's config section.
 * Flow files are structured as: config (object) + `---` + commands (array).
 */
export async function parseFlowTags(flowFilePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(flowFilePath, 'utf-8');
    const docs = YAML.parseAllDocuments(content);
    if (docs.length === 0) {
      return [];
    }
    const metadata = docs[0].toJSON();
    if (metadata && Array.isArray(metadata.tags)) {
      return metadata.tags.filter((t: unknown): t is string => typeof t === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

export async function parseMaestroResults(
  junitDirectory: string,
  testsDirectory: string,
  projectRoot: string
): Promise<MaestroFlowResult[]> {
  // 1. Parse JUnit XML files (primary source)
  const junitResults = await parseJUnitTestCases(junitDirectory);
  if (junitResults.length === 0) {
    return [];
  }

  // 2. Parse ai-*.json from debug output for flow_file_path + retryCount
  const flowPathMap = new Map<string, string>(); // flowName → flowFilePath
  const flowOccurrences = new Map<string, number>(); // flowName → count

  let entries: string[];
  try {
    entries = await fs.readdir(testsDirectory);
  } catch {
    entries = [];
  }

  const timestampDirs = entries.filter(name => TIMESTAMP_DIR_PATTERN.test(name)).sort();

  for (const dir of timestampDirs) {
    const dirPath = path.join(testsDirectory, dir);
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      const flowKey = extractFlowKey(file, 'ai');
      if (!flowKey) {
        continue;
      }

      const metadata = await parseFlowMetadata(path.join(dirPath, file));
      if (!metadata) {
        continue;
      }

      // Track latest path (last timestamp dir wins)
      flowPathMap.set(metadata.flowName, metadata.flowFilePath);

      // Count occurrences for retryCount
      flowOccurrences.set(metadata.flowName, (flowOccurrences.get(metadata.flowName) ?? 0) + 1);
    }
  }

  // 3. Merge: JUnit results + ai-*.json metadata
  const results: MaestroFlowResult[] = [];

  for (const junit of junitResults) {
    const flowFilePath = flowPathMap.get(junit.name);
    const relativePath = flowFilePath
      ? await relativizePathAsync(flowFilePath, projectRoot)
      : junit.name; // fallback: use flow name if ai-*.json not found

    const occurrences = flowOccurrences.get(junit.name) ?? 0;
    const retryCount = Math.max(0, occurrences - 1);
    const tags = flowFilePath ? await parseFlowTags(flowFilePath) : [];

    results.push({
      name: junit.name,
      path: relativePath,
      status: junit.status,
      errorMessage: junit.errorMessage,
      duration: junit.duration,
      retryCount,
      tags,
      properties: junit.properties,
    });
  }

  return results;
}

async function relativizePathAsync(flowFilePath: string, projectRoot: string): Promise<string> {
  if (!path.isAbsolute(flowFilePath)) {
    return flowFilePath;
  }

  // Resolve symlinks (e.g., /tmp -> /private/tmp on macOS) for consistent comparison
  let resolvedRoot = projectRoot;
  let resolvedFlow = flowFilePath;
  try {
    resolvedRoot = await fs.realpath(projectRoot);
  } catch {}
  try {
    resolvedFlow = await fs.realpath(flowFilePath);
  } catch {}

  const relative = path.relative(resolvedRoot, resolvedFlow);
  if (relative.startsWith('..')) {
    return flowFilePath;
  }
  return relative;
}

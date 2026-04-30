import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

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

// Maestro's TestDebugReporter creates timestamped directories, e.g. "2024-06-15_143022"
const TIMESTAMP_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{6}$/;

// Per-attempt JUnit XML files use `*-attempt-N.xml` names; this extracts N.
const ATTEMPT_PATTERN = /attempt-(\d+)/;

export function extractFlowKey(filename: string, prefix: string): string | null {
  const match = filename.match(new RegExp(`^${prefix}-(.+)\\.json$`));
  return match?.[1] ?? null;
}

export interface JUnitTestCaseResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number; // milliseconds
  errorMessage: string | null;
  tags: string[];
  properties: Record<string, string>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Ensure single-element arrays are always arrays
  isArray: name => ['testsuite', 'testcase', 'property'].includes(name),
});

// Internal helper — not exported. Parses a single JUnit XML file.
async function parseJUnitFile(filePath: string): Promise<JUnitTestCaseResult[]> {
  const results: JUnitTestCaseResult[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = xmlParser.parse(content);

    const testsuites = parsed?.testsuites?.testsuite;
    if (!Array.isArray(testsuites)) {
      return results;
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

        const status: 'passed' | 'failed' = tc['@_status'] === 'SUCCESS' ? 'passed' : 'failed';
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

        const tagsValue = properties['tags'];
        const tags: string[] = tagsValue
          ? tagsValue
              .split(',')
              .map(t => t.trim())
              .filter(Boolean)
          : [];
        delete properties['tags'];

        results.push({ name, status, duration, errorMessage, tags, properties });
      }
    }
  } catch {
    // Skip malformed XML files
  }
  return results;
}

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
    results.push(...(await parseJUnitFile(path.join(junitDirectory, xmlFile))));
  }
  return results;
}

const FlowMetadataFileSchema = z.object({
  flow_name: z.string(),
  flow_file_path: z.string(),
});

type FlowMetadata = z.output<typeof FlowMetadataFileSchema>;

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
    return FlowMetadataFileSchema.parse(data);
  } catch {
    return null;
  }
}

export async function parseMaestroResults(
  junitDirectory: string,
  testsDirectory: string,
  projectRoot: string
): Promise<MaestroFlowResult[]> {
  // 1. Parse JUnit XML files, tracking which file each result came from
  let junitEntries: string[];
  try {
    junitEntries = await fs.readdir(junitDirectory);
  } catch {
    return [];
  }
  const xmlFiles = junitEntries.filter(f => f.endsWith('.xml')).sort();
  if (xmlFiles.length === 0) {
    return [];
  }

  interface JUnitResultWithSource {
    result: JUnitTestCaseResult;
    sourceFile: string;
  }

  const junitResultsWithSource: JUnitResultWithSource[] = [];
  for (const xmlFile of xmlFiles) {
    const fileResults = await parseJUnitFile(path.join(junitDirectory, xmlFile));
    for (const result of fileResults) {
      junitResultsWithSource.push({ result, sourceFile: xmlFile });
    }
  }

  if (junitResultsWithSource.length === 0) {
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
      flowPathMap.set(metadata.flow_name, metadata.flow_file_path);

      // Count occurrences for retryCount
      flowOccurrences.set(metadata.flow_name, (flowOccurrences.get(metadata.flow_name) ?? 0) + 1);
    }
  }

  // 3. Merge: JUnit results + ai-*.json metadata
  const results: MaestroFlowResult[] = [];

  // Group results by flow name
  const resultsByName = new Map<string, JUnitResultWithSource[]>();
  for (const entry of junitResultsWithSource) {
    const group = resultsByName.get(entry.result.name) ?? [];
    group.push(entry);
    resultsByName.set(entry.result.name, group);
  }

  for (const [flowName, flowEntries] of resultsByName) {
    const flowFilePath = flowPathMap.get(flowName);
    const relativePath = flowFilePath
      ? await relativizePathAsync(flowFilePath, projectRoot)
      : flowName;

    if (flowEntries.length === 1) {
      // Single result for this flow — use ai-*.json occurrence count for retryCount
      // (backward compat with old-style single JUnit file that gets overwritten)
      const { result } = flowEntries[0];
      const occurrences = flowOccurrences.get(flowName) ?? 0;
      const retryCount = Math.max(0, occurrences - 1);

      results.push({
        name: flowName,
        path: relativePath,
        status: result.status,
        errorMessage: result.errorMessage,
        duration: result.duration,
        retryCount,
        tags: result.tags,
        properties: result.properties,
      });
    } else {
      // Multiple results — per-attempt JUnit files. Sort by attempt index from filename.
      const sorted = flowEntries
        .map(entry => {
          const match = entry.sourceFile.match(ATTEMPT_PATTERN);
          const attemptIndex = match ? parseInt(match[1], 10) : 0;
          return { ...entry, attemptIndex };
        })
        .sort((a, b) => a.attemptIndex - b.attemptIndex);

      for (const { result, attemptIndex } of sorted) {
        results.push({
          name: flowName,
          path: relativePath,
          status: result.status,
          errorMessage: result.errorMessage,
          duration: result.duration,
          retryCount: attemptIndex,
          tags: result.tags,
          properties: result.properties,
        });
      }
    }
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

/**
 * Copies the highest-attempt-index *.xml file from sourceDir to outputPath.
 * After the maestro retry loop completes, this produces a single canonical
 * JUnit report at final_report_path matching the bash step's "cp latest
 * attempt" semantics.
 *
 * Throws if sourceDir contains no *.xml files or if the copy fails.
 */
export async function copyLatestAttemptXml(args: {
  sourceDir: string;
  outputPath: string;
}): Promise<void> {
  const entries = await fs.readdir(args.sourceDir);
  const xmlFiles = entries.filter(f => f.endsWith('.xml')).sort();
  if (xmlFiles.length === 0) {
    throw new Error(`No *.xml files found in ${args.sourceDir}`);
  }

  // Pick the file with the highest attempt index. Files without the marker are
  // treated as attempt 0. Ties are broken by sorted filename — later wins.
  let winner = xmlFiles[0];
  let winnerAttempt = (() => {
    const m = winner.match(ATTEMPT_PATTERN);
    return m ? parseInt(m[1], 10) : 0;
  })();
  for (let i = 1; i < xmlFiles.length; i++) {
    const candidate = xmlFiles[i];
    const match = candidate.match(ATTEMPT_PATTERN);
    const attempt = match ? parseInt(match[1], 10) : 0;
    if (attempt >= winnerAttempt) {
      winner = candidate;
      winnerAttempt = attempt;
    }
  }

  await fs.copyFile(path.join(args.sourceDir, winner), args.outputPath);
}

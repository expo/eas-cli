import path from 'node:path';

import type { LoadedConfig } from '../config/schema.js';
import type { ReviewSource } from '../sources/source.js';
import { prepareAuth } from './auth.js';
import { coordinate } from './coordinator.js';
import { writeRunLog } from './log.js';
import type { RunLogRecord } from './log.js';
import { filterNoise, writePatchWorkspace } from './noise.js';
import { buildOpencodeConfig, promptAndParse, startOpencode } from './opencode.js';
import type { OpencodeHandle } from './opencode.js';
import { buildReviewerSystem, buildReviewerTask } from './prompts.js';
import { parseReviewerOutput } from './schema.js';
import type { CoordinatorOutput, Finding, Severity } from './schema.js';

export interface ReviewRunOptions {
  config: LoadedConfig;
  mode: 'ci' | 'local';
  onProgress?: (message: string) => void;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 };

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * The invariant, mode-agnostic review core: filter → spawn each configured agent
 * → coordinate → apply policy. Returns a CoordinatorOutput; the CLI commands are
 * thin wrappers that supply a Source and render the result.
 */
export async function runReview(
  source: ReviewSource,
  options: ReviewRunOptions
): Promise<CoordinatorOutput> {
  const { config } = options;
  const started = Date.now();
  const runId = makeRunId();
  const progress = options.onProgress ?? (() => {});
  const runsRoot = path.join(config.configDir, '.runs');
  const runDir = path.join(runsRoot, runId);
  const logPath = path.join(runsRoot, 'reviews.jsonl');

  const [metadata, changedFiles] = await Promise.all([
    source.getMetadata(),
    source.getChangedFiles(),
  ]);

  const { kept, filtered } = filterNoise(changedFiles, {
    additionalIgnores: config.noise.additionalIgnores,
    additionalMarkers: config.noise.additionalMarkers,
  });
  progress(
    `${changedFiles.length} changed file(s); ${kept.length} to review, ${filtered.length} filtered.`
  );

  const baseRecord = {
    timestamp: new Date().toISOString(),
    mode: options.mode,
    runId,
    metadata: { baseRef: metadata.baseRef, headRef: metadata.headRef },
    reviewedFiles: kept.map(entry => entry.path),
    filteredFiles: filtered,
  };

  if (kept.length === 0) {
    const output: CoordinatorOutput = {
      decision: 'approve',
      findings: [],
      summary: 'No reviewable changes after noise filtering.',
    };
    await safeLog(logPath, {
      ...baseRecord,
      agentCosts: {},
      totalCost: 0,
      durationMs: Date.now() - started,
      decision: output.decision,
      findingCount: 0,
      summary: output.summary,
    });
    return output;
  }

  const auth = await prepareAuth(config);

  progress('Starting OpenCode server…');
  let handle: OpencodeHandle | null = null;
  try {
    handle = await startOpencode(buildOpencodeConfig(config));
  } catch (error) {
    await auth.cleanup();
    throw new Error(
      `Failed to start the OpenCode server. Ensure the \`opencode\` CLI is installed and ` +
        `model credentials are configured.\n${errorMessage(error)}`
    );
  }

  const agentCosts: Record<string, number> = {};

  try {
    const workspace = await writePatchWorkspace(kept, metadata, runDir);
    const task = buildReviewerTask(workspace);

    progress(`Running ${config.agents.length} reviewer(s): ${config.agents.map(a => a.id).join(', ')}…`);
    const reviewerResults = await Promise.all(
      config.agents.map(async agent => {
        const { value, cost } = await promptAndParse(
          handle!,
          {
            agent: agent.id,
            system: buildReviewerSystem(config, agent),
            text: task,
            title: `review-${agent.id}`,
          },
          parseReviewerOutput
        );
        agentCosts[agent.id] = cost;
        return { id: agent.id, findings: value.findings };
      })
    );

    const agentFindings: Record<string, Finding[]> = {};
    for (const { id, findings } of reviewerResults) {
      agentFindings[id] = findings;
    }

    progress('Coordinating findings…');
    const { output: rawOutput, cost } = await coordinate(handle, config, metadata, agentFindings);
    agentCosts['coordinator'] = cost;
    const output = applyReviewPolicy(rawOutput, config.policy);

    await safeLog(logPath, {
      ...baseRecord,
      agentCosts,
      totalCost: sum(agentCosts),
      durationMs: Date.now() - started,
      decision: output.decision,
      findingCount: output.findings.length,
      summary: output.summary,
    });

    return output;
  } catch (error) {
    await safeLog(logPath, {
      ...baseRecord,
      agentCosts,
      totalCost: sum(agentCosts),
      durationMs: Date.now() - started,
      decision: null,
      findingCount: 0,
      summary: null,
      error: errorMessage(error),
    });
    throw error;
  } finally {
    handle?.close();
    await auth.cleanup();
  }
}

/**
 * Policy backstop: drop suggestions unless opted in, cap by count (most severe
 * first), and downgrade approve_with_comments to approve when nothing remains.
 */
function applyReviewPolicy(
  output: CoordinatorOutput,
  policy: LoadedConfig['policy']
): CoordinatorOutput {
  let findings = policy.includeSuggestions
    ? output.findings
    : output.findings.filter(finding => finding.severity !== 'suggestion');
  findings = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (policy.maxFindings != null) {
    findings = findings.slice(0, policy.maxFindings);
  }
  const decision =
    output.decision === 'approve_with_comments' && findings.length === 0
      ? 'approve'
      : output.decision;
  return { ...output, findings, decision };
}

function sum(costs: Record<string, number>): number {
  return Object.values(costs).reduce((total, value) => total + value, 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeLog(logPath: string, record: RunLogRecord): Promise<void> {
  try {
    await writeRunLog(logPath, record);
  } catch {
    // Logging must never break a review.
  }
}

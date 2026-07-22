import path from 'node:path';

import type { LoadedAgent, LoadedConfig } from '../config/schema.js';
import type { ReviewSource } from '../sources/source.js';
import { prepareAuth } from './auth.js';
import { coordinate } from './coordinator.js';
import { writeRunLog } from './log.js';
import type { RunLogRecord } from './log.js';
import { filterNoise, writePatchWorkspace } from './noise.js';
import type { PatchWorkspaceFile } from './noise.js';
import {
  addTokenUsage,
  AgentTimeoutError,
  buildOpencodeConfig,
  promptAndParse,
  startOpencode,
} from './opencode.js';
import type { OpencodeHandle, TokenUsage } from './opencode.js';
import { routeAgents } from './router.js';
import {
  buildCrossCuttingSystem,
  buildCrossCuttingTask,
  buildReviewerSystem,
  buildReviewerTask,
} from './prompts.js';
import { fingerprintFinding, parseReviewerOutput, SEVERITY_RANK } from './schema.js';
import type { CoordinatorOutput, Finding } from './schema.js';

export interface ReviewRunOptions {
  config: LoadedConfig;
  mode: 'ci' | 'local';
  onProgress?: (message: string) => void;
  /** Run only these agent ids (by filename). Takes precedence over `route`. */
  agents?: string[];
  /** Let the router pick relevant agents from the diff (ignored if `agents` set). */
  route?: boolean;
}


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

  // Fail fast on an invalid explicit selection before doing any work. Routing
  // (if requested) is resolved later, once the server is up.
  const explicitAgents = options.agents?.length
    ? selectAgents(config.agents, options.agents)
    : null;

  const [metadata, changedFiles] = await Promise.all([
    source.getMetadata(),
    source.getChangedFiles(),
  ]);

  const { kept, filtered } = await filterNoise(changedFiles, {
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
      incomplete: [],
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
  const tokenTotals: TokenUsage = {};

  try {
    const workspace = await writePatchWorkspace(kept, metadata, runDir);

    // Resolve which agents run: an explicit list wins; otherwise route (LLM picks
    // relevant agents + always-run) when asked, else all.
    let selectedAgents = explicitAgents ?? config.agents;
    if (!explicitAgents && options.route) {
      progress('Routing: selecting relevant agents…');
      const routed = await routeAgents(handle!, config, workspace.files);
      selectedAgents = routed.agents;
      progress(
        routed.routed
          ? `Router selected: ${selectedAgents.map(a => a.id).join(', ')}`
          : 'Router unavailable; running all agents.'
      );
    }

    // Split the diff into focused chunks so each reviewer call sees a small file
    // set (better recall than one giant blob), and run all agent×chunk calls
    // concurrently up to a cap.
    const chunks = chunkByLines(
      workspace.files,
      config.chunk.maxChangedLines,
      config.chunk.maxFiles
    );
    // Only chunk (and add a cross-cutting pass) when the diff exceeds one chunk.
    const chunked = chunks.length > 1;
    progress(
      `Running ${selectedAgents.length} reviewer(s) [${selectedAgents.map(a => a.id).join(', ')}] over ${chunks.length} chunk(s)` +
        `${chunked ? ' + cross-cutting pass' : ''} ` +
        `(${kept.length} files, concurrency ${config.chunk.concurrency})…`
    );

    const agentFindings: Record<string, Finding[]> = {};
    for (const agent of selectedAgents) {
      agentFindings[agent.id] = [];
      agentCosts[agent.id] = 0;
    }

    interface ReviewTask {
      // Bucket the findings land in (agent id, or "cross-cutting" for the one
      // combined multi-file pass).
      bucket: string;
      system: string;
      label: string;
      title: string;
      text: string;
      // Human label for coverage notes (no internal [i/n]/[cross-file] jargon).
      coverageLabel: string;
      // Per-task time ceiling. The cross-cutting pass legitimately does more work
      // (tracing across every changed file), so it gets more than a focused chunk.
      maxWaitMs: number;
    }
    const CHUNK_TIMEOUT_MS = 8 * 60 * 1000;
    const CROSS_CUTTING_TIMEOUT_MS = 15 * 60 * 1000;
    const tasks: ReviewTask[] = [];
    for (const agent of selectedAgents) {
      const system = buildReviewerSystem(config, agent);
      chunks.forEach((chunk, index) => {
        tasks.push({
          bucket: agent.id,
          system,
          label: chunked ? `${agent.id} [${index + 1}/${chunks.length}]` : agent.id,
          title: `review-${agent.id}-c${index}`,
          text: buildReviewerTask(chunk, workspace.files),
          coverageLabel: `the ${agent.id} review${chunked ? ` (part ${index + 1} of ${chunks.length})` : ''}`,
          maxWaitMs: CHUNK_TIMEOUT_MS,
        });
      });
    }
    // On a large diff, ONE combined pass (not one per agent) looks for issues that
    // span multiple changed files, covering every agent's concern at once.
    if (chunked) {
      tasks.push({
        bucket: 'cross-cutting',
        system: buildCrossCuttingSystem(config, selectedAgents),
        label: 'cross-file',
        title: 'review-xcut',
        text: buildCrossCuttingTask(workspace.files),
        coverageLabel: 'the cross-file review (issues spanning multiple changed files)',
        maxWaitMs: CROSS_CUTTING_TIMEOUT_MS,
      });
    }

    // Longest-processing-time-first: schedule the long cross-cutting/large chunks
    // ahead of short ones so they don't dominate the tail of the makespan.
    tasks.sort((a, b) => b.maxWaitMs - a.maxWaitMs);

    // Coverage notes for passes that hit their time limit or failed, surfaced in
    // the final review so a cut-short run is never presented as complete.
    const incomplete: string[] = [];
    let completedPasses = 0;
    let failedPasses = 0;
    // promptAndParse already retries internally (same-session corrective, then a
    // bounded fresh session). We do NOT wrap it in another retry loop — that
    // compounded into ~9 model runs per task and could blow the job budget. A
    // thrown error here means the task genuinely failed; record it and move on.
    await mapWithConcurrency(tasks, config.chunk.concurrency, async task => {
      const minutes = Math.round(task.maxWaitMs / 60000);
      try {
        const { value, cost, truncated, tokens } = await promptAndParse(
          handle!,
          {
            agent: task.bucket,
            system: task.system,
            text: task.text,
            title: task.title,
            onActivity: line => progress(`  ${task.label}: ${line}`),
            maxWaitMs: task.maxWaitMs,
            finalizeOnTimeout: true,
          },
          parseReviewerOutput
        );
        agentCosts[task.bucket] = (agentCosts[task.bucket] ?? 0) + cost;
        addTokenUsage(tokenTotals, tokens);
        (agentFindings[task.bucket] ??= []).push(...value.findings);
        completedPasses++;
        if (truncated) {
          progress(`  ${task.label}: hit ${minutes}m limit — returned partial findings`);
          incomplete.push(
            `${capitalize(task.coverageLabel)} ran out of time (${minutes}-minute limit); its findings may be incomplete.`
          );
        }
      } catch (error) {
        failedPasses++;
        // A timeout means the agent did not converge even after being asked to
        // wrap up; other errors are genuine failures. Either way, don't retry the
        // whole task — record the coverage gap and continue.
        if (error instanceof AgentTimeoutError) {
          // Still account for the spend of the abandoned investigation.
          agentCosts[task.bucket] = (agentCosts[task.bucket] ?? 0) + error.cost;
          addTokenUsage(tokenTotals, error.tokens);
          progress(`  ${task.label}: exceeded ${minutes}m limit — skipping (no retry)`);
          incomplete.push(
            `${capitalize(task.coverageLabel)} exceeded its ${minutes}-minute limit and did not complete; those changes were not fully reviewed.`
          );
        } else {
          progress(`  ${task.label}: FAILED (${errorMessage(error)})`);
          incomplete.push(
            `${capitalize(task.coverageLabel)} failed to run; those changes were not reviewed.`
          );
        }
      }
    });

    // Also surface files that were filtered out entirely (binary/generated/etc.),
    // so a coverage gap is never silent.
    if (filtered.length > 0) {
      incomplete.push(
        `${filtered.length} file(s) were not reviewed (filtered as binary/generated/ignored).`
      );
    }

    const coverageNotes = [...new Set(incomplete)];

    let output: CoordinatorOutput;
    if (completedPasses === 0) {
      // Nothing succeeded — do NOT let this render as a clean "approve".
      progress('All review passes failed — reporting an incomplete review.');
      output = {
        decision: 'approve_with_comments',
        findings: [],
        summary:
          '⚠️ The AI review could not complete: every review pass failed or timed out, ' +
          'so these changes were effectively NOT reviewed. Treat this as "no review", not "looks good".',
        incomplete: coverageNotes,
      };
    } else {
      progress('Coordinating findings…');
      let consolidated: CoordinatorOutput;
      try {
        const {
          output: rawOutput,
          cost,
          tokens: coordinatorTokens,
        } = await coordinate(handle, config, metadata, agentFindings, coverageNotes);
        agentCosts['coordinator'] = cost;
        addTokenUsage(tokenTotals, coordinatorTokens);
        consolidated = applyReviewPolicy(rawOutput, config.policy);
      } catch (error) {
        // The coordinator is the last step; if it fails we must not throw away all
        // the findings the agents already produced. Fall back to a deterministic
        // merge so a comment is still posted.
        progress(`Coordinator failed (${errorMessage(error)}); consolidating findings locally.`);
        consolidated = fallbackConsolidation(agentFindings, config.policy);
        coverageNotes.push(
          'The consolidation step failed, so findings are shown merged but not de-duplicated or re-judged.'
        );
      }
      // A run with any failed/timed-out pass must never present as a clean approve.
      const decision =
        failedPasses > 0 && consolidated.decision === 'approve'
          ? 'approve_with_comments'
          : consolidated.decision;
      output = { ...consolidated, decision, incomplete: [...new Set(coverageNotes)] };
    }

    await safeLog(logPath, {
      ...baseRecord,
      agentCosts,
      totalCost: sum(agentCosts),
      tokens: tokenTotals,
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
      tokens: tokenTotals,
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

/**
 * Deterministic consolidation used when the coordinator step itself fails, so a
 * coordinator hiccup never discards the findings the agents already produced.
 * Merges + de-dupes (by fingerprint), applies the same policy, and picks a
 * conservative decision (never a clean approve when there are findings).
 */
function fallbackConsolidation(
  agentFindings: Record<string, Finding[]>,
  policy: LoadedConfig['policy']
): CoordinatorOutput {
  const seen = new Set<string>();
  const merged: Finding[] = [];
  for (const findings of Object.values(agentFindings)) {
    for (const finding of findings) {
      const key = fingerprintFinding(finding);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(finding);
      }
    }
  }
  const decision = merged.some(finding => finding.severity === 'critical')
    ? 'request_changes'
    : merged.length > 0
      ? 'approve_with_comments'
      : 'approve';
  return applyReviewPolicy(
    {
      decision,
      findings: merged,
      summary:
        'Consolidation step failed; showing the specialist reviewers’ findings ' +
        'merged and de-duplicated, but not re-judged.',
      incomplete: [],
    },
    policy
  );
}

/** Capitalize the first letter (coverage notes read as sentences). */
function capitalize(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function selectAgents(all: LoadedAgent[], filter?: string[]): LoadedAgent[] {
  if (!filter?.length) {
    return all;
  }
  const known = new Set(all.map(agent => agent.id));
  const unknown = filter.filter(id => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown agent(s): ${unknown.join(', ')}. Available: ${all.map(a => a.id).join(', ')}`
    );
  }
  return all.filter(agent => filter.includes(agent.id));
}


/**
 * Greedily pack files into chunks bounded by total changed lines (primary) and
 * file count (secondary guard). A single file larger than maxChangedLines becomes
 * its own chunk (a file is never split).
 */
function chunkByLines(
  files: PatchWorkspaceFile[],
  maxChangedLines: number,
  maxFiles: number
): PatchWorkspaceFile[][] {
  const chunks: PatchWorkspaceFile[][] = [];
  let current: PatchWorkspaceFile[] = [];
  let lines = 0;
  for (const file of files) {
    const wouldOverflow = lines + file.changedLines > maxChangedLines;
    if (current.length > 0 && (wouldOverflow || current.length >= maxFiles)) {
      chunks.push(current);
      current = [];
      lines = 0;
    }
    current.push(file);
    lines += file.changedLines;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/** Run `fn` over items with at most `limit` in flight at once. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  const count = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
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

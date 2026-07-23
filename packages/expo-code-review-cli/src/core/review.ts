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
  CROSS_CUTTING_AGENT,
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
  NO_TOOLS_INSTRUCTION,
} from './prompts.js';
import { fingerprintFinding, parseReviewerOutput } from './schema.js';
import type { CoordinatorOutput, Finding } from './schema.js';
import { sortFindings } from './render.js';
import { errorMessage, sleep } from './util.js';
import { verifyFindings } from './verify.js';
import { applyInlineIgnores } from './suppress.js';

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
      kind: 'reviewer' | 'cross-cutting';
      system: string;
      label: string;
      title: string;
      // The files this task reviews. Kept (not a prebuilt prompt) so a timed-out
      // task can be SUBDIVIDED into smaller file sets that converge.
      files: PatchWorkspaceFile[];
      // Human label for coverage notes (no internal [i/n]/[cross-file] jargon).
      coverageLabel: string;
      // Per-task time ceiling. The cross-cutting pass legitimately does more work
      // (tracing across every changed file), so it gets more than a focused chunk.
      maxWaitMs: number;
      // Soft tool-call ceiling; hitting it triggers the same soft-landing as the
      // time cap. Bounds an agent that wanders instead of converging.
      maxToolCalls: number;
      // Subdivision depth (0 = an original chunk); a backstop on recursion.
      depth: number;
      // A last-resort no-tools pass over a chunk that wouldn't converge even after
      // being subdivided — reviews the inlined diff only, so it always returns.
      fallback: boolean;
    }
    // These caps must fit inside PASSES_BUDGET_MS (below), which in turn fits inside
    // the CI job's timeout-minutes.
    const CHUNK_TIMEOUT_MS = 15 * 60 * 1000;
    const CROSS_CUTTING_TIMEOUT_MS = 25 * 60 * 1000;
    // A subdivided sub-chunk is smaller, so it gets a shorter cap (halved per level,
    // floored) — enough to converge without letting the recursion balloon.
    const SUBDIVIDE_MIN_TIMEOUT_MS = 6 * 60 * 1000;
    const MAX_SUBDIVIDE_DEPTH = 6;
    // The no-tools fallback reviews an inlined diff with no exploration, so it's fast.
    const FALLBACK_TIMEOUT_MS = 4 * 60 * 1000;
    // Tool-call ceilings — generous for a legitimate pass, low enough to catch
    // runaway roaming (the root cause of the non-convergent timeouts).
    const CHUNK_MAX_TOOL_CALLS = 50;
    const CROSS_CUTTING_MAX_TOOL_CALLS = 120;
    // Global ceiling for ALL passes incl. subdivision/fallback waves, sized to
    // leave room for the coordinator (10m) + verification + overhead inside the CI
    // job timeout. Past this, a timed-out pass is reported as a gap rather than
    // broken down further, so total wall-clock stays bounded.
    const PASSES_BUDGET_MS = 32 * 60 * 1000;
    const passesDeadline = started + PASSES_BUDGET_MS;

    const tasks: ReviewTask[] = [];
    for (const agent of selectedAgents) {
      const system = buildReviewerSystem(config, agent);
      chunks.forEach((chunk, index) => {
        tasks.push({
          bucket: agent.id,
          kind: 'reviewer',
          system,
          label: chunked ? `${agent.id} [${index + 1}/${chunks.length}]` : agent.id,
          title: `review-${agent.id}-c${index}`,
          files: chunk,
          coverageLabel: `the ${agent.id} review${chunked ? ` (part ${index + 1} of ${chunks.length})` : ''}`,
          maxWaitMs: CHUNK_TIMEOUT_MS,
          maxToolCalls: CHUNK_MAX_TOOL_CALLS,
          depth: 0,
          fallback: false,
        });
      });
    }
    // On a large diff, ONE combined pass (not one per agent) looks for issues that
    // span multiple changed files, covering every agent's concern at once.
    if (chunked) {
      tasks.push({
        bucket: CROSS_CUTTING_AGENT,
        kind: 'cross-cutting',
        system: buildCrossCuttingSystem(config, selectedAgents),
        label: 'cross-file',
        title: 'review-xcut',
        files: workspace.files,
        coverageLabel: 'the cross-file review (issues spanning multiple changed files)',
        maxWaitMs: CROSS_CUTTING_TIMEOUT_MS,
        maxToolCalls: CROSS_CUTTING_MAX_TOOL_CALLS,
        depth: 0,
        fallback: false,
      });
    }

    // Longest-processing-time-first: schedule the long cross-cutting/large chunks
    // ahead of short ones so they don't dominate the tail of the makespan.
    tasks.sort((a, b) => b.maxWaitMs - a.maxWaitMs);

    // Build the task prompt on demand (so a subdivided task rebuilds over its
    // smaller file set); a fallback task forbids tools and reviews the inlined diff.
    const buildTaskText = (task: ReviewTask): string => {
      const base =
        task.kind === 'cross-cutting'
          ? buildCrossCuttingTask(task.files, filtered)
          : buildReviewerTask(task.files, workspace.files, filtered);
      return task.fallback ? `${base}\n\n${NO_TOOLS_INSTRUCTION}` : base;
    };
    const filesLabel = (files: PatchWorkspaceFile[]): string =>
      files.length === 1
        ? `\`${files[0]!.path}\``
        : `${files.length} files (e.g. \`${files[0]!.path}\`)`;
    const humanBucket = (bucket: string): string =>
      bucket === CROSS_CUTTING_AGENT ? 'cross-file' : bucket;
    const childTask = (
      parent: ReviewTask,
      files: PatchWorkspaceFile[],
      labelSuffix: string,
      overrides: Partial<ReviewTask>
    ): ReviewTask => ({
      ...parent,
      files,
      label: `${parent.label} ${labelSuffix}`,
      coverageLabel: `the ${humanBucket(parent.bucket)} review of ${filesLabel(files)}`,
      ...overrides,
    });

    // Coverage notes for passes that hit their time limit or failed, surfaced in
    // the final review so a cut-short run is never presented as complete.
    const incomplete: string[] = [];
    let completedPasses = 0;
    let failedPasses = 0;
    // promptAndParse already retries internally (same-session corrective, then a
    // bounded fresh session). We do NOT wrap it in another retry loop. On a genuine
    // TIMEOUT, instead of dropping the work we break it into units that converge:
    // subdivide the chunk, then a fast no-tools pass, and only report a coverage gap
    // when even that can't finish inside the budget — so dropped work is never silent.
    await runGrowableQueue(tasks, config.chunk.concurrency, async (task, enqueue) => {
      const minutes = Math.round(task.maxWaitMs / 60000);
      try {
        const { value, cost, truncated, tokens } = await promptAndParse(
          handle!,
          {
            agent: task.bucket,
            system: task.system,
            text: buildTaskText(task),
            title: task.title,
            onActivity: line => progress(`  ${task.label}: ${line}`),
            maxWaitMs: task.maxWaitMs,
            maxToolCalls: task.maxToolCalls,
            finalizeOnTimeout: true,
          },
          parseReviewerOutput
        );
        agentCosts[task.bucket] = (agentCosts[task.bucket] ?? 0) + cost;
        addTokenUsage(tokenTotals, tokens);
        (agentFindings[task.bucket] ??= []).push(...value.findings);
        completedPasses++;
        if (truncated) {
          progress(`  ${task.label}: hit its budget — returned partial findings`);
          incomplete.push(
            `${capitalize(task.coverageLabel)} ran out of time; its findings may be incomplete.`
          );
        }
        return;
      } catch (error) {
        // Non-timeout errors are genuine failures — record and move on.
        if (!(error instanceof AgentTimeoutError)) {
          failedPasses++;
          progress(`  ${task.label}: FAILED (${errorMessage(error)})`);
          incomplete.push(
            `${capitalize(task.coverageLabel)} failed to run; those changes were not reviewed.`
          );
          return;
        }
        // Account for the abandoned investigation's spend regardless of what's next.
        agentCosts[task.bucket] = (agentCosts[task.bucket] ?? 0) + error.cost;
        addTokenUsage(tokenTotals, error.tokens);

        const remaining = passesDeadline - Date.now();
        // Cross-file analysis needs ≥2 files to be meaningful; a single-file
        // reviewer chunk can't be split further.
        const minFiles = task.kind === 'cross-cutting' ? 2 : 1;
        const childCap = Math.max(SUBDIVIDE_MIN_TIMEOUT_MS, Math.floor(task.maxWaitMs / 2));
        if (task.files.length > minFiles && task.depth < MAX_SUBDIVIDE_DEPTH && remaining > childCap) {
          const mid = Math.ceil(task.files.length / 2);
          const left = task.files.slice(0, mid);
          const right = task.files.slice(mid);
          progress(
            `  ${task.label}: exceeded ${minutes}m — splitting into 2 smaller passes (${left.length} + ${right.length} files)`
          );
          const over: Partial<ReviewTask> = { depth: task.depth + 1, maxWaitMs: childCap };
          enqueue(childTask(task, left, `↳${left.length}f`, over));
          enqueue(childTask(task, right, `↳${right.length}f`, over));
          return;
        }
        // Can't subdivide further: try a fast no-tools pass over the inlined diff
        // (reviewer only — cross-file analysis fundamentally needs to read files).
        if (task.kind === 'reviewer' && !task.fallback && remaining > FALLBACK_TIMEOUT_MS) {
          progress(
            `  ${task.label}: exceeded ${minutes}m — retrying ${filesLabel(task.files)} with a fast no-tools pass`
          );
          enqueue(
            childTask(task, task.files, '(no-tools fallback)', {
              fallback: true,
              maxWaitMs: FALLBACK_TIMEOUT_MS,
              maxToolCalls: 0,
            })
          );
          return;
        }
        // Genuine, reported gap — the only way work is ever left unreviewed, and
        // never silent. Distinguish WHY so the note doesn't overstate what happened:
        // we could still have split/fallen back, but the global budget ran out first,
        // vs. the task was already at its smallest reviewable unit and still failed.
        failedPasses++;
        const couldStillReduce =
          (task.files.length > minFiles && task.depth < MAX_SUBDIVIDE_DEPTH) ||
          (task.kind === 'reviewer' && !task.fallback);
        if (couldStillReduce) {
          progress(
            `  ${task.label}: exceeded ${minutes}m and the run's time budget is spent — reporting a coverage gap`
          );
          incomplete.push(
            `${capitalize(task.coverageLabel)} timed out and the overall review budget was exhausted before it could be broken down further; those changes were not fully reviewed.`
          );
        } else {
          progress(
            `  ${task.label}: exceeded ${minutes}m even at its smallest reviewable unit — reporting a coverage gap`
          );
          incomplete.push(
            `${capitalize(task.coverageLabel)} exceeded its time budget even after being reduced to its smallest reviewable unit; those changes were not fully reviewed.`
          );
        }
      }
    });

    // Note: routine noise filtering (lockfiles, generated, binary) is expected and
    // NOT a coverage gap — it stays in the run log (filteredFiles), not the
    // user-facing coverage note, which is reserved for passes that didn't finish.
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
          truncated: coordinatorTruncated,
        } = await coordinate(handle, config, metadata, agentFindings, coverageNotes);
        agentCosts['coordinator'] = cost;
        addTokenUsage(tokenTotals, coordinatorTokens);
        consolidated = applyReviewPolicy(rawOutput, config.policy);
        if (coordinatorTruncated) {
          // The coordinator ran out of time and returned partial findings — flag it
          // like any other truncated pass so reduced coverage is never silent.
          coverageNotes.push(
            'The consolidation step ran out of time and returned partial findings; some findings may have been dropped or not fully de-duplicated.'
          );
        }
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

    // Guard against hallucinated findings before surfacing: quote-ground every
    // finding against the real file, and adversarially verify criticals. This is
    // what stops a confident but wrong critical from shipping.
    const findingCountBeforeChecks = output.findings.length;
    if (output.findings.length > 0) {
      progress('Verifying findings…');
      const verification = await verifyFindings(handle!, output.findings, process.cwd(), progress);
      agentCosts['verifier'] = verification.cost;
      addTokenUsage(tokenTotals, verification.tokens);
      if (verification.dropped.length > 0) {
        progress(`Verification dropped ${verification.dropped.length} unverified finding(s).`);
        output = {
          ...output,
          findings: verification.kept,
          decision: decisionAfterVerification(output.decision, verification.kept),
        };
      }
    }

    // Inline `expo-code-review-ignore` directives suppress non-critical findings.
    if (output.findings.length > 0) {
      const { kept, suppressed } = await applyInlineIgnores(output.findings, process.cwd(), progress);
      if (suppressed.length > 0) {
        progress(`Suppressed ${suppressed.length} finding(s) via inline directives.`);
        output = {
          ...output,
          findings: kept,
          decision: decisionAfterVerification(output.decision, kept),
        };
      }
    }

    // The coordinator's summary was written against the pre-check finding set, so if
    // verification/suppression removed anything it can now reference issues that are
    // no longer listed. Reconcile the summary so it never contradicts the findings.
    const removedAfterChecks = findingCountBeforeChecks - output.findings.length;
    if (removedAfterChecks > 0) {
      output = { ...output, summary: reconcileSummary(output.summary, output.findings.length) };
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
export function applyReviewPolicy(
  output: CoordinatorOutput,
  policy: LoadedConfig['policy']
): CoordinatorOutput {
  let findings = policy.includeSuggestions
    ? output.findings
    : output.findings.filter(finding => finding.severity !== 'suggestion');
  findings = sortFindings(findings);
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

/**
 * Re-derive the decision after verification dropped findings: nothing left → approve;
 * a `request_changes` with no criticals remaining → soften to approve_with_comments;
 * otherwise keep the coordinator's decision.
 */
export function decisionAfterVerification(
  previous: CoordinatorOutput['decision'],
  kept: Finding[]
): CoordinatorOutput['decision'] {
  if (kept.length === 0) {
    return 'approve';
  }
  if (previous === 'request_changes' && !kept.some(finding => finding.severity === 'critical')) {
    return 'approve_with_comments';
  }
  return previous;
}

/**
 * The coordinator writes its summary before findings are verified/suppressed, so a
 * post-coordination drop can leave the summary referencing issues no longer shown.
 * Reconcile without a second LLM call: if everything was removed, replace it;
 * otherwise prepend a short honest caveat so the prose can't be read as
 * contradicting the (accurate) findings list below it.
 */
export function reconcileSummary(summary: string, remaining: number): string {
  if (remaining === 0) {
    return 'All candidate findings were removed by automated verification and suppression, so no issues remain to report.';
  }
  return (
    '_Note: some findings were removed by automated verification/suppression after ' +
    'this summary was written, so it may mention issues no longer listed below._\n\n' +
    summary
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
export function chunkByLines(
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

const QUEUE_IDLE_POLL_MS = 100;

/**
 * Run tasks with at most `limit` in flight, from a queue that workers may GROW
 * while running: a timed-out chunk enqueues smaller sub-tasks, which free workers
 * then pick up. Workers stay alive until the queue is empty AND no worker is still
 * running (a running worker might yet enqueue more), so dynamically-added work is
 * never lost. `fn` receives the item and an `enqueue` callback.
 */
export async function runGrowableQueue<T>(
  initial: T[],
  limit: number,
  fn: (item: T, enqueue: (next: T) => void) => Promise<void>
): Promise<void> {
  const queue: T[] = [...initial];
  let active = 0;
  const enqueue = (next: T): void => {
    queue.push(next);
  };
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) {
        // Nothing queued: done only once no other worker is still running (which
        // could enqueue more); otherwise wait briefly and re-check.
        if (active === 0) {
          return;
        }
        await sleep(QUEUE_IDLE_POLL_MS);
        continue;
      }
      active++;
      try {
        await fn(item, enqueue);
      } finally {
        active--;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()));
}

function sum(costs: Record<string, number>): number {
  return Object.values(costs).reduce((total, value) => total + value, 0);
}


async function safeLog(logPath: string, record: RunLogRecord): Promise<void> {
  try {
    await writeRunLog(logPath, record);
  } catch {
    // Logging must never break a review.
  }
}

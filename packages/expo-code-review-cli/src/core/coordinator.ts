import type { LoadedConfig } from '../config/schema.js';
import { promptAndParse } from './opencode.js';
import type { OpencodeHandle, TokenUsage } from './opencode.js';
import { buildCoordinatorSystem, buildCoordinatorTask } from './prompts.js';
import { parseCoordinatorOutput } from './schema.js';
import type { CoordinatorOutput, Finding, ReviewMetadata } from './schema.js';

export interface CoordinationResult {
  output: CoordinatorOutput;
  cost: number;
  tokens: TokenUsage;
}

/**
 * Single LLM call that dedupes, re-judges severity, and decides. Structured so it
 * could later own a spawn tool, but for now stays a plain consolidation pass.
 */
export async function coordinate(
  handle: OpencodeHandle,
  config: LoadedConfig,
  metadata: ReviewMetadata,
  agentFindings: Record<string, Finding[]>
): Promise<CoordinationResult> {
  const system = buildCoordinatorSystem(config);
  const text = buildCoordinatorTask(metadata, agentFindings);
  const { value, cost, tokens } = await promptAndParse(
    handle,
    { agent: 'coordinator', system, text, title: 'review-coordinator' },
    parseCoordinatorOutput
  );
  return { output: value, cost, tokens };
}

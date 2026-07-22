import type { LoadedAgent, LoadedConfig } from '../config/schema.js';
import type { PatchWorkspaceFile } from './noise.js';
import { promptAndParse } from './opencode.js';
import type { OpencodeHandle } from './opencode.js';
import { buildRouterSystem, buildRouterTask } from './prompts.js';
import { parseRouteOutput } from './schema.js';

export interface RouteResult {
  agents: LoadedAgent[];
  /** True if the router chose the set; false means we fell back to all agents. */
  routed: boolean;
}

/**
 * Ask the model which agents are relevant to the changed files. Agents marked
 * `alwaysRun` are unioned in regardless. Falls back to ALL agents if the router
 * returns nothing usable or errors — a review must never run with zero agents.
 */
export async function routeAgents(
  handle: OpencodeHandle,
  config: LoadedConfig,
  files: PatchWorkspaceFile[]
): Promise<RouteResult> {
  const always = config.agents.filter(agent => agent.alwaysRun);
  try {
    const { value } = await promptAndParse(
      handle,
      {
        agent: 'coordinator',
        system: buildRouterSystem(),
        text: buildRouterTask(config.agents, files),
        title: 'route',
      },
      parseRouteOutput
    );
    const byId = new Map(config.agents.map(agent => [agent.id, agent]));
    const picked = value.agents
      .map(id => byId.get(id))
      .filter((agent): agent is LoadedAgent => Boolean(agent));

    const chosenIds = new Set([...picked, ...always].map(agent => agent.id));
    // Preserve config order and dedupe.
    const chosen = config.agents.filter(agent => chosenIds.has(agent.id));

    if (chosen.length === 0) {
      return { agents: config.agents, routed: false };
    }
    return { agents: chosen, routed: true };
  } catch {
    return { agents: config.agents, routed: false };
  }
}

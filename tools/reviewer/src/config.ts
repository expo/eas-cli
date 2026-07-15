import { readFile } from 'node:fs/promises';

/**
 * Load the shared opencode.json used identically by CI and local mode. An
 * optional REVIEWER_MODEL env var overrides the model for every agent, so a
 * developer can point the reviewer at whatever provider they have configured
 * without editing the checked-in config.
 */
export async function loadReviewerConfig(): Promise<any> {
  const url = new URL('../opencode.json', import.meta.url);
  const raw = await readFile(url, 'utf8');
  const config = JSON.parse(raw) as { agent?: Record<string, { model?: string }> };

  const override = process.env.REVIEWER_MODEL;
  if (override && config.agent) {
    for (const name of Object.keys(config.agent)) {
      config.agent[name]!.model = override;
    }
  }
  return config;
}

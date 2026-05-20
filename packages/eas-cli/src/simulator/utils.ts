import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { DeviceRunSessionByIdQuery } from '../graphql/generated';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

type ArgentMcpConfigLocation = {
  filePath: string;
  editorLabel: string;
  scope: 'project' | 'global';
};

type ArgentConfigFormat = 'json' | 'jsonc' | 'yaml' | 'toml';

type ArgentMcpConfigCandidate = {
  filePath: string;
  editorLabel: string;
  scope: 'project' | 'global';
  format: ArgentConfigFormat;
  keyPath: readonly string[];
};

// Mirrors the adapter set in @swmansion/argent's installer (packages/argent-
// installer/src/mcp-configs.ts). Update both together if argent adds an
// editor or changes a path / key.
function buildArgentMcpConfigCandidates(): ArgentMcpConfigCandidate[] {
  const cwd = process.cwd();
  const home = os.homedir();
  return [
    // Cursor — JSON, mcpServers.argent
    {
      filePath: path.join(cwd, '.cursor', 'mcp.json'),
      editorLabel: 'Cursor',
      scope: 'project',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    {
      filePath: path.join(home, '.cursor', 'mcp.json'),
      editorLabel: 'Cursor',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    // Claude Code — JSON, mcpServers.argent
    {
      filePath: path.join(cwd, '.mcp.json'),
      editorLabel: 'Claude Code',
      scope: 'project',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    {
      filePath: path.join(home, '.claude.json'),
      editorLabel: 'Claude Code',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    // VS Code — JSON, servers.argent (no global path)
    {
      filePath: path.join(cwd, '.vscode', 'mcp.json'),
      editorLabel: 'VS Code',
      scope: 'project',
      format: 'json',
      keyPath: ['servers', 'argent'],
    },
    // Windsurf — JSON, mcpServers.argent (global only)
    {
      filePath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      editorLabel: 'Windsurf',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    // Zed — JSONC, context_servers.argent
    {
      filePath: path.join(cwd, '.zed', 'settings.json'),
      editorLabel: 'Zed',
      scope: 'project',
      format: 'jsonc',
      keyPath: ['context_servers', 'argent'],
    },
    {
      filePath: path.join(home, '.config', 'zed', 'settings.json'),
      editorLabel: 'Zed',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['context_servers', 'argent'],
    },
    // Gemini — JSON, mcpServers.argent
    {
      filePath: path.join(cwd, '.gemini', 'settings.json'),
      editorLabel: 'Gemini',
      scope: 'project',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    {
      filePath: path.join(home, '.gemini', 'settings.json'),
      editorLabel: 'Gemini',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', 'argent'],
    },
    // Codex — TOML, [mcp_servers.argent]
    {
      filePath: path.join(cwd, '.codex', 'config.toml'),
      editorLabel: 'Codex',
      scope: 'project',
      format: 'toml',
      keyPath: ['mcp_servers', 'argent'],
    },
    {
      filePath: path.join(home, '.codex', 'config.toml'),
      editorLabel: 'Codex',
      scope: 'global',
      format: 'toml',
      keyPath: ['mcp_servers', 'argent'],
    },
    // Hermes — YAML, mcp_servers.argent (global only)
    {
      filePath: path.join(home, '.hermes', 'config.yaml'),
      editorLabel: 'Hermes',
      scope: 'global',
      format: 'yaml',
      keyPath: ['mcp_servers', 'argent'],
    },
    // opencode — JSONC, mcp.argent. Multiple filename candidates per scope —
    // argent's installer picks the first existing one (or defaults to
    // opencode.json). We list them all and dedupe by (editor, scope) below.
    {
      filePath: path.join(cwd, 'opencode.jsonc'),
      editorLabel: 'opencode',
      scope: 'project',
      format: 'jsonc',
      keyPath: ['mcp', 'argent'],
    },
    {
      filePath: path.join(cwd, 'opencode.json'),
      editorLabel: 'opencode',
      scope: 'project',
      format: 'jsonc',
      keyPath: ['mcp', 'argent'],
    },
    {
      filePath: path.join(home, '.config', 'opencode', 'opencode.jsonc'),
      editorLabel: 'opencode',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['mcp', 'argent'],
    },
    {
      filePath: path.join(home, '.config', 'opencode', 'opencode.json'),
      editorLabel: 'opencode',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['mcp', 'argent'],
    },
    {
      filePath: path.join(home, '.config', 'opencode', 'config.json'),
      editorLabel: 'opencode',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['mcp', 'argent'],
    },
  ];
}

function hasKeyPath(parsed: unknown, keyPath: readonly string[]): boolean {
  let cursor: unknown = parsed;
  for (const key of keyPath) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      return false;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor !== undefined;
}

function stripJsonComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function hasArgentInConfig(
  raw: string,
  format: ArgentConfigFormat,
  keyPath: readonly string[]
): boolean {
  switch (format) {
    case 'json':
      return hasKeyPath(JSON.parse(raw), keyPath);
    case 'jsonc': {
      try {
        return hasKeyPath(JSON.parse(raw), keyPath);
      } catch {
        return hasKeyPath(JSON.parse(stripJsonComments(raw)), keyPath);
      }
    }
    case 'yaml':
      return hasKeyPath(YAML.parse(raw), keyPath);
    case 'toml': {
      // Match either `[mcp_servers.argent]` table header or an `argent =`
      // entry under a `[mcp_servers]` section. We don't validate the full
      // TOML; argent's installer writes one of these two shapes.
      if (/^\s*\[mcp_servers\.argent\b/m.test(raw)) {
        return true;
      }
      const sections = raw.split(/^\s*\[/m);
      return sections.some(
        section => /^mcp_servers\s*\]/.test(section) && /^\s*argent\s*=/m.test(section)
      );
    }
  }
}

export type ArgentEditPlan = {
  filePath: string;
  editorLabel: string;
  scope: 'project' | 'global';
  // Path within parsed JSON to the env block (e.g. ['mcpServers', 'argent',
  // 'env'] for most editors, ['servers', 'argent', 'env'] for VS Code).
  envKeyPath: readonly string[];
  // Current value of ARGENT_TOOLS_URL, or null if not yet set. Used by
  // revertArgentEdits to put the file back the way we found it.
  previousValue: string | null;
};

/**
 * Detects writable (JSON-format) argent MCP configs and captures the state
 * needed to apply + later revert an ARGENT_TOOLS_URL edit on each. Skips
 * JSONC / TOML / YAML — those need format-preserving editors we don't ship
 * with eas-cli yet.
 */
export function captureWritableArgentEdits(): ArgentEditPlan[] {
  const found: ArgentEditPlan[] = [];
  const seen = new Set<string>();
  for (const candidate of buildArgentMcpConfigCandidates()) {
    if (candidate.format !== 'json') {
      continue;
    }
    const dedupeKey = `${candidate.editorLabel}:${candidate.scope}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidate.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!hasKeyPath(parsed, candidate.keyPath)) {
        continue;
      }
      const envKeyPath = [...candidate.keyPath, 'env'];
      found.push({
        filePath: candidate.filePath,
        editorLabel: candidate.editorLabel,
        scope: candidate.scope,
        envKeyPath,
        previousValue: readStringAtPath(parsed, [...envKeyPath, 'ARGENT_TOOLS_URL']),
      });
      seen.add(dedupeKey);
    } catch {
      // missing / unreadable / not JSON — skip
    }
  }
  return found;
}

/**
 * Applies the edits. On any failure, rolls back the edits already applied
 * in this batch and re-throws — callers don't have to track partial state.
 */
export function applyArgentEdits(edits: readonly ArgentEditPlan[], toolsUrl: string): void {
  const applied: ArgentEditPlan[] = [];
  try {
    for (const edit of edits) {
      writeArgentToolsUrlValue(edit.filePath, edit.envKeyPath, toolsUrl);
      applied.push(edit);
    }
  } catch (err) {
    revertArgentEdits(applied);
    throw err;
  }
}

/**
 * Reverts the edits to their previous values. Best-effort — failures are
 * logged via the callback (so callers can route them through their logger)
 * and the loop continues so one bad file can't block reverting the others.
 */
export function revertArgentEdits(
  edits: readonly ArgentEditPlan[],
  onError?: (filePath: string, error: unknown) => void
): void {
  for (const edit of edits) {
    try {
      if (edit.previousValue === null) {
        removeArgentToolsUrlValue(edit.filePath, edit.envKeyPath);
      } else {
        writeArgentToolsUrlValue(edit.filePath, edit.envKeyPath, edit.previousValue);
      }
    } catch (err) {
      onError?.(edit.filePath, err);
    }
  }
}

function readStringAtPath(parsed: unknown, keyPath: readonly string[]): string | null {
  let cursor: unknown = parsed;
  for (const key of keyPath) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function writeArgentToolsUrlValue(
  filePath: string,
  envKeyPath: readonly string[],
  value: string
): void {
  const { config, indent, trailingNewline } = readJsonPreservingShape(filePath);
  const envBlock = ensureObjectAtPath(config, envKeyPath);
  envBlock['ARGENT_TOOLS_URL'] = value;
  fs.writeFileSync(filePath, JSON.stringify(config, null, indent) + trailingNewline);
}

function removeArgentToolsUrlValue(filePath: string, envKeyPath: readonly string[]): void {
  const { config, indent, trailingNewline } = readJsonPreservingShape(filePath);
  let cursor: unknown = config;
  for (const key of envKeyPath) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      // Path no longer exists — user must have edited the file. Nothing to revert.
      return;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (cursor && typeof cursor === 'object' && 'ARGENT_TOOLS_URL' in cursor) {
    delete (cursor as Record<string, unknown>).ARGENT_TOOLS_URL;
    fs.writeFileSync(filePath, JSON.stringify(config, null, indent) + trailingNewline);
  }
}

function readJsonPreservingShape(filePath: string): {
  config: Record<string, unknown>;
  indent: number | string;
  trailingNewline: string;
} {
  const raw = fs.readFileSync(filePath, 'utf8');
  return {
    config: JSON.parse(raw) as Record<string, unknown>,
    indent: detectJsonIndent(raw),
    trailingNewline: raw.endsWith('\n') ? '\n' : '',
  };
}

function detectJsonIndent(raw: string): number | string {
  // First indented line after the opening brace is a reliable proxy for the
  // file's indent style. Defaults to 2 spaces if the file is flattened.
  const match = raw.match(/^\s*\{\s*\n([ \t]+)/);
  return match ? match[1] : 2;
}

function ensureObjectAtPath(
  root: Record<string, unknown>,
  keyPath: readonly string[]
): Record<string, unknown> {
  let cursor: Record<string, unknown> = root;
  for (const key of keyPath) {
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  return cursor;
}

function findArgentMcpConfigLocations(): ArgentMcpConfigLocation[] {
  const found: ArgentMcpConfigLocation[] = [];
  const seen = new Set<string>();
  for (const candidate of buildArgentMcpConfigCandidates()) {
    const dedupeKey = `${candidate.editorLabel}:${candidate.scope}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidate.filePath, 'utf8');
      if (hasArgentInConfig(raw, candidate.format, candidate.keyPath)) {
        found.push({
          filePath: candidate.filePath,
          editorLabel: candidate.editorLabel,
          scope: candidate.scope,
        });
        seen.add(dedupeKey);
      }
    } catch {
      // file missing, unreadable, or unparseable — skip
    }
  }
  return found;
}

function formatArgentInstructions(toolsUrl: string, webPreviewUrl?: string | null): string {
  const found = findArgentMcpConfigLocations();
  const lines: string[] = ['🚀 Argent session is live.', ''];

  if (found.length > 0) {
    lines.push('Detected existing argent MCP config:');
    for (const location of found) {
      lines.push(`  • ${location.editorLabel} (${location.scope}): ${location.filePath}`);
    }
    lines.push('', 'Add this env var to the "argent" server\'s "env" block:', '');
    lines.push(`  "ARGENT_TOOLS_URL": "${toolsUrl}"`);
    lines.push(
      '',
      'Then restart your editor (or reload MCP servers — e.g. /mcp → reconnect',
      'in Claude Code) so it re-reads the config.'
    );
  } else {
    lines.push("Didn't find an existing argent MCP config. To wire one up:", '');
    lines.push('  1. (One-time setup) Install argent and register the MCP server:');
    lines.push('       npx -y @swmansion/argent init');
    lines.push('');
    lines.push("  2. Open your editor's MCP config and add this env var to the");
    lines.push('     "argent" server entry:');
    lines.push('');
    lines.push(`       "ARGENT_TOOLS_URL": "${toolsUrl}"`);
    lines.push('');
    lines.push('     Config locations (project / global) used by argent:');
    lines.push('       • Claude Code: <project>/.mcp.json | ~/.claude.json');
    lines.push('       • Cursor:      <project>/.cursor/mcp.json | ~/.cursor/mcp.json');
    lines.push('       • VS Code:     <project>/.vscode/mcp.json');
    lines.push('       • Windsurf:    ~/.codeium/windsurf/mcp_config.json');
    lines.push('       • Zed:         <project>/.zed/settings.json | ~/.config/zed/settings.json');
    lines.push('       • Gemini:      <project>/.gemini/settings.json | ~/.gemini/settings.json');
    lines.push('       • Codex:       <project>/.codex/config.toml | ~/.codex/config.toml');
    lines.push('       • Hermes:      ~/.hermes/config.yaml');
    lines.push('       • opencode:    <project>/opencode.json | ~/.config/opencode/opencode.json');
    lines.push('');
    lines.push('  3. Restart your editor (or reload MCP servers) to pick up the new env.');
  }

  if (webPreviewUrl) {
    lines.push(
      '',
      '🌐 Open the following URL in your browser to preview the simulator:',
      '',
      webPreviewUrl
    );
  }

  return lines.join('\n');
}

export function formatRemoteSessionInstructions(
  remoteConfig: DeviceRunSessionRemoteConfig
): string {
  switch (remoteConfig.__typename) {
    case 'AgentDeviceRunSessionRemoteConfig': {
      const lines = [
        '🔑 Run the following in your shell to attach to the agent-device daemon:',
        '',
        `export AGENT_DEVICE_DAEMON_BASE_URL='${remoteConfig.agentDeviceRemoteSessionUrl}'`,
        `export AGENT_DEVICE_DAEMON_AUTH_TOKEN='${remoteConfig.agentDeviceRemoteSessionToken}'`,
      ];
      if (remoteConfig.webPreviewUrl) {
        lines.push(
          '',
          '🌐 Open the following URL in your browser to preview the simulator:',
          '',
          remoteConfig.webPreviewUrl
        );
      }
      return lines.join('\n');
    }
    case 'ArgentRunSessionRemoteConfig':
      return formatArgentInstructions(remoteConfig.toolsUrl, remoteConfig.webPreviewUrl);
    case 'ServeSimRunSessionRemoteConfig':
      return [
        '🌐 Open the following URL in your browser to access the simulator:',
        '',
        remoteConfig.previewUrl,
      ].join('\n');
  }
}

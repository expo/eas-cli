import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import YAML from 'yaml';

import { DeviceRunSessionByIdQuery } from '../graphql/generated';
import Log from '../log';

type DeviceRunSessionByIdResult = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
export type DeviceRunSessionRemoteConfig = NonNullable<DeviceRunSessionByIdResult['remoteConfig']>;

type ArgentConfigFormat = 'json' | 'jsonc' | 'yaml' | 'toml';

// Single source of truth for argent's MCP server identifier. Used in every
// candidate's keyPath; if argent ever renames the entry, this is the only
// constant that needs updating.
const MCP_SERVER_KEY = 'argent';

type ArgentMcpConfigLocation = {
  filePath: string;
  editorLabel: string;
  scope: 'project' | 'global';
};

type ArgentMcpConfigCandidate = {
  filePath: string;
  editorLabel: string;
  scope: 'project' | 'global';
  format: ArgentConfigFormat;
  // Path within the parsed config to the argent server entry.
  keyPath: readonly string[];
  // Name of the env block on the argent entry. Usually 'env'; opencode uses
  // 'environment'.
  envKeyName: string;
};

// Mirrors the adapter set in @swmansion/argent's installer (packages/argent-
// installer/src/mcp-configs.ts). Update both together if argent adds an
// editor or changes a path / key / format.
function buildArgentMcpConfigCandidates(): ArgentMcpConfigCandidate[] {
  const cwd = process.cwd();
  const home = os.homedir();
  return [
    // Cursor — JSON, mcpServers.argent.env
    {
      filePath: path.join(cwd, '.cursor', 'mcp.json'),
      editorLabel: 'Cursor',
      scope: 'project',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    {
      filePath: path.join(home, '.cursor', 'mcp.json'),
      editorLabel: 'Cursor',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // Claude Code — JSON, mcpServers.argent.env
    {
      filePath: path.join(cwd, '.mcp.json'),
      editorLabel: 'Claude Code',
      scope: 'project',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    {
      filePath: path.join(home, '.claude.json'),
      editorLabel: 'Claude Code',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // VS Code — JSON, servers.argent.env (no global path)
    {
      filePath: path.join(cwd, '.vscode', 'mcp.json'),
      editorLabel: 'VS Code',
      scope: 'project',
      format: 'json',
      keyPath: ['servers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // Windsurf — JSON, mcpServers.argent.env (global only)
    {
      filePath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      editorLabel: 'Windsurf',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // Zed — JSONC, context_servers.argent.env
    {
      filePath: path.join(cwd, '.zed', 'settings.json'),
      editorLabel: 'Zed',
      scope: 'project',
      format: 'jsonc',
      keyPath: ['context_servers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    {
      filePath: path.join(home, '.config', 'zed', 'settings.json'),
      editorLabel: 'Zed',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['context_servers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // Gemini — JSON, mcpServers.argent.env
    {
      filePath: path.join(cwd, '.gemini', 'settings.json'),
      editorLabel: 'Gemini',
      scope: 'project',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    {
      filePath: path.join(home, '.gemini', 'settings.json'),
      editorLabel: 'Gemini',
      scope: 'global',
      format: 'json',
      keyPath: ['mcpServers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // Codex — TOML, mcp_servers.argent.env. NOTE: smol-toml round-trips drop
    // user comments and reorder keys — argent's installer has the same
    // limitation, so we accept it.
    {
      filePath: path.join(cwd, '.codex', 'config.toml'),
      editorLabel: 'Codex',
      scope: 'project',
      format: 'toml',
      keyPath: ['mcp_servers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    {
      filePath: path.join(home, '.codex', 'config.toml'),
      editorLabel: 'Codex',
      scope: 'global',
      format: 'toml',
      keyPath: ['mcp_servers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // Hermes — YAML, mcp_servers.argent.env (global only). Document API
    // preserves comments + formatting.
    {
      filePath: path.join(home, '.hermes', 'config.yaml'),
      editorLabel: 'Hermes',
      scope: 'global',
      format: 'yaml',
      keyPath: ['mcp_servers', MCP_SERVER_KEY],
      envKeyName: 'env',
    },
    // opencode — JSONC, mcp.argent.environment (note: 'environment', not
    // 'env'). Multiple filename candidates per scope; argent's installer
    // picks the first existing one. We list them all and dedupe by
    // (editor, scope) at the call site.
    {
      filePath: path.join(cwd, 'opencode.jsonc'),
      editorLabel: 'opencode',
      scope: 'project',
      format: 'jsonc',
      keyPath: ['mcp', MCP_SERVER_KEY],
      envKeyName: 'environment',
    },
    {
      filePath: path.join(cwd, 'opencode.json'),
      editorLabel: 'opencode',
      scope: 'project',
      format: 'jsonc',
      keyPath: ['mcp', MCP_SERVER_KEY],
      envKeyName: 'environment',
    },
    {
      filePath: path.join(home, '.config', 'opencode', 'opencode.jsonc'),
      editorLabel: 'opencode',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['mcp', MCP_SERVER_KEY],
      envKeyName: 'environment',
    },
    {
      filePath: path.join(home, '.config', 'opencode', 'opencode.json'),
      editorLabel: 'opencode',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['mcp', MCP_SERVER_KEY],
      envKeyName: 'environment',
    },
    {
      filePath: path.join(home, '.config', 'opencode', 'config.json'),
      editorLabel: 'opencode',
      scope: 'global',
      format: 'jsonc',
      keyPath: ['mcp', MCP_SERVER_KEY],
      envKeyName: 'environment',
    },
  ];
}

// ── Format drivers ────────────────────────────────────────────────────────────
// Each driver knows how to inspect / read / write / delete a value at a key
// path inside one config format. JSON, JSONC, and YAML round-trips preserve
// user formatting + comments; TOML round-trips do not (smol-toml is a
// value-preserving but not text-preserving parser, matching argent's own
// installer behavior).

type FormatDriver = {
  hasKeyPath(raw: string, keyPath: readonly string[]): boolean;
  readString(raw: string, keyPath: readonly string[]): string | null;
  writeString(raw: string, keyPath: readonly string[], value: string): string;
  removeKey(raw: string, keyPath: readonly string[]): string;
};

const JSON_DRIVER: FormatDriver = {
  hasKeyPath: (raw, keyPath) => hasNestedKey(JSON.parse(raw), keyPath),
  readString: (raw, keyPath) => readNestedString(JSON.parse(raw), keyPath),
  writeString: (raw, keyPath, value) => {
    const config = JSON.parse(raw) as Record<string, unknown>;
    setNestedValue(config, keyPath, value);
    return serializeJsonPreservingShape(raw, config);
  },
  removeKey: (raw, keyPath) => {
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (!deleteNested(config, keyPath)) {
      return raw;
    }
    return serializeJsonPreservingShape(raw, config);
  },
};

const JSONC_DRIVER: FormatDriver = {
  hasKeyPath: (raw, keyPath) => hasNestedKey(parseJsonc(raw), keyPath),
  readString: (raw, keyPath) => readNestedString(parseJsonc(raw), keyPath),
  writeString: (raw, keyPath, value) => {
    const edits = modify(raw, [...keyPath], value, {
      formattingOptions: jsonFormattingOptions(raw),
    });
    return applyEdits(raw, edits);
  },
  removeKey: (raw, keyPath) => {
    const edits = modify(raw, [...keyPath], undefined, {
      formattingOptions: jsonFormattingOptions(raw),
    });
    return applyEdits(raw, edits);
  },
};

const YAML_DRIVER: FormatDriver = {
  hasKeyPath: (raw, keyPath) => YAML.parseDocument(raw).hasIn([...keyPath]),
  readString: (raw, keyPath) => {
    const value = YAML.parseDocument(raw).getIn([...keyPath]);
    return typeof value === 'string' ? value : null;
  },
  writeString: (raw, keyPath, value) => {
    const doc = YAML.parseDocument(raw);
    doc.setIn([...keyPath], value);
    return doc.toString();
  },
  removeKey: (raw, keyPath) => {
    const doc = YAML.parseDocument(raw);
    doc.deleteIn([...keyPath]);
    return doc.toString();
  },
};

const TOML_DRIVER: FormatDriver = {
  hasKeyPath: (raw, keyPath) => hasNestedKey(parseToml(raw), keyPath),
  readString: (raw, keyPath) => readNestedString(parseToml(raw), keyPath),
  writeString: (raw, keyPath, value) => {
    const config = parseToml(raw) as Record<string, unknown>;
    setNestedValue(config, keyPath, value);
    return stringifyToml(config);
  },
  removeKey: (raw, keyPath) => {
    const config = parseToml(raw) as Record<string, unknown>;
    if (!deleteNested(config, keyPath)) {
      return raw;
    }
    return stringifyToml(config);
  },
};

function driverFor(format: ArgentConfigFormat): FormatDriver {
  switch (format) {
    case 'json':
      return JSON_DRIVER;
    case 'jsonc':
      return JSONC_DRIVER;
    case 'yaml':
      return YAML_DRIVER;
    case 'toml':
      return TOML_DRIVER;
  }
}

// ── Nested-object helpers (used by JSON + TOML drivers) ───────────────────────

function hasNestedKey(parsed: unknown, keyPath: readonly string[]): boolean {
  let cursor: unknown = parsed;
  for (const key of keyPath) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      return false;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor !== undefined;
}

function readNestedString(parsed: unknown, keyPath: readonly string[]): string | null {
  let cursor: unknown = parsed;
  for (const key of keyPath) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function setNestedValue(
  root: Record<string, unknown>,
  keyPath: readonly string[],
  value: string
): void {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keyPath[keyPath.length - 1]] = value;
}

function deleteNested(root: unknown, keyPath: readonly string[]): boolean {
  let cursor: unknown = root;
  for (let i = 0; i < keyPath.length - 1; i++) {
    if (!cursor || typeof cursor !== 'object' || !(keyPath[i] in cursor)) {
      return false;
    }
    cursor = (cursor as Record<string, unknown>)[keyPath[i]];
  }
  if (!cursor || typeof cursor !== 'object') {
    return false;
  }
  const lastKey = keyPath[keyPath.length - 1];
  if (!(lastKey in cursor)) {
    return false;
  }
  delete (cursor as Record<string, unknown>)[lastKey];
  return true;
}

function serializeJsonPreservingShape(raw: string, config: Record<string, unknown>): string {
  const indent = detectJsonIndent(raw);
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  return JSON.stringify(config, null, indent) + trailingNewline;
}

function detectJsonIndent(raw: string): number | string {
  // First indented line in the file is a reliable proxy for indent style.
  // Defaults to 2 spaces if nothing matches.
  for (const line of raw.split('\n')) {
    const match = line.match(/^([ \t]+)\S/);
    if (match) {
      return match[1];
    }
  }
  return 2;
}

function jsonFormattingOptions(raw: string): { tabSize: number; insertSpaces: boolean } {
  const indent = detectJsonIndent(raw);
  if (typeof indent === 'string') {
    const usesTabs = indent.startsWith('\t');
    return { tabSize: usesTabs ? 1 : indent.length, insertSpaces: !usesTabs };
  }
  return { tabSize: indent, insertSpaces: true };
}

// ── Public API: detection, capture, apply, revert ─────────────────────────────

export type ArgentEditPlan = {
  filePath: string;
  editorLabel: string;
  scope: 'project' | 'global';
  format: ArgentConfigFormat;
  // Full path from the parsed root to the ARGENT_TOOLS_URL key, e.g.
  // ['mcpServers', 'argent', 'env', 'ARGENT_TOOLS_URL'].
  toolsUrlKeyPath: readonly string[];
  previousValue: string | null;
};

/**
 * Detects every writable argent MCP config across all supported formats
 * (JSON, JSONC, YAML, TOML) and captures the state needed to apply + later
 * revert an ARGENT_TOOLS_URL edit on each.
 */
export function captureWritableArgentEdits(): ArgentEditPlan[] {
  const found: ArgentEditPlan[] = [];
  const seen = new Set<string>();
  for (const candidate of buildArgentMcpConfigCandidates()) {
    const dedupeKey = `${candidate.editorLabel}:${candidate.scope}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidate.filePath, 'utf8');
      const driver = driverFor(candidate.format);
      if (!driver.hasKeyPath(raw, candidate.keyPath)) {
        continue;
      }
      const toolsUrlKeyPath = [...candidate.keyPath, candidate.envKeyName, 'ARGENT_TOOLS_URL'];
      found.push({
        filePath: candidate.filePath,
        editorLabel: candidate.editorLabel,
        scope: candidate.scope,
        format: candidate.format,
        toolsUrlKeyPath,
        previousValue: driver.readString(raw, toolsUrlKeyPath),
      });
      seen.add(dedupeKey);
    } catch (err) {
      // ENOENT is the common case (we probe ~17 paths most of which won't
      // exist on any given system) — skip silently. Anything else means the
      // file is real but unreadable/unparseable, which the user likely wants
      // to know about so they can debug why detection didn't fire.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        Log.warn(
          `Skipped ${candidate.filePath} (${candidate.editorLabel}, ${candidate.scope}) while looking for argent MCP configs: ${err instanceof Error ? err.message : String(err)}`
        );
      }
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
      writeAtPath(edit.filePath, edit.format, edit.toolsUrlKeyPath, toolsUrl);
      applied.push(edit);
    }
  } catch (err) {
    revertArgentEdits(applied);
    throw err;
  }
}

/**
 * Reverts the edits to their previous values. Best-effort — failures are
 * surfaced via the optional callback and the loop continues so one bad file
 * can't block reverting the others.
 */
export function revertArgentEdits(
  edits: readonly ArgentEditPlan[],
  onError?: (filePath: string, error: unknown) => void
): void {
  for (const edit of edits) {
    try {
      if (edit.previousValue === null) {
        removeAtPath(edit.filePath, edit.format, edit.toolsUrlKeyPath);
      } else {
        writeAtPath(edit.filePath, edit.format, edit.toolsUrlKeyPath, edit.previousValue);
      }
    } catch (err) {
      onError?.(edit.filePath, err);
    }
  }
}

function writeAtPath(
  filePath: string,
  format: ArgentConfigFormat,
  keyPath: readonly string[],
  value: string
): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, driverFor(format).writeString(raw, keyPath, value));
}

function removeAtPath(
  filePath: string,
  format: ArgentConfigFormat,
  keyPath: readonly string[]
): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const next = driverFor(format).removeKey(raw, keyPath);
  if (next !== raw) {
    fs.writeFileSync(filePath, next);
  }
}

// ── Internal: detection used by the instruction-printing fallback ─────────────
// captureWritableArgentEdits is the superset (same iteration, same detection,
// plus the previousValue + format + toolsUrlKeyPath fields); the
// instruction-printing path just doesn't care about the extra fields.

function findArgentMcpConfigLocations(): ArgentMcpConfigLocation[] {
  return captureWritableArgentEdits().map(edit => ({
    filePath: edit.filePath,
    editorLabel: edit.editorLabel,
    scope: edit.scope,
  }));
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

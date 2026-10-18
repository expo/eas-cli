import { execFile } from 'node:child_process';
import { mkdtemp, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const INTERVAL_MS = 1_000;
const MAX_BYTES = 128 * 1024 * 1024;

type ProcessSample = {
  pid: number;
  ppid: number;
  started: string;
  cpuSeconds: number;
  rssBytes: number;
  executable: string;
};

// RSS includes shared pages. Never sum it as physical guest memory usage.
export function parseGuestProcesses(output: string): ProcessSample[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const match =
        /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+([\d:.\-]+)\s+(\d+)\s+(.+)$/.exec(
          line
        );
      if (!match) {
        throw new Error('Unrecognized ps row');
      }
      const [, pid, ppid, started, cpu, rss, executable] = match;
      const [days, clock] = cpu.includes('-') ? cpu.split('-') : ['0', cpu];
      const seconds = clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        started,
        cpuSeconds: Number(days) * 86400 + seconds,
        rssBytes: Number(rss) * 1024,
        executable,
      };
    });
}

function cpuTotals(): { busy: number; total: number } {
  return os.cpus().reduce(
    (sum, { times }) => ({
      busy: sum.busy + times.user + times.nice + times.sys + times.irq,
      total: sum.total + times.user + times.nice + times.sys + times.irq + times.idle,
    }),
    { busy: 0, total: 0 }
  );
}

async function command(
  file: string,
  args: string[]
): Promise<{ output?: string; error?: string; completedMonotonicMs: number }> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      timeout: 2_000,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    });
    return { output: stdout, completedMonotonicMs: performance.now() };
  } catch (error) {
    // Do not serialize commands, environment, or stderr into telemetry errors.
    const details = error as { name?: string; code?: string | number; signal?: string };
    return {
      error: `${details.name ?? 'CommandError'}:${details.code ?? details.signal ?? 'unknown'}`,
      completedMonotonicMs: performance.now(),
    };
  }
}

export class GuestMetricsRecorder {
  private readonly abort = new AbortController();
  private readonly done: Promise<void>;
  private error: unknown;

  private constructor(public readonly filePath: string) {
    this.done = this.recordAsync().catch(error => {
      this.error = error;
    });
  }

  static async startAsync(): Promise<GuestMetricsRecorder | undefined> {
    if (process.platform !== 'darwin') {
      return undefined;
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), 'guest-metrics-'));
    return new GuestMetricsRecorder(path.join(directory, 'guest-metrics.ndjson'));
  }

  async finishAsync(): Promise<string> {
    this.abort.abort();
    await this.done;
    if (this.error) {
      throw this.error;
    }
    return this.filePath;
  }

  private async recordAsync(): Promise<void> {
    const file = await open(this.filePath, 'wx', 0o600);
    let bytes = 0;
    const write = async (record: object): Promise<void> => {
      const line =
        JSON.stringify({
          time: new Date().toISOString(),
          monotonicMs: performance.now(),
          ...record,
        }) + '\n';
      await file.write(line);
      bytes += Buffer.byteLength(line);
    };
    let count = 0;
    let failures = 0;
    let previousCpu = cpuTotals();
    let previousProcesses = new Map<string, ProcessSample>();
    let previousProcessTime: number | undefined;
    let maxSampleGapMs = 0;
    let previousStart: number | undefined;
    let reason = 'stopped';
    try {
      await write({
        type: 'meta',
        schemaVersion: 1,
        intervalMs: INTERVAL_MS,
        cores: os.cpus().length,
        memoryBytes: os.totalmem(),
        bootTimeApprox: new Date(Date.now() - os.uptime() * 1000).toISOString(),
        release: os.release(),
        arch: os.arch(),
        model: os.cpus()[0]?.model,
        pid: process.pid,
        jobId: process.env.EAS_BUILD_ID,
        workflowJobId: process.env.EAS_WORKFLOW_JOB_ID,
        limitations: [
          'Guest metrics only; physical host GPU and video engine utilization unavailable.',
          'Process CPU excludes tasks that exit between polls; residual is not attributable.',
          'RSS includes shared pages; GPU allocations share system RAM.',
          'Process and aggregate counters have different sampling boundaries.',
        ],
      });
      while (!this.abort.signal.aborted && bytes < MAX_BYTES) {
        const start = performance.now();
        if (previousStart !== undefined) {
          maxSampleGapMs = Math.max(maxSampleGapMs, start - previousStart);
        }
        previousStart = start;
        const cpu = cpuTotals();
        const totalDelta = cpu.total - previousCpu.total;
        const busyCores =
          totalDelta > 0 ? ((cpu.busy - previousCpu.busy) / totalDelta) * os.cpus().length : null;
        previousCpu = cpu;
        const [ps, vm, swap, pressure, gpu] = await Promise.all([
          command('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,time=,rss=,comm=']),
          command('/usr/bin/vm_stat', []),
          command('/usr/sbin/sysctl', ['vm.swapusage']),
          command('/usr/bin/memory_pressure', ['-Q']),
          count % 5 === 0
            ? command('/usr/sbin/ioreg', ['-a', '-l', '-r', '-c', 'IOAccelerator'])
            : Promise.resolve(undefined),
        ]);
        // Use this probe's completion, not a slower sibling probe's completion.
        const processTime = ps.completedMonotonicMs;
        const errors: Record<string, string> = {};
        let processes: (ProcessSample & { cpuCores: number | null })[] = [];
        let exited: string[] = [];
        try {
          if (!ps.output) {
            throw new Error('Process sample unavailable');
          }
          const parsed = parseGuestProcesses(ps.output);
          const current = new Map(parsed.map(p => [`${p.pid}:${p.started}`, p]));
          processes = parsed.map(p => {
            const prior = previousProcesses.get(`${p.pid}:${p.started}`);
            return {
              ...p,
              cpuCores:
                prior && previousProcessTime !== undefined
                  ? Math.max(0, p.cpuSeconds - prior.cpuSeconds) /
                    ((processTime - previousProcessTime) / 1000)
                  : null,
            };
          });
          exited = [...previousProcesses.keys()].filter(key => !current.has(key));
          previousProcesses = current;
          previousProcessTime = processTime;
        } catch {
          errors.processes = ps.error ?? 'ParseError';
          previousProcesses.clear();
          previousProcessTime = undefined;
        }
        for (const [key, result] of Object.entries({ vm, swap, pressure, gpu })) {
          if (result?.error) {
            errors[key] = result.error;
          }
        }
        if (Object.keys(errors).length) {
          failures++;
        }
        const attributedCores = processes.reduce((sum, p) => sum + (p.cpuCores ?? 0), 0);
        await write({
          type: 'sample',
          sequence: count++,
          elapsedMs: performance.now() - start,
          cpuSampleMonotonicMs: start,
          processSampleMonotonicMs: processTime,
          uptimeSeconds: os.uptime(),
          freeBytes: os.freemem(),
          busyCores: count > 1 ? busyCores : null,
          attributedCores,
          residualCores: count > 1 && busyCores !== null ? busyCores - attributedCores : null,
          processes,
          exited,
          vm: vm.output,
          swap: swap.output,
          pressure: pressure.output,
          gpu: gpu?.output,
          errors,
        });
        await delay(Math.max(0, INTERVAL_MS - (performance.now() - start)), undefined, {
          signal: this.abort.signal,
        }).catch(() => {});
      }
      if (bytes >= MAX_BYTES) {
        reason = 'size-limit';
      }
    } catch (error) {
      reason = 'collector-error';
      await write({ type: 'error', error: error instanceof Error ? error.name : 'Error' });
    } finally {
      try {
        await write({
          type: 'end',
          reason,
          samples: count,
          samplesWithErrors: failures,
          maxSampleGapMs,
        });
      } finally {
        await file.close();
      }
    }
  }
}

let active: GuestMetricsRecorder | undefined;

export async function startGuestMetricsAsync(): Promise<void> {
  active ??= await GuestMetricsRecorder.startAsync();
}

export async function finishGuestMetricsAsync(): Promise<string | undefined> {
  const recorder = active;
  active = undefined;
  return await recorder?.finishAsync();
}

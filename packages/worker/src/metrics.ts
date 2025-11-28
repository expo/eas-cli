import osu from 'node-os-utils';
import checkDiscSpace from 'check-disk-space';

import sentry from './sentry';
import logger from './logger';

interface RamMetrics {
  avaliableGb: number;
  usedGb: number;
  usagePercentage: number;
}

interface CpuMetrics {
  usagePercentage: number;
}

interface DiscMetrics {
  avaliableGb: number;
  usedGb: number;
  usagePercentage: number;
}

function megabytesToGigabytes(bytes: number): number {
  return bytes / 1024;
}

function bytesToGigabytes(bytes: number): number {
  return bytes / 1024 / 1024 / 1024;
}

function handleError(err: any, message: string): void {
  logger.error(message, { err });
  sentry.handleError(message, err);
}

async function getRamMetricsGb(): Promise<RamMetrics | null> {
  try {
    const { usedMemMb, freeMemMb, usedMemPercentage } = await osu.mem.info();
    return {
      avaliableGb: megabytesToGigabytes(Number(freeMemMb)),
      usedGb: megabytesToGigabytes(Number(usedMemMb)),
      usagePercentage: Number(usedMemPercentage),
    };
  } catch (err: any) {
    handleError(err, 'Failed to get worker VM RAM metrics');
    return null;
  }
}

async function getCpuUsagePercent(): Promise<CpuMetrics | null> {
  try {
    return {
      usagePercentage: await osu.cpu.usage(),
    };
  } catch (err: any) {
    handleError(err, 'Failed to get worker VM CPU metrics');
    return null;
  }
}

async function getDiscUsageGb(): Promise<DiscMetrics | null> {
  try {
    const { free, size } = await checkDiscSpace('/');
    return {
      avaliableGb: bytesToGigabytes(free),
      usedGb: bytesToGigabytes(size - free),
      usagePercentage: (size - free) / size,
    };
  } catch (err: any) {
    handleError(err, 'Failed to get worker VM disc metrics');
    return null;
  }
}

export async function getWorkerVmMetrics(): Promise<{
  ram: RamMetrics | null;
  cpu: CpuMetrics | null;
  disc: DiscMetrics | null;
}> {
  const [ram, cpu, disc] = await Promise.all([
    getRamMetricsGb(),
    getCpuUsagePercent(),
    getDiscUsageGb(),
  ]);
  logger.info('Worker VM metrics', { ram, cpu, disc });
  return {
    ram,
    cpu,
    disc,
  };
}

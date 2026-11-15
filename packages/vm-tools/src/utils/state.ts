import os from 'node:os';
import path from 'node:path';

export function getVmStateDirectory(): string {
  return path.join(os.homedir(), '.expo/vm-tools');
}

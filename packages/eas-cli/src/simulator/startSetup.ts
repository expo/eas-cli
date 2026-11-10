import {
  ControlConfigProgress,
  ControlConfigResult,
  executeControlConfigAsync,
  prepareControlConfigAsync,
} from './controlConfig';
import { connectHostActionsAsync, fetchHostActionCatalogAsync } from './hostActions';
import { SimulatorSessionConfig } from './sessionConfig';
import { PreviewApiAccess } from './utils';

export async function applyStartConfigAsync(
  access: PreviewApiAccess,
  config: SimulatorSessionConfig,
  {
    signal,
    onProgress,
  }: { signal: AbortSignal; onProgress?: (progress: ControlConfigProgress) => void }
): Promise<ControlConfigResult[]> {
  const connection = await connectHostActionsAsync(access, { signal });
  try {
    const catalog = await fetchHostActionCatalogAsync(connection);
    const prepared = await prepareControlConfigAsync(catalog, config.path, connection.udid, config);
    signal.throwIfAborted();
    return await executeControlConfigAsync(connection, prepared, { onProgress });
  } finally {
    connection.close();
  }
}

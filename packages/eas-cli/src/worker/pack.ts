import { Gzip } from 'minizlib';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pack } from 'tar-stream';

import { formatSourcemap } from './sourcemaps';

export const createTarOfFolderAsync = async (
  targetFolder: string,
  manifest: Record<string, unknown>
): Promise<Buffer> => {
  const tar = pack();
  const gzip = new Gzip({});

  tar.entry({ name: 'manifest.json', type: 'file' }, JSON.stringify(manifest));

  async function appendDirectoryAsync(root = ''): Promise<void> {
    const target = path.resolve(targetFolder, root);
    const list = await fs.readdir(target, { withFileTypes: true });
    for (const entry of list) {
      const name = root ? `${root}/${entry.name}` : entry.name;
      if (entry.isFile()) {
        let data: Buffer | string = await fs.readFile(path.join(target, entry.name));
        if (name.endsWith('.map')) {
          data = formatSourcemap(name, data);
        }
        tar.entry({ name, type: 'file' }, data);
      } else if (entry.isDirectory()) {
        await appendDirectoryAsync(name);
      }
    }
  }

  await appendDirectoryAsync();
  tar.finalize();

  const parts: Buffer[] = [];
  for await (const part of tar.pipe(gzip)) {
    parts.push(part);
  }
  return Buffer.concat(parts);
};

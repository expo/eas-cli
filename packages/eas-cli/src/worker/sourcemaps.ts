import path from 'node:path';

const cwd = process.cwd();

export const formatSourcemap = (projectRoot: string, data: Buffer): string | Buffer => {
  try {
    const map = JSON.parse(data.toString('utf8'));

    let sources = map.sources || [];
    if (Array.isArray(sources)) {
      sources = sources.map(source => {
        if (typeof source !== 'string' || !source.startsWith(cwd)) {
          return source;
        } else {
          const relative = path.relative(projectRoot, source);
          return relative.split(path.sep).join('/');
        }
      });
    }

    return JSON.stringify({
      version: map.version,
      sources,
      sourcesContent:
        typeof map.sources.length === 'number' ? new Array(map.sources.length).fill(null) : null,
      names: map.names,
      mappings: map.mappings,
    });
  } catch {
    return data;
  }
};

import fs from 'node:fs';

const CRLF = '\r\n';
const BOUNDARY_HYPHEN_CHARS = '--';
const BOUNDARY_ID = '----formdata-eas-cli';
const FORM_FOOTER = `${BOUNDARY_HYPHEN_CHARS}${BOUNDARY_ID}${BOUNDARY_HYPHEN_CHARS}${CRLF}${CRLF}`;

const encodeName = (input: string): string => {
  return input.replace(/["\n\\]/g, (c: string) => {
    switch (c) {
      case '\\':
        return '\\\\';
      case '"':
        return '%22';
      case '\n':
        return '%0A';
      default:
        return `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
    }
  });
};

async function* createReadStreamAsync(filePath: string): AsyncGenerator<Uint8Array> {
  for await (const raw of fs.createReadStream(filePath)) {
    const chunk = raw as Buffer;
    yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
}

const makeFormHeader = (params: {
  name: string;
  contentType: string;
  contentLength: number;
}): string => {
  const name = encodeName(params.name);
  let header = BOUNDARY_HYPHEN_CHARS + BOUNDARY_ID + CRLF;
  header += `Content-Disposition: form-data; name="${name}"; filename="${name}"`;
  header += `${CRLF}Content-Type: ${params.contentType}`;
  header += `${CRLF}Content-Length: ${params.contentLength}`;
  header += CRLF;
  header += CRLF;
  return header;
};

export interface MultipartFileEntry {
  name: string;
  filePath: string;
  contentType: string;
}

export const multipartContentType = `multipart/form-data; boundary=${BOUNDARY_ID}`;

export async function* createMultipartBodyFromFilesAsync(
  entries: MultipartFileEntry[]
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for await (const entry of entries) {
    const stats = await fs.promises.stat(entry.filePath);
    const header = makeFormHeader({
      name: entry.name,
      contentType: entry.contentType,
      contentLength: stats.size,
    });
    yield encoder.encode(header);
    yield* createReadStreamAsync(entry.filePath);
    yield encoder.encode(CRLF);
  }
  yield encoder.encode(FORM_FOOTER);
}

import { type bunyan } from '@expo/logger';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';

const MAX_LINE_CHARS = 16 * 1024;
const MAX_OUTPUT_CHARS = 64 * 1024;

export function createProcessOutput(logger?: bunyan, secrets: string[] = []) {
  const redact = (text: string): string => {
    text = stripVTControlCharacters(text);
    for (const secret of secrets.filter(Boolean)) {
      for (const value of [
        secret,
        encodeURIComponent(secret),
        JSON.stringify(secret).slice(1, -1),
      ]) {
        text = text.replaceAll(value, '[REDACTED]');
      }
    }
    return text
      .replace(/([?&]token=)[^\s&#"'<>]+/gi, '$1[REDACTED]')
      .replace(/(argent:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(
        /("(?:[a-z_]*token|credential|password)"\s*:\s*")(?:\\.|[^"\\\r\n])*(")/gi,
        '$1[REDACTED]$2'
      )
      .replace(/(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
      .replace(
        /((?:--)?(?:token|credential|password)[=:]\s*|--(?:token|credential|password)\s+)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,&#"'<>()]+)/gi,
        '$1[REDACTED]'
      );
  };
  let output = '';
  const streams = (['stdout', 'stderr'] as const).map(source => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let omitted = false;
    const publish = (): void => {
      const line = omitted ? '[Overlong output line omitted.]' : redact(pending);
      output = (output + line + '\n').slice(-MAX_OUTPUT_CHARS);
      logger?.info({ source }, line);
      pending = '';
      omitted = false;
    };
    const appendText = (text: string): void => {
      let start = 0;
      for (let index = 0; index <= text.length; index++) {
        if (index < text.length && text[index] !== '\n') {
          continue;
        }
        if (!omitted) {
          if (pending.length + index - start > MAX_LINE_CHARS) {
            pending = '';
            omitted = true;
          } else {
            pending += text.slice(start, index);
          }
        }
        if (index < text.length) {
          pending = pending.replace(/\r$/, '');
          publish();
          start = index + 1;
        }
      }
    };
    return {
      append(chunk: Buffer | string): void {
        appendText(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      },
      finish(): void {
        appendText(decoder.end());
        if (pending || omitted) {
          publish();
        }
      },
      getPending: () => (omitted ? '[Overlong output line omitted.]' : redact(pending)),
    };
  });
  return {
    stdout: streams[0],
    stderr: streams[1],
    finish: () => streams.forEach(stream => stream.finish()),
    getOutput: () =>
      (redact(output) + streams.map(stream => stream.getPending()).join('')).slice(
        -MAX_OUTPUT_CHARS
      ),
  };
}

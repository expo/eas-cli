import { runGitCredentialHelperAsync } from './sandboxGitCredentialHelper';

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  process.exitCode = await runGitCredentialHelperAsync({
    argv: process.argv.slice(2),
    stdin: Buffer.concat(chunks).toString('utf8'),
    env: process.env,
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  });
}

void main();

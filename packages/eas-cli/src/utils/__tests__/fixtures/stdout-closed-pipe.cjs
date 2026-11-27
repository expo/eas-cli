const { ignoreOutputErrors, writeToStdoutAsync } = require('../../stdout');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The parent closes the reading end of one output stream at once. Then this writes to it like
// simulator:start does, and reports on the other stream.
async function main() {
  const [stream, guard] = process.argv.slice(2);
  if (guard === 'guard') {
    ignoreOutputErrors();
  }
  await sleep(200);
  if (stream === 'stdout') {
    // A checked write, then plain output such as a log line.
    let result = 'resolved';
    try {
      await writeToStdoutAsync(`${'x'.repeat(1024)}\n`);
    } catch (error) {
      result = error.code;
    }
    await sleep(50);
    process.stdout.write('later output\n');
    await sleep(200);
    process.stderr.write(`result:${result}\n`);
  } else {
    // Progress output, which goes to stderr with --json.
    process.stderr.write('progress\n');
    await sleep(50);
    process.stderr.write('more progress\n');
    await sleep(200);
    process.stdout.write('done\n');
  }
}

void main();

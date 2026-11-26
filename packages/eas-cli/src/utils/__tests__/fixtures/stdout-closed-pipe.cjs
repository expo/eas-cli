const { ignoreStdoutErrors, writeToStdoutAsync } = require('../../stdout');

// The parent closes the reading end of stdout at once. Then this writes like simulator:start does:
// a checked write, then plain output such as a log line.
async function main() {
  if (process.argv[2] === 'guard') {
    ignoreStdoutErrors();
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  let result = 'resolved';
  try {
    await writeToStdoutAsync(`${'x'.repeat(1024)}\n`);
  } catch (error) {
    result = error.code;
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  process.stdout.write('later output\n');
  await new Promise(resolve => setTimeout(resolve, 200));
  process.stderr.write(`result:${result}\n`);
}

void main();

import * as Config from '@oclif/config';
import Help from '@oclif/plugin-help';
import CommandHelp from '@oclif/plugin-help/lib/command';
import { compact, sortBy } from '@oclif/plugin-help/lib/util';
import chalk from 'chalk';
import groupBy from 'lodash/groupBy';
import stripAnsi from 'strip-ansi';

export default class CustomHelp extends Help {
  protected formatCommand(command: Config.Command): string {
    const help = new CustomCommandHelp(command, this.config, this.opts);
    return help.generate();
  }
}

class CustomCommandHelp extends CommandHelp {
  generate(): string {
    const cmd = this.command;
    const flags = sortBy(
      Object.entries(cmd.flags || {})
        .filter(([, v]) => !v.hidden)
        .map(([k, v]) => {
          v.name = k;
          return v;
        }),
      f => [f.helpLabel, f.name]
    );
    const args = (cmd.args || []).filter(a => !a.hidden);
    let output = compact([
      this.usage(flags),
      this.args(args),
      this.flags(flags),
      this.description(),
      this.aliases(cmd.aliases),
      this.examples(cmd.examples || (cmd as any).example),
    ]).join('\n\n');
    if (this.opts.stripAnsi) output = stripAnsi(output);
    return output;
  }

  protected flags(flags: Config.Command.Flag[]): string | undefined {
    if (flags.length === 0) return;
    const groupableFlags = flags.map(originalFlag => {
      const { helpLabel, ...flag } = originalFlag;
      // We re-purpose `helpLabel` to mean a "header to group the flag under".
      return { ...flag, group: helpLabel };
    });

    const groups = groupBy(groupableFlags, flag => flag.group || '');
    let output = chalk.bold('OPTIONS') + '\n';
    for (const [label, flags] of Object.entries(groups)) {
      if (label) {
        output += '  ' + chalk.underline(label) + '\n';
      }
      output += super.flags(flags)?.split('\n').slice(1).join('\n') ?? '';
      output += '\n\n';
    }
    return output.trimEnd();
  }
}

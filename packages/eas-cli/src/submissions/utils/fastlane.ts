import spawnAsync from '@expo/spawn-async';

export const travelingFastlane =
  process.platform === 'darwin'
    ? require('@expo/traveling-fastlane-darwin')()
    : require('@expo/traveling-fastlane-linux')();

export async function runFastlaneAsync(
  program: string,
  args: any,
  {
    appleId,
    appleIdPassword,
    appleTeamId,
    itcTeamId,
    companyName,
    sku,
  }: {
    appleId?: string;
    appleIdPassword?: string;
    appleTeamId?: string;
    itcTeamId?: string;
    companyName?: string;
    sku?: string;
  },
  pipeToLogger = false
): Promise<{ [key: string]: any }> {
  const fastlaneData =
    appleId && appleIdPassword
      ? {
          FASTLANE_USER: appleId,
          FASTLANE_PASSWORD: appleIdPassword,
          FASTLANE_DONT_STORE_PASSWORD: '1',
          FASTLANE_TEAM_ID: appleTeamId,
          ...(itcTeamId && { FASTLANE_ITC_TEAM_ID: itcTeamId }),
          ...(companyName && { PRODUCE_COMPANY_NAME: companyName }),
          ...(sku && { PRODUCE_SKU: sku }),
        }
      : {};

  const env = {
    ...process.env,
    ...fastlaneData,
  };

  const { stderr } = await spawnAsync(program, args, {
    env,
    stdio: ['inherit', pipeToLogger ? 'inherit' : 'pipe', 'pipe'],
  });

  /* TODO: Fix handling this message, it causes JSON parse error:
    "No entry for terminal type "xterm-256color";
    using dumb terminal settings."

    It works when pipeToLogger = true
  */
  const res = JSON.parse(stderr.trim());
  if (res.result !== 'failure') {
    return res;
  } else {
    let message =
      res.reason !== 'Unknown reason'
        ? res.reason
        : res.rawDump?.message ?? 'Unknown error when running fastlane';
    message = `${message}${
      res?.rawDump?.backtrace
        ? `\n${res.rawDump.backtrace.map((i: string) => `    ${i}`).join('\n')}`
        : ''
    }`;
    throw new Error(message);
  }
}

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = fs.realpathSync(process.argv[2]);
const cliRequire = require('node:module').createRequire(path.join(root,'packages/eas-cli/package.json'));
cliRequire('ts-node').register({project:path.join(root,'packages/eas-cli/tsconfig.json'),transpileOnly:true});
const { Config } = cliRequire('@oclif/core');
const cli = path.join(root, 'packages/eas-cli');
const EasCommand = require(path.join(cli, 'src/commandUtils/EasCommand')).default;
const Control = require(path.join(cli, 'src/commands/simulator/control')).default;
const EasHelp = require(path.join(cli,'src/help')).default;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-help-lifecycle-'));
const args=JSON.parse(process.argv[3]);
const events=[];
globalThis.__helpLifecycleEvents=events;
EasCommand.prototype.run=async function(){ events.push({event:'run',id:this.id}); };
EasCommand.prototype.finally=async function(){};
(async()=>{
 try {
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'eas-help-lifecycle-fixture',version:'1.0.0',oclif:{bin:'eas',commands:{strategy:'explicit',target:'./commands.cjs'},hooks:{prerun:'./prerun.cjs',postrun:'./postrun.cjs'}}}));
 fs.writeFileSync(path.join(dir,'commands.cjs'),`exports.default = { 'simulator:control': require(${JSON.stringify(path.join(cli,'src/commands/simulator/control'))}).default };`);
 for(const event of ['prerun','postrun']) fs.writeFileSync(path.join(dir,`${event}.cjs`),`module.exports = async function({Command}) { globalThis.__helpLifecycleEvents.push({event:${JSON.stringify(event)},id:Command.id}); };`);
 process.env.XDG_DATA_HOME=dir;
 process.env.XDG_CACHE_HOME=dir;
 const config = await Config.load({root:dir});
 // Published manifests discover metadata without loading the command class.
 // Clear eager discovery's assignment to exercise that cold-start boundary.
 delete Control.id;
 await new EasHelp(config).showHelp(args);
 console.log('LIFECYCLE_RESULT '+JSON.stringify(events));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})().catch(err=>{console.error(err);process.exitCode=1});

/* Run only after linking this directory to the intended Vercel project. */
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const branch=spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim();
if(branch!=='grim-payment-repair-test')throw Error('Preview deployment requires grim-payment-repair-test.');
if(!fs.existsSync('.vercel/project.json'))throw Error('Vercel project must be linked first. No deployment was attempted.');
for(const args of [['run','check'],['test'],['run','test:browser']]){
 const r=spawnSync('npm',args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}
// The target is fixed; this helper cannot promote or publish production.
const deployment=spawnSync('npx',['--yes','vercel','deploy','--target','preview','--yes'],{stdio:'inherit'});
process.exit(deployment.status??1);

#!/usr/bin/env node
/**
 * GRIM · Safe Liquid Glass activation, additive and idempotent.
 * Inserts 2 assets in every actual HTML page in the current checkout.
 * Does not replace old HTML, alter commerce JavaScript, or touch media.
 * node launch/GRIM_STORE_RETAIL_V5_1/scripts/apply-grim-glass.mjs [--dry-run]
 */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(fileDir,'../public');
const dryRun = process.argv.includes('--dry-run');
const css = '<link rel="stylesheet" href="/grim-glass-system.css?v=20261117-v1" data-grim-glass-asset="css">';
const js = '<script src="/grim-glass-system.js?v=20261117-v1" defer data-grim-glass-asset="js"></script>';
let changed=0, unchanged=0, skipped=[];
async function traverse(folder){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const full=path.join(folder,entry.name);
    if(entry.isDirectory()){await traverse(full);continue;}
    if(!entry.isFile()||!entry.name.endsWith('.html'))continue;
    const relative=path.relative(publicDir,full);
    const before=await readFile(full,'utf8');
    if(/<meta\s+[^>]*http-equiv\s*=\s*["']?refresh/i.test(before)||/data-grim-glass-off/i.test(before)){
      skipped.push(relative+': redirect / explicitly opted out');continue;
    }
    if(!/<\/head\s*>/i.test(before)||!/<\/body\s*>/i.test(before)){
      skipped.push(relative+': missing HTML closing tags');continue;
    }
    let after=before;
    const line=after.includes('\r\n')?'\r\n':'\n';
    if(!/href\s*=\s*["']\/grim-glass-system\.css(?:\?|["'])/i.test(after)){
      after=after.replace(/<\/head\s*>/i,`${line}  ${css}${line}</head>`);
    }
    if(!/src\s*=\s*["']\/grim-glass-system\.js(?:\?|["'])/i.test(after)){
      after=after.replace(/<\/body\s*>/i,`${line}  ${js}${line}</body>`);
    }
    if(after===before){unchanged++;continue;}
    changed++;
    if(!dryRun)await writeFile(full,after,'utf8');
    console.log(`${dryRun?'WOULD UPDATE':'UPDATED'} ${relative}`);
  }
}
await traverse(publicDir);
console.log(`GRIM Liquid Glass ${dryRun?'preview':'installed'}: ${changed} changed, ${unchanged} already active, ${skipped.length} skipped.`);
if(skipped.length) console.log(skipped.join('\n'));

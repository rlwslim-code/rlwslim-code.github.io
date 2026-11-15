const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const dir=path.resolve(__dirname,'../../public'); const s=fs.readFileSync(path.join(dir,'grim-liquid.js'),'utf8');
test('two independently advected dyes mix',()=>{
  for(const needle of ['blueNext[i]','redNext[i]','sample(blue,atx,aty)','sample(red,atx,aty)','const mix=Math.min(rBody,bBody)']) assert.ok(s.includes(needle),needle);
});
test('touch any area without blocking controls',()=>{
  assert.match(s,/pointerEvents: 'none'/);assert.match(s,/doc.addEventListener\('touchmove'/);
  assert.match(s,/doc.addEventListener\('pointerdown'/); assert.doesNotMatch(s,/preventDefault\s*\(/);
});
test('customer pages load current version',()=>{
  for(const name of ['index','shop','story']){
    const h=fs.readFileSync(path.join(dir,`${name}.html`),'utf8');
    assert.match(h,/grim-liquid.js\?v=20261115-bloodline-abyss-mix-r3/);
  }
});

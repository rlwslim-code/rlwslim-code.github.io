const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'../../public');
const js=fs.readFileSync(path.join(root,'grim-liquid.js'),'utf8');
test('whole-page overlay is transparent to all clicks',()=>{
  assert.match(js,/pointerEvents: 'none'/);assert.match(js,/doc\.addEventListener\('touchmove'/);assert.match(js,/doc\.addEventListener\('pointerdown'/);assert.match(js,/createImageData/);
  assert.doesNotMatch(js,/preventDefault\s*\(/);
});
test('customer-facing pages load the same full-screen fluid',()=>{
  for(const name of ['index','shop','story']){
    const h=fs.readFileSync(path.join(root,`${name}.html`),'utf8');
    assert.match(h,/grim-liquid\.js\?v=20261114-abyss-touch-r2/);assert.match(h,/grim-liquid\.css\?v=20261114-abyss-touch-r2/);
  }
});

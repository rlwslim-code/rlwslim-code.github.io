"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const match=app.match(/const FALLBACK_CATALOG=(\[.*?\]);/s);
assert.ok(match,'fallback catalogue absent');
const products=JSON.parse(match[1]);
const expected={Tee:25000,Hoodie:45000,Armless:20000,'Complete GRIM Outfit':100000};
test('all known fallback products display the Chapter I launch amounts',()=>{
  assert.equal(products.length,25);
  products.forEach(p=>assert.equal(p.price,expected[p.type],`wrong fallback price for ${p.id}`));
});
test('prices remain server-authoritative at checkout',()=>{
  assert.match(app,/fetch\('\/api\/products',[^;]+/);
  assert.match(app,/expectedAmount\s*\+=\s*Number\(p\.price\)/);
});
test('Supabase price patch has preview, guarded update and verification',()=>{
  const sqlDir=path.join(root,'sql');
  const preview=fs.readFileSync(path.join(sqlDir,'CHAPTER_I_PRICE_PREVIEW_READ_ONLY.sql'),'utf8');
  const update=fs.readFileSync(path.join(sqlDir,'CHAPTER_I_PRICE_APPLY_SUPABASE.sql'),'utf8');
  const verify=fs.readFileSync(path.join(sqlDir,'CHAPTER_I_PRICE_VERIFY_READ_ONLY.sql'),'utf8');
  assert.match(preview,/READY TO UPDATE/);
  assert.match(update,/RAISE EXCEPTION/);
  assert.match(update,/WHERE p.id = t.id/);
  assert.match(update,/p.price = t.previous_price/);
  assert.match(verify,/live_price_ngn/);
});

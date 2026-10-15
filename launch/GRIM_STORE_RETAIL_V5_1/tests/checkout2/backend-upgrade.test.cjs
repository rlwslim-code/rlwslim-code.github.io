'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {debitSQL,customerId}=require('./release-fixture.cjs');
const {createSupabaseStore}=require('../../src/checkout2/adapters.cjs');
const {createEngine}=require('../../src/checkout2/grim-checkout-v2.cjs');
const {createHybridFlow}=require('../../src/checkout2/hybrid-checkout.cjs');
const dest={country:'NG',address:'1 Main Road',city:'Ikeja',state:'Lagos',postal:'',apartment:''};
const person={firstName:'Test',lastName:'Customer',phone:'+2348000000000'};
const lines=[{productId:'1',size:'M',quantity:1}];
const catalog=async()=>({'1':{name:'Obsidian',color:'Black',active:true,priceKobo:50000}});

test('consolidated upgrade handles UUID orders, all three payments, duplicate callbacks, saved billing and historical records',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table customers(id uuid primary key,email text);
 create table orders(id uuid primary key default gen_random_uuid(),customer_id text,status text,snapshot jsonb not null,subtotal_kobo bigint not null,fee_kobo bigint not null,total_kobo bigint not null,expires_at timestamptz not null,created_at timestamptz default now(),paid_at timestamptz,payment_reference text,email text,name text,address text,items_json jsonb,payment_status text,updated_at timestamptz default now());
 create table wallet_accounts(id uuid primary key default gen_random_uuid(),customer_id uuid,currency varchar,balance_minor bigint check(balance_minor>=0),status text,unique(customer_id,currency));
 create table wallet_transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,currency varchar,amount_minor bigint,transaction_type text,order_id text,idempotency_key text unique,status text,balance_before_minor bigint,balance_after_minor bigint);
 insert into customers values('${customerId}','release@example.test');
 insert into wallet_accounts(customer_id,currency,balance_minor,status) values('${customerId}','NGN',10000000,'active');
 insert into orders(customer_id,status,snapshot,subtotal_kobo,fee_kobo,total_kobo,expires_at,payment_reference) values('historic','complete','{}',50,0,50,now(),'historical-sentinel');`);
 await db.exec(debitSQL);
 const migration=fs.readFileSync(new URL('../../sql/20261015_backend_upgrade.sql',`file://${__filename}`),'utf8');
 await db.exec(migration);
 await db.exec(migration); // Rerunning installation must preserve balances and records.
 const rpc=async(name,payload={})=>{const e=Object.entries(payload);return (await db.query(`select public.${name}(${e.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) as result`,e.map(([,v])=>typeof v==='object'?JSON.stringify(v):v))).rows[0].result;};
 const store=createSupabaseStore({url:'https://fixture.supabase.co',serviceKey:'fixture',mode:'live',fetcher:async(u,o)=>{try{return {ok:true,json:async()=>await rpc(u.split('/').pop(),JSON.parse(o.body))};}catch(e){return {ok:false,json:async()=>({message:e.message})};}}});
 let row,initializations=0;
 const provider={initialize:async p=>{initializations++;assert.equal(p.amount,150000);assert.deepEqual(p.channels,[row==='bank_transfer'?'bank_transfer':'card']);return {authorization_url:'https://checkout.paystack.com/test'};},verify:async ref=>({reference:ref,status:'success',id:row==='bank_transfer'?'900719925474099312':'900719925474099311',domain:'live',currency:'NGN',amount:150000,channel:row==='bank_transfer'?'bank_transfer':'card',customer:{email:'release@example.test'}})};
 const engine=createEngine({catalog,store,provider,callbackBase:'https://grimwear.store',mode:'live',bankTransferEnabled:true});
 for (const method of ['card','bank_transfer','wallet']) {
  const id=crypto.randomUUID();
  const snapshot={currency:'NGN',destination:dest,recipient:person,items:[{productId:'1',name:'Obsidian',size:'M',quantity:1,unitKobo:50000,lineKobo:50000}],subtotalKobo:50000};
  await db.query(`insert into grim2_hybrid_quote_requests(id,customer_id,status,snapshot,subtotal_kobo,fee_kobo,total_kobo,expires_at) values($1,$2,'QUOTE_READY',$3,50000,100000,150000,now()+interval '1 hour')`,[id,customerId,JSON.stringify(snapshot)]);
  row=method;
  const input={quoteId:id,customerId,email:'release@example.test',method,bankTransferEnabled:true,walletCheckoutEnabled:true};
  const a=await engine.startManualQuote(input);
  const b=await engine.startManualQuote(input);
  assert.equal(a.reference,b.reference);
  if(method==='wallet') assert.equal(a.status,'paid');
  else {
   const paid=await engine.confirm({reference:a.reference,customerId});assert.equal(paid.status,'paid');
   assert.equal((await engine.confirm({reference:a.reference,customerId})).orderId,paid.orderId);
  }
  await assert.rejects(engine.confirm({reference:a.reference,customerId:'someone-else'}),e=>e.code==='NOT_FOUND');
 }
 assert.equal(initializations,2);
 assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n,4);
 assert.equal((await db.query('select count(*)::int n from grim2_receipts')).rows[0].n,3);
 assert.equal((await db.query('select balance_minor from wallet_accounts')).rows[0].balance_minor,9850000);
 assert.equal((await db.query('select count(*)::int n from wallet_transactions')).rows[0].n,1);
 const paid=(await db.query("select * from orders where payment_reference like 'GRIM2-%' limit 1")).rows[0];
 assert.equal(paid.total_kobo,150000);assert.equal(paid.fee_kobo,100000);assert.ok(paid.snapshot.quote);assert.ok(Array.isArray(paid.items_json));
 await store.saveAddress(customerId,dest);await store.saveAddress(customerId,dest);
 assert.equal((await store.addresses(customerId)).length,1);
 }finally {await db.close();}
});

test('zone delivery binds customer, address, product prices and rate; supports configured free delivery',async()=>{
 let fee=0;
 const db={from:table=>({select:()=>table==='grim2_hybrid_rates'?Promise.resolve({data:[{id:'rate1',country:'NG',state:'Lagos',city:'Ikeja',fee_kobo:fee,max_weight_grams:10000,enabled:true}]}):{in:async()=>({data:[{product_id:'1',weight_kg:1}]})}})};
 const flow=createHybridFlow({catalog,db,signingSecret:'s'.repeat(32)});
 const input={customer:{id:'c',email:'c@example.test'},lines,destination:dest};
 const quote=await flow.quote(input);assert.equal(quote.couriers[0].amountKobo,0);
 const selectionToken=quote.couriers[0].selectionToken;
 assert.equal((await flow.resolve({...input,selectionToken})).quote.totalKobo,50000);
 await assert.rejects(flow.resolve({...input,customer:{id:'other'},selectionToken}));
 await assert.rejects(flow.resolve({...input,destination:{...dest,address:'other'},selectionToken}));
 fee=100;
 await assert.rejects(flow.resolve({...input,selectionToken}),e=>e.code==='SHIPPING_QUOTE_EXPIRED_OR_CHANGED');
});

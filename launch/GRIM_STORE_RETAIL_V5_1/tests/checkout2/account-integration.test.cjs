'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('existing account dashboard reads real wallet ledger columns and balance without rewriting customers',async()=>{
 const {installGrimV6}=await import('../../src/grim-v6.js');
 const handlers=new Map(),calls=[];
 const app={use:()=>{},get:(p,fn)=>handlers.set(p,fn),post:()=>{},put:()=>{},delete:()=>{},patch:()=>{}};
 const supabase={from:table=>{
 const q={select:fields=>{calls.push({table,fields});if(table==='wallet_transactions')assert.equal(fields,'id,currency,transaction_type,amount_minor,payment_reference,status,description,created_at');return q;},eq:()=>q,order:()=>q,
 maybeSingle:async()=>({data:table==='customers'?{id:'customer',name:'Customer',email:'customer@example.test',wallet_balance:999999999}:table==='wallet_accounts'?{balance_minor:6780000,status:'active'}:null,error:null}),
 limit:async()=>({data:table==='wallet_transactions'?[{id:'tx',currency:'NGN',transaction_type:'debit',amount_minor:3220000,payment_reference:'ref',status:'completed',description:'Order'}]:[{id:123,total:32200}],error:null})};return q;
 }};
 installGrimV6(app,{supabase});let body;
 const res={setHeader:()=>{},status:()=>res,json:x=>{body=x;return res;}};
 await handlers.get('/api/account')({session:{user:{email:'customer@example.test'}}},res);
 assert.equal(body.wallet.balance,67800);assert.equal(body.transactions[0].amount,32200);assert.equal(body.transactions[0].type,'debit');assert.equal(body.orders[0].id,123);
 assert.ok(calls.some(x=>x.table==='wallet_accounts'));
});

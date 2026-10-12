'use strict';
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path');
const {createSupabaseStore}=require('../../src/checkout2/adapters.cjs');
const debitSQL=`create or replace function public.grim_wallet_debit(p_customer_id uuid,p_currency varchar,p_amount_minor bigint,p_order_id text,p_description text,p_idempotency_key text)
returns uuid language plpgsql set search_path=public as $$ declare w wallet_accounts%rowtype; tx uuid; begin
 if p_amount_minor<=0 or p_currency<>'NGN' or length(coalesce(p_idempotency_key,''))=0 then raise exception 'Invalid debit';end if;
 select id into tx from wallet_transactions where idempotency_key=p_idempotency_key;
 if found then return tx;end if;
 select * into w from wallet_accounts where customer_id=p_customer_id and currency=p_currency for update;
 if not found or w.status<>'active' or w.balance_minor<p_amount_minor then raise exception 'Insufficient or inactive wallet';end if;
 update wallet_accounts set balance_minor=balance_minor-p_amount_minor where id=w.id;
 insert into wallet_transactions(customer_id,currency,amount_minor,transaction_type,order_id,idempotency_key,status,balance_before_minor,balance_after_minor)
 values(p_customer_id,p_currency,p_amount_minor,'debit',p_order_id,p_idempotency_key,'completed',w.balance_minor,w.balance_minor-p_amount_minor) returning id into tx;
 return tx;end;$$;`;
const customerId='4d7c2b22-5528-4323-a7a8-2c6a76838301';
async function releaseFixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table customers(id uuid primary key,email text);
 create table orders(id bigserial primary key,name text,email text,phone text,address text,items_json text,total numeric,status text,payment_status text,payment_reference text,customer_id uuid,currency text,total_minor bigint,created_at timestamptz default now());
 create table wallet_accounts(id uuid primary key default gen_random_uuid(),customer_id uuid,currency varchar,balance_minor bigint check(balance_minor>=0),status text,unique(customer_id,currency));
 create table wallet_transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,currency varchar,amount_minor bigint,transaction_type text,order_id text,idempotency_key text,status text,balance_before_minor bigint,balance_after_minor bigint);
 create unique index wallet_transactions_idempotency_idx on wallet_transactions(idempotency_key) where idempotency_key is not null;
 insert into customers values('${customerId}','release@example.test');
 insert into wallet_accounts(customer_id,currency,balance_minor,status) values('${customerId}','NGN',10000000,'active');
 insert into orders(name,email,total,status,payment_reference) values('Historical','preserved@example.test',50,'completed','historical-sentinel');`);
 await db.exec(debitSQL);
 for(const name of ['003_checkout2_live_REVIEW.sql','004_checkout2_shipping_evidence.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../../sql',name),'utf8'));
 const rpc=async(name,payload)=>{const entries=Object.entries(payload);return (await db.query(`select public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) as result`,entries.map(([,v])=>typeof v==='object'?JSON.stringify(v):v))).rows[0].result;};
 const store=createSupabaseStore({url:'https://local-fixture.supabase.co',serviceKey:'fixtureonly',mode:'live',fetcher:async(u,o)=>{try{const data=await rpc(u.split('/').pop(),JSON.parse(o.body));return {ok:true,json:async()=>data};}catch(e){return {ok:false,json:async()=>({message:e.message,code:e.code})};}}});
 return {db,store,rpc,customerId,close:()=>db.close(),debitSQL};
}
module.exports={releaseFixture,customerId};

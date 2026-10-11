const t=require('node:test'),a=require('node:assert/strict');
const {createService,validateFee,validatedSnapshot}=require('../../src/checkout2/hybrid-quote-requests.cjs');
const catalog=async()=>({'1':{active:true,priceKobo:400000,name:'Obsidian',color:'Black'}});
const input={lines:[{productId:'1',quantity:2,size:'M'}],destination:{country:'NG',address:'14 Example Street',city:'Lagos',state:'Lagos'},recipient:{firstName:'A',lastName:'B',phone:'08000000000'}};
t('invalid fee rejected',()=>{for(const x of [-1,NaN,1.5,'100',1000000001])a.throws(()=>validateFee(x));});
t('snapshot totals derived from catalog',async()=>{const snap=validatedSnapshot({...input,catalog:await catalog()});a.equal(snap.subtotalKobo,800000);a.equal(snap.items[0].unitKobo,400000)});
t('reject product price manipulation',async()=>{const snap=validatedSnapshot({...input,lines:[{...input.lines[0],priceKobo:1}],catalog:await catalog()});a.equal(snap.subtotalKobo,800000)});
t('quote persisted and customer-specific',async()=>{
 const records=[];const now=()=>new Date('2026-10-11T12:00:00Z');
 function dbFrom(){let selected=records,conditions=[];const chain={insert(row){records.push({...row,created_at:now().toISOString()});selected=[records.at(-1)];return chain;},select(){return chain;},eq(k,v){conditions.push([k,v]);return chain;},order(){return chain;},limit(){return chain;},update(fields){chain.patch=fields;return chain;},maybeSingle(){let x=records.find(r=>conditions.every(([k,v])=>r[k]===v));if(x&&chain.patch)Object.assign(x,chain.patch);return Promise.resolve({data:x||null,error:null});},single(){return Promise.resolve({data:selected[0],error:null});},then(resolve){return Promise.resolve({data:records.filter(r=>conditions.every(([k,v])=>r[k]===v)),error:null}).then(resolve);}};return chain;}
 const svc=createService({db:{from:dbFrom},catalog,now,uuid:()=> '11111111-1111-4111-8111-111111111111'});
 const r=await svc.create({...input,customerId:'buyerA'});a.equal(r.status,'AWAITING_QUOTE');
 a.equal((await svc.listCustomer('buyerB')).length,0);
 const q=await svc.setQuote({id:r.id,feeKobo:550000});a.equal(q.totalKobo,1350000);
 await a.rejects(()=>svc.setQuote({id:r.id,feeKobo:2}),e=>e.code==='QUOTE_NOT_EDITABLE');
 a.equal((await svc.listCustomer('buyerA'))[0].status,'QUOTE_READY');
});

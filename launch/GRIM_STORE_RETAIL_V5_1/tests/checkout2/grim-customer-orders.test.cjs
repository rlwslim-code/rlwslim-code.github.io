const {test}=require('node:test');
const assert=require('node:assert/strict');
test('GRIM order lifecycle categories',async()=>{
 const {classifyOrder}=await import('../../src/grim-orders/customer-orders.js');
 assert.equal(classifyOrder({status:'cancelled',payment_status:'paid'}),'cancelled');
 assert.equal(classifyOrder({status:'fraud_review',payment_status:'paid'}),'under_review');
 assert.equal(classifyOrder({status:'shipped',payment_status:'paid'}),'in_transit');
 assert.equal(classifyOrder({status:'new',payment_status:'paid'}),'awaiting_fulfillment');
 assert.equal(classifyOrder({status:'new',payment_status:'pending'}),'payment_pending');
});
test('history API requires signed-in user and only uses their session email',async()=>{
 const {installGrimCustomerOrders}=await import('../../src/grim-orders/customer-orders.js');
 let handler,filter;
 const app={get:(path,fn)=>{assert.equal(path,'/api/account/order-history');handler=fn;}};
 const supabase={from:()=>({select:()=>({ilike:(col,email)=>{filter=[col,email];return {order:()=>({limit:async()=>({data:[],error:null})})};}})})};
 installGrimCustomerOrders(app,{supabase});
 function response(){return {statusCode:200,setHeader(){},status(c){this.statusCode=c;return this;},json(x){this.body=x;return this;}};}
 const noAuth=response();await handler({session:null,query:{email:'victim@example.com'}},noAuth);
 assert.equal(noAuth.statusCode,401);
 const auth=response();await handler({session:{user:{email:'USER@example.com'}},query:{email:'victim@example.com'}},auth);
 assert.deepEqual(filter,['email','user@example.com']);assert.deepEqual(auth.body.orders,[]);
});

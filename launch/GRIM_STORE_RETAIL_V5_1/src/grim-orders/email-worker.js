import crypto from 'node:crypto';
import {sendGrimEmail, resendConfigured} from './resend-transport.js';
import {grimStatusEmail} from './status-email-templates.js';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function orderEmailHtml({orderId, customerName, amount, currency = 'NGN'}) {
  const number = escapeHtml(orderId);
  const name = escapeHtml(customerName || 'GRIM Member');
  const amountLine = amount == null ? '' : `<p style="color:#e6d5a4">Total: ${escapeHtml(currency)} ${escapeHtml(amount)}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#090a0f;color:#f7f3ea;font-family:Arial,sans-serif"><div style="max-width:560px;margin:36px auto;padding:38px 26px;border:1px solid #b99b57;background:#11131c"><div style="color:#d5b875;font-size:27px;letter-spacing:6px;font-weight:bold">GRIM</div><div style="height:2px;background:#5c172b;margin:20px 0"></div><h1 style="font-size:24px">YOUR LEGACY BEGINS.</h1><p>RAV’KAEL, ${name}.</p><p>Your payment has been verified and your order has been recorded.</p><p style="color:#d5b875">Order #${number}</p>${amountLine}<p>We will notify you when your order moves forward.</p><p style="font-size:12px;color:#aab5d5;margin-top:35px">TIME IS BORROWED. LEGACY IS EARNED.</p></div></body></html>`;
}
export function emailReady(env=process.env) {return resendConfigured(env);}
function safeEquals(a,b) {const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length && crypto.timingSafeEqual(x,y);}
export function installGrimEmailWorker(app,{supabase,env=process.env}={}) {
  app.post('/api/internal/grim-email-dispatch',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if (!env.GRIM_EMAIL_WORKER_SECRET || !safeEquals(req.get('x-grim-worker-secret'),env.GRIM_EMAIL_WORKER_SECRET)) return res.status(401).json({error:'UNAUTHORIZED'});
    if (!supabase || !emailReady(env)) return res.status(503).json({error:'EMAIL_NOT_CONFIGURED'});
    const {data:jobs,error}=await supabase.from('grim_transactional_email_outbox').select('id,order_id,recipient_email,template_key,attempts').in('state',['queued','failed']).lt('attempts',5).order('queued_at',{ascending:true}).limit(10);
    if(error) return res.status(503).json({error:'OUTBOX_UNAVAILABLE'});
    let sent=0,failed=0;
    for(const job of jobs||[]){
      // Compare-and-set claim: only one worker may send a queued job.
      const {data:claimed,error:claimError}=await supabase.from('grim_transactional_email_outbox').update({state:'sending',attempts:job.attempts+1,updated_at:new Date().toISOString()}).eq('id',job.id).eq('state',job.attempts ? 'failed':'queued').eq('attempts',job.attempts).select('id');
      if(claimError || !claimed?.length) continue;
      try{
        const {data:order,error:orderError}=await supabase.from('orders').select('id,name,total,payment_status,status,email').eq('id',job.order_id).single();
        if(orderError || !order) throw Error('Order not available');
        // Paid evidence is mandatory for confirmation. Status notifications only for paid orders.
        if(String(order.payment_status||'').toLowerCase()!=='paid') throw Error('Paid order not available');
        if(String(order.email||'').trim().toLowerCase() !== String(job.recipient_email||'').trim().toLowerCase()) throw Error('Recipient does not match order');
        let message;
        if(job.template_key==='order_confirmed') {
          message={subject:`GRIM | Your Legacy Begins — Order #${order.id}`,
            html:orderEmailHtml({orderId:order.id,customerName:order.name,amount:order.total,currency:'NGN'}),
            text:`RAV’KAEL. Your GRIM order #${order.id} has been confirmed. TIME IS BORROWED. LEGACY IS EARNED.`};
        } else {
          message=grimStatusEmail({templateKey:job.template_key,orderId:order.id,customerName:order.name});
        }
        await sendGrimEmail({...message,to:job.recipient_email,idempotencyKey:`grim_outbox_${job.id}`},{env});
        await supabase.from('grim_transactional_email_outbox').update({state:'sent',sent_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('state','sending');sent++;
      }catch(err){await supabase.from('grim_transactional_email_outbox').update({state:'failed',last_error:String(err.message||err).slice(0,250),updated_at:new Date().toISOString()}).eq('id',job.id).eq('state','sending');failed++;}
    }
    res.json({ok:true,sent,failed});
  });
}

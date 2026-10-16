import crypto from 'node:crypto';
import {sendGrimEmail, resendConfigured} from './resend-transport.js';
import {grimStatusEmail} from './status-email-templates.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function orderEmailHtml({orderId,customerName,amount,currency='NGN'}) {
  return `<!doctype html><html><body style="margin:0;background:#090a0f;color:#f7f3ea;font-family:Arial,sans-serif"><div style="max-width:560px;margin:36px auto;padding:38px 26px;border:1px solid #b99b57;background:#11131c"><div style="color:#d5b875;font-size:27px;letter-spacing:6px;font-weight:bold">GRIM</div><div style="height:2px;background:#5c172b;margin:20px 0"></div><h1>YOUR LEGACY BEGINS.</h1><p>RAV’KAEL, ${esc(customerName||'GRIM Member')}.</p><p>Your payment has been verified and your order has been recorded.</p><p style="color:#d5b875">Order #${esc(orderId)}</p>${amount == null ? '' : `<p>Total: ${esc(currency)} ${esc(amount)}</p>`}<p>We will notify you when your order moves forward.</p><p style="font-size:12px;color:#aab5d5;margin-top:35px">TIME IS BORROWED. LEGACY IS EARNED.</p></div></body></html>`;
}
const equal = (a,b) => {const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && crypto.timingSafeEqual(x,y);};
export function installGrimEmailWorker(app,{supabase,env=process.env}={}) {
  app.post('/api/internal/grim-email-dispatch',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!env.GRIM_EMAIL_WORKER_SECRET || !equal(req.get('x-grim-worker-secret'),env.GRIM_EMAIL_WORKER_SECRET)) return res.status(401).json({error:'UNAUTHORIZED'});
    if(!supabase || !resendConfigured(env)) return res.status(503).json({error:'EMAIL_NOT_CONFIGURED'});
    // Restrict the first run to an explicitly selected queued ID; never dispatch every order accidentally.
    const jobId = Number(req.body?.outbox_id);
    if(!Number.isSafeInteger(jobId) || jobId <= 0) return res.status(400).json({error:'OUTBOX_ID_REQUIRED'});
    const {data:job,error} = await supabase.from('grim_transactional_email_outbox')
      .select('id,order_id,recipient_email,email_type,event_key,status,attempts')
      .eq('id',jobId).single();
    if(error || !job) return res.status(404).json({error:'JOB_NOT_FOUND'});
    if(job.status==='sent') return res.json({ok:true,already_sent:true});
    if(job.status!=='pending') return res.status(409).json({error:'JOB_NOT_PENDING',status:job.status});
    if(job.attempts>=5) return res.status(409).json({error:'ATTEMPT_LIMIT'});
    // Verify before claiming. This route requires a service-role Supabase client, never a public anon key.
    const {data:order,error:orderError} = await supabase.from('orders')
      .select('id,name,total,payment_status,status,email').eq('id',job.order_id).single();
    if(orderError || !order || String(order.payment_status||'').toLowerCase()!=='paid' ||
       String(order.email||'').trim().toLowerCase()!==String(job.recipient_email||'').trim().toLowerCase())
      return res.status(409).json({error:'ORDER_VALIDATION_FAILED'});
    let message;
    try {
      if(job.email_type==='order_confirmed') {
        message={subject:`GRIM | Your Legacy Begins — Order #${order.id}`,
          html:orderEmailHtml({orderId:order.id,customerName:order.name,amount:order.total}),
          text:`RAV’KAEL. Your GRIM order #${order.id} has been confirmed. TIME IS BORROWED. LEGACY IS EARNED.`};
      } else {
        const expected = `order_${String(order.status||'').toLowerCase()}`;
        if(job.email_type!==expected) return res.status(409).json({error:'ORDER_STATUS_CHANGED'});
        message=grimStatusEmail({templateKey:job.email_type,orderId:order.id,customerName:order.name});
      }
    } catch {return res.status(409).json({error:'UNSUPPORTED_TEMPLATE'});}
    // Explicit no-send diagnostic: validates route, auth, DB, order and template.
    // No outbox update or Resend call occurs.
    if (req.body?.dry_run === true) {
      return res.json({ok:true,dry_run:true,outbox_id:job.id,order_id:order.id,ready_to_send:true});
    }
    const {data:claimed,error:claimError} = await supabase.from('grim_transactional_email_outbox')
      .update({status:'processing',attempts:job.attempts+1})
      .eq('id',job.id).eq('status','pending').eq('attempts',job.attempts).select('id');
    if(claimError) return res.status(503).json({error:'CLAIM_FAILED'});
    if(!claimed?.length) return res.status(409).json({error:'ALREADY_CLAIMED'});
    try {
      const result = await sendGrimEmail({...message,to:job.recipient_email,idempotencyKey:`grim_outbox_${job.id}`},{env});
      const {error:saveError} = await supabase.from('grim_transactional_email_outbox')
        .update({status:'sent',sent_at:new Date().toISOString(),provider_message_id:result.messageId,last_error:null})
        .eq('id',job.id).eq('status','processing');
      if(saveError) return res.status(503).json({error:'PROVIDER_ACCEPTED_DB_UPDATE_FAILED',manual_reconciliation_required:true});
      return res.json({ok:true,sent:1,outbox_id:job.id});
    } catch(err) {
      // Do not automatically retry: Resend may have accepted a message before the connection failed.
      await supabase.from('grim_transactional_email_outbox')
        .update({status:'failed',last_error:String(err?.message||err).slice(0,250)})
        .eq('id',job.id).eq('status','processing');
      return res.status(502).json({error:'SEND_FAILED_REVIEW_BEFORE_RETRY',outbox_id:job.id});
    }
  });
}

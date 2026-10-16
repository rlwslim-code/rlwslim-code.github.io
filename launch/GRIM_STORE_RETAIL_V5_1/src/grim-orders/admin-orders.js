// Additive administrative order-management routes. MUST be mounted behind the EXISTING verified admin authorization middleware.
// No authorization is inferred from client input or a customer session.
const allowed = new Set(['processing','shipped','in_transit','out_for_delivery','delivered','under_review','cancelled']);
const normalize = s => String(s||'').trim().toLowerCase();
export function installGrimAdminOrders(app, {supabase, requireAdmin} = {}) {
  if (typeof requireAdmin !== 'function') throw new Error('GRIM admin orders requires the existing trusted admin authorization middleware');
  app.get('/api/admin/grim-orders', requireAdmin, async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!supabase) return res.status(503).json({error:'DATABASE_UNAVAILABLE'});
    const {data,error}=await supabase.from('orders').select('id,created_at,name,email,total,status,payment_status,payment_reference,paid_at').order('created_at',{ascending:false}).limit(100);
    if(error) return res.status(503).json({error:'ORDER_LIST_UNAVAILABLE'});
    return res.json({ok:true,orders:data||[]});
  });
  app.post('/api/admin/grim-orders/:id/status',requireAdmin,async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!supabase) return res.status(503).json({error:'DATABASE_UNAVAILABLE'});
    const id=Number(req.params.id),status=normalize(req.body?.status),reason=String(req.body?.reason||'').trim().slice(0,500);
    if(!Number.isSafeInteger(id)||id<1||!allowed.has(status)) return res.status(400).json({error:'INVALID_REQUEST'});
    if(['cancelled','under_review'].includes(status)&&reason.length<5) return res.status(400).json({error:'REASON_REQUIRED'});
    // DB transaction / lock / audit / outbox are handled atomically by the RPC.
    // Never edit payment_status or issue a refund as a side effect of cancelling.
    const {data,error}=await supabase.rpc('grim_admin_transition_order',{p_order_id:id,p_new_status:status,p_reason:reason});
    if(error) return res.status(409).json({error:'ORDER_UPDATE_FAILED',code:error.code});
    return res.json({ok:true,result:data});
  });
}

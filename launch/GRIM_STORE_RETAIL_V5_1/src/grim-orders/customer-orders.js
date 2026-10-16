// Read-only customer order history. Never accept a customer identifier from the browser.
export function classifyOrder(order) {
  const s = String(order.status || '').toLowerCase();
  const p = String(order.payment_status || '').toLowerCase();
  if (['cancelled', 'canceled', 'void'].includes(s)) return 'cancelled';
  if (['under_review', 'fraud_review', 'on_hold'].includes(s)) return 'under_review';
  if (['delivered', 'received', 'completed'].includes(s)) return 'delivered';
  if (['shipped', 'dispatched', 'in_transit', 'out_for_delivery'].includes(s)) return 'in_transit';
  if (p === 'paid') return 'awaiting_fulfillment';
  return 'payment_pending';
}
export function installGrimCustomerOrders(app, {supabase} = {}) {
  app.get('/api/account/order-history', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const accountId = String(req.session?.user?.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) return res.status(401).json({error:'SIGN_IN_REQUIRED'});
    if (!supabase) return res.status(503).json({error:'ORDER_HISTORY_UNAVAILABLE'});
    try {
      // Resolve the signed-in website account to its uniquely matching profile on the server.
      const {data:profileId,error:mapError}=await supabase.rpc('grim_profile_id_for_account',{p_account_id:accountId});
      if(mapError) return res.status(503).json({error:'ACCOUNT_PROFILE_UNAVAILABLE'});
      if(!profileId) return res.json({ok:true,orders:[]});
      const {data, error} = await supabase.from('orders')
        .select('id,created_at,paid_at,status,payment_status,payment_reference,total_kobo,items_json')
        .eq('customer_id', profileId).order('created_at', {ascending:false}).limit(100);
      if (error) throw error;
      return res.json({ok:true,orders:(data||[]).map(o=>({
        id:o.id,created_at:o.created_at,paid_at:o.paid_at,
        status:o.status,payment_status:o.payment_status,
        payment_reference:o.payment_reference,total_kobo:o.total_kobo,
        items_json:o.items_json,category:classifyOrder(o)
      }))});
    } catch (e) {
      console.error('[GRIM order history]', e?.code || e?.message || e);
      return res.status(503).json({error:'ORDER_HISTORY_UNAVAILABLE'});
    }
  });
}

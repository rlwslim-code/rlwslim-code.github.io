// GRIM luxury transactional status email templates, for integration with Stage 2 worker.
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const messages={
 order_processing:['Your Legacy Is Taking Shape','We are preparing your order.'],
 order_shipped:['Your Legacy Is On Its Way','Your order has been dispatched.'],
 out_for_delivery:['Your Legacy Is Almost Here','Your order is out for delivery.'],
 order_delivered:['Your Legacy Has Arrived','Your order has been marked delivered.'],
 order_cancelled:['An Important Update To Your Order','Your order has been cancelled. If payment was captured, any refund will be handled and confirmed separately.']
};
export function grimStatusEmail({templateKey,orderId,customerName}){
 const m=messages[templateKey];if(!m)throw Error('Unsupported GRIM status email template');
 const title=esc(m[0]),body=esc(m[1]),name=esc(customerName||'GRIM Member'),id=esc(orderId);
 return {subject:`GRIM | ${m[0]} — Order #${orderId}`,text:`RAV’KAEL, ${customerName||'GRIM Member'}. ${m[1]} Order #${orderId}. TIME IS BORROWED. LEGACY IS EARNED.`,html:`<!doctype html><html><body style="background:#0c0b10;color:#f3eee8;font-family:Arial,sans-serif;margin:0;padding:32px"><div style="max-width:560px;margin:auto;border:1px solid #d8b66b;padding:32px;background:#121b2a"><div style="font:700 32px Georgia,serif;letter-spacing:6px;color:#d8b66b">GRIM</div><hr style="border:1px solid #771e37;margin:22px 0"><h1 style="font:normal 26px Georgia,serif">${title}</h1><p>RAV’KAEL, ${name}.</p><p>${body}</p><p style="color:#d8b66b">Order #${id}</p><p style="margin-top:36px;font-size:12px;color:#c2b8ab">TIME IS BORROWED. LEGACY IS EARNED.</p></div></body></html>`};
}

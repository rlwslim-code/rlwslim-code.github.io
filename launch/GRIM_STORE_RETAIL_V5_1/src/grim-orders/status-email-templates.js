import {grimGlassEmail} from './liquid-glass-email.js';
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
 return {subject:`GRIM | ${m[0]} — Order #${orderId}`,text:`RAV’KAEL, ${customerName||'GRIM Member'}. ${m[1]} Order #${orderId}. TIME IS BORROWED. LEGACY IS EARNED.`,html:grimGlassEmail({eyebrow:'ORDER UPDATE',title:m[0],name:customerName||'GRIM Member',body:m[1],details:[['Order',String(orderId)]],footerNote:'Track your order from your GRIM account.'})};
}

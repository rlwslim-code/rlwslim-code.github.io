/* GRIM Checkout Recovery Assist: presentation only, never changes payment status. */
(() => {
  'use strict';
  const area = document.getElementById('recovery');
  if (!area || !document.getElementById('pending')) return;
  let node;
  function update() {
    if (area.hidden) return;
    if (!node) {
      node = document.createElement('section');
      node.className = 'grim-recovery-assist';
      node.setAttribute('aria-label','Checkout recovery options');
      const h = document.createElement('h3');
      h.textContent = 'YOUR ORDER IS SAFE WHILE WE CHECK';
      const p = document.createElement('p');
      p.textContent = 'If you closed Paystack or cancelled, you can leave checkout without losing your bag. An unfinished payment still needs verification before you attempt another charge.';
      const actions = document.createElement('div');
      actions.className = 'grim-recovery-actions';
      const shop = document.createElement('a');
      shop.href = '/shop.html';
      shop.textContent = 'RETURN TO SHOP';
      const support = document.createElement('a');
      support.href = '/support.html';
      support.textContent = 'CONTACT CUSTOMER CARE';
      actions.append(shop,support);
      const note = document.createElement('p');
      note.className = 'grim-recovery-small';
      note.textContent = 'Use CHECK EXISTING PAYMENT above to verify this reference. Leaving this page does not cancel or settle a Paystack transaction. Never retry a mismatched payment before reconciliation.';
      node.append(h,p,actions,note);
    }
    if (node.parentElement !== area) area.appendChild(node);
  }
  update();
  const observer = new MutationObserver(update);
  observer.observe(area,{attributes:true,attributeFilter:['hidden']});
  // The existing checkout code owns payment checks; never intercept payment buttons.
})();
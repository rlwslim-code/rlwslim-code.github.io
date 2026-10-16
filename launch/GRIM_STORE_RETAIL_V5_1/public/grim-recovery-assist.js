/* GRIM compact payment recovery UI. Presentation-only: never changes payment status. */
(() => {
  'use strict';
  const area = document.getElementById('recovery');
  if (!area) return;
  function compact() {
    // Remove the verbose duplicate card injected by earlier releases.
    area.querySelectorAll('.grim-recovery-assist').forEach(el => el.remove());
    const title = area.querySelector(':scope > h2');
    if (title) title.textContent = 'PAYMENT STATUS';
    const intro = area.querySelector(':scope > p');
    if (intro) intro.textContent = 'Verify this payment before trying again.';
    const pending = document.getElementById('pending');
    if (!pending) return;
    const detail = pending.querySelector('.pending-item');
    if (!detail) return;
    const button = [...detail.querySelectorAll('button')].find(el => el.textContent.trim() === 'CHECK EXISTING PAYMENT');
    if (button) button.textContent = 'VERIFY PAYMENT';
    detail.querySelectorAll('.grim-recovery-safety-note').forEach(el => el.remove());
    // Keep one return-to-shop link from the original checkout, never duplicate.
    const links = [...detail.querySelectorAll('.grim-recovery-return')];
    links.slice(1).forEach(el => el.remove());
    let support = area.querySelector('.grim-recovery-support');
    if (!support) {
      support = document.createElement('a');
      support.className = 'grim-recovery-support';
      support.href = '/support.html';
      support.textContent = 'Need help? Contact GRIM';
      area.appendChild(support);
    }
  }
  // Checkout renders the pending result dynamically; observe child changes only.
  const observer = new MutationObserver(() => { observer.disconnect(); compact(); observer.observe(area, {childList:true,subtree:true}); });
  compact();
  observer.observe(area, {childList:true,subtree:true});
})();

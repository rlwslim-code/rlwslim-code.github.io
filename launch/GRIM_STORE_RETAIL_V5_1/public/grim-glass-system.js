/* GRIM · Shared Liquid Glass Touch
 * Zero commerce hooks. No form interception, API calls, data capture or scrolling lock.
 * Uses event delegation: dynamically inserted products and admin records work too.
 */
(() => {
  'use strict';
  if (window.__grimGlassSystem) return;
  window.__grimGlassSystem = {version:'1.0.0', activated:false};
  const doc = document;
  const root = doc.documentElement;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const selector = [
    'button:not(:disabled)',
    '[role="button"]:not([aria-disabled="true"])',
    'input[type="button"]:not(:disabled)',
    'input[type="submit"]:not(:disabled)',
    '.cta', '.grim-launch-primary', '.grim-launch-secondary',
    '.grim-launch-outline', '.grim-launch-product', '.grim-launch-category',
    '.grim-ops__action', '.grim-ops__button', '.grim-ops__row',
    '.gn-button', '.gn-action', '.nav-item', '.primary-button', '.secondary-button',
    '.stat-card', '.grim-ops__metric', '.products .card', '.g6-panel button',
    '[data-grim-glass="interactive"]'
  ].join(',');
  const clamp = (x,a,b) => Math.min(Math.max(x,a),b);
  const canEnhance = el => {
    if (!el || !el.isConnected) return false;
    if (el.closest('[data-grim-glass="off"], [inert], [aria-hidden="true"]')) return false;
    if (el.matches(':disabled,[aria-disabled="true"]')) return false;
    if (el.closest('a[href^="javascript:"]')) return false;
    return true;
  };
  function getSurface(target) {
    const el = target instanceof Element ? target.closest(selector) : null;
    return canEnhance(el) ? el : null;
  }
  function xy(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x=clamp(clientX-rect.left,0,rect.width), y=clamp(clientY-rect.top,0,rect.height);
    return {x,y,w:rect.width,h:rect.height};
  }
  const glints = new WeakMap();
  function ensureGlint(el) {
    let glint = glints.get(el);
    if (!glint || !glint.isConnected) {
      glint = doc.createElement('span');
      glint.className = 'grim-glass-glint';
      glint.setAttribute('aria-hidden', 'true');
      el.append(glint);
      glints.set(el,glint);
    }
    return glint;
  }
  let hovering=null, lastPoint=null, moveFrame=0;
  function leave() {
    if (hovering) hovering.classList.remove('grim-glass-engaged');
    hovering=null;
  }
  function updatePoint() {
    moveFrame=0;
    if (!lastPoint || !hovering || !hovering.isConnected) return;
    const pos=xy(hovering,lastPoint.x,lastPoint.y);
    if (!pos) return;
    hovering.style.setProperty('--grim-glass-x', `${Math.round(pos.x)}px`);
    hovering.style.setProperty('--grim-glass-y', `${Math.round(pos.y)}px`);
  }
  function onMove(event) {
    if (!finePointer.matches || prefersReduced.matches) return;
    const next=getSurface(event.target);
    if(next!==hovering) {
      leave();
      if(next) {
        next.classList.add('grim-glass-interactive','grim-glass-engaged');
        ensureGlint(next);
        hovering=next;
      }
    }
    if(!hovering) return;
    lastPoint={x:event.clientX,y:event.clientY};
    if(!moveFrame) moveFrame=requestAnimationFrame(updatePoint);
  }
  function onPress(event) {
    if (prefersReduced.matches || event.button > 0) return;
    const el=getSurface(event.target);
    if(!el) return;
    const pos=xy(el,event.clientX,event.clientY);
    if(!pos) return;
    el.classList.add('grim-glass-interactive','grim-glass-pressed');
    const wave=doc.createElement('span');
    wave.className='grim-glass-touch-wave';
    wave.setAttribute('aria-hidden','true');
    wave.style.setProperty('--grim-wave-x',`${Math.round(pos.x)}px`);
    wave.style.setProperty('--grim-wave-y',`${Math.round(pos.y)}px`);
    wave.style.setProperty('--grim-wave-size',`${Math.min(210,Math.max(85,Math.hypot(pos.w,pos.h)*.75))}px`);
    wave.addEventListener('animationend',()=>wave.remove(),{once:true});
    el.append(wave);
    // A fallback cleanup if animations are cancelled (e.g. screen locks).
    const cleanup = () => {wave.remove();el.classList.remove('grim-glass-pressed');};
    window.setTimeout(cleanup, 850);
  }
  function boot() {
    if(!doc.body || root.hasAttribute('data-grim-glass-off')) return;
    root.classList.add('grim-glass-ready');
    // Legacy ivory pages retain their light surface palette.
    const color = getComputedStyle(doc.body).backgroundColor;
    const rgb = color.match(/rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
    if(rgb && [Number(rgb[1]),Number(rgb[2]),Number(rgb[3])].every(v=>v>180)) {
      root.classList.add('grim-glass-ivory');
    }
    doc.addEventListener('pointermove',onMove,{passive:true});
    doc.addEventListener('pointerdown',onPress,{passive:true});
    doc.addEventListener('pointerout',event=>{
      if(hovering && (event.target===hovering || hovering.contains(event.target))) {
        const entering=event.relatedTarget;
        if(!(entering instanceof Node) || !hovering.contains(entering)) leave();
      }
    },{passive:true});
    doc.addEventListener('visibilitychange',()=>{if(doc.hidden)leave();});
    window.addEventListener('pagehide',leave,{passive:true});
    window.__grimGlassSystem.activated=true;
  }
  if(doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();

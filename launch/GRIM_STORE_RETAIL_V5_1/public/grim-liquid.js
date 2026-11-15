/* GRIM Chapter I — liquid interaction presentation only.
   Does not modify purchase, navigation, session, account or payment handling. */
(()=>{
  'use strict';
  if(!document.querySelector('.grim-launch-main,#grim-shop,.story-page'))return;
  const motionOK=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer=window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const targets=document.querySelectorAll('.grim-launch-category,.grim-launch-product,.site-header,.shop .card,.grim-launch-hero-media');
  if(motionOK&&finePointer){
    targets.forEach(el=>{
      let raf=0,point=null;
      const update=()=>{
        raf=0;if(!point)return;
        const box=el.getBoundingClientRect();
        const x=Math.max(0,Math.min(100,(point.x-box.left)/box.width*100));
        const y=Math.max(0,Math.min(100,(point.y-box.top)/box.height*100));
        el.style.setProperty('--gl-x',x.toFixed(2)+'%');
        el.style.setProperty('--gl-y',y.toFixed(2)+'%');
      };
      el.addEventListener('pointermove',e=>{
        if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;
        point={x:e.clientX,y:e.clientY};
        if(!raf)raf=requestAnimationFrame(update);
      },{passive:true});
      el.addEventListener('pointerenter',()=>el.classList.add('grim-glass-active'),{passive:true});
      el.addEventListener('pointerleave',()=>{
        el.classList.remove('grim-glass-active');
        point=null;
        if(raf){cancelAnimationFrame(raf);raf=0}
      },{passive:true});
    });
    const hero=document.querySelector('.grim-launch-hero-media');
    if(hero){
      const lens=document.createElement('span');
      lens.className='grim-glass-lens';lens.setAttribute('aria-hidden','true');
      hero.append(lens);
    }
  }
  if(!motionOK)return;
  // Mobile tap/desktop click refraction. Never preventDefault or stopPropagation.
  document.addEventListener('pointerdown',e=>{
    const el=e.target.closest('.grim-launch-primary,.grim-launch-secondary,.grim-launch-outline,.grim-launch-category,.grim-launch-product');
    if(!el||!el.closest('main'))return;
    const box=el.getBoundingClientRect();
    const wave=document.createElement('span');
    wave.className='grim-glass-ripple';wave.setAttribute('aria-hidden','true');
    wave.style.setProperty('--r-x',(e.clientX-box.left)+'px');
    wave.style.setProperty('--r-y',(e.clientY-box.top)+'px');
    el.append(wave);
    wave.addEventListener('animationend',()=>wave.remove(),{once:true});
  },{passive:true});
})();

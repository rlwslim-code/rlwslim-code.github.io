/* GRIM — ABYSS LIVING LIQUID TOUCH (Chapter I restoration)
 * A blue fluid/dye field follows a finger on ANY part of each storefront page.
 * Transparent overlay, pointer-events:none: scrolling, buttons, forms & checkout stay untouched.
 * Self-contained and intentionally independent of commerce code.
 */
(() => {
  'use strict';
  if (window.__grimAbyssLiquidTouch) return;
  window.__grimAbyssLiquidTouch = true;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const doc = document;
  const boot = () => {
    if (!doc.body || doc.getElementById('grim-abyss-fluid-canvas')) return;
    const canvas = doc.createElement('canvas');
    canvas.id = 'grim-abyss-fluid-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none', userSelect: 'none', zIndex: '2147483000',
      mixBlendMode: 'screen', contain: 'strict',
      opacity: '0.94', touchAction: 'auto'
    });
    doc.body.appendChild(canvas);
    const view = canvas.getContext('2d', {alpha:true, desynchronized:true});
    if (!view) {canvas.remove(); return;}
    const fieldCanvas = doc.createElement('canvas');
    const fieldCtx = fieldCanvas.getContext('2d', {willReadFrequently:true});
    if (!fieldCtx) {canvas.remove(); return;}
    let cw=0,ch=0,w=0,h=0,n=0,image=null,ink,inkNext,vx,vy,vxNext,vyNext,last=0,raf=0,live=false;
    const active=new Map();
    const eddies=[]; // dying paired vortices pull blue dye into living curls
    let elapsed=0;
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    function allocate(){
      cw=Math.max(1,window.innerWidth || doc.documentElement.clientWidth);
      ch=Math.max(1,window.innerHeight || doc.documentElement.clientHeight);
      // At most ~18k simulation cells: smooth, fluid motion without heavy mobile GPU usage.
      const cell=Math.max(5,Math.sqrt(cw*ch/16500));
      w=Math.max(35,Math.round(cw/cell));h=Math.max(35,Math.round(ch/cell)); n=w*h;
      canvas.width=cw;canvas.height=ch;
      fieldCanvas.width=w;fieldCanvas.height=h;
      image=fieldCtx.createImageData(w,h);
      ink=new Float32Array(n);inkNext=new Float32Array(n);
      vx=new Float32Array(n);vy=new Float32Array(n);
      vxNext=new Float32Array(n);vyNext=new Float32Array(n);
      view.imageSmoothingEnabled=true;
      live=false;last=0;eddies.length=0;
    }
    allocate();
    function addInk(px,py,dx=0,dy=0,initial=false){
      const gx=px/cw*w, gy=py/ch*h;
      if(gx<0 || gy<0 || gx>w || gy>h)return;
      const radius=initial?10:7;
      const a=initial?2.9:1.55;
      const speed=Math.hypot(dx,dy);
      const ndx=speed?dx/speed:0, ndy=speed?dy/speed:0;
      for(let y=Math.max(1,Math.floor(gy-radius*1.75)); y<=Math.min(h-2,Math.ceil(gy+radius*1.75));y++){
        const yy=(y-gy)/radius;
        for(let x=Math.max(1,Math.floor(gx-radius*1.75));x<=Math.min(w-2,Math.ceil(gx+radius*1.75));x++){
          const xx=(x-gx)/radius;
          const d2=xx*xx+yy*yy;
          if(d2>3.1)continue;
          const fall=Math.exp(-d2*2.4);
          const i=y*w+x;
          ink[i]=Math.min(4,ink[i]+a*fall);
          // Expansion plus curling shear gives motion like liquid, not a CSS tap ripple.
          const twist=initial?8.5:5.5;
          const push=initial?15:5;
          vx[i]+=fall*(xx*push-yy*twist+ndx*18);
          vy[i]+=fall*(yy*push+xx*twist+ndy*18);
        }
      }
      if(initial){
        // Two counter-rotating currents make a tap spread like flowing liquid.
        eddies.push({x:gx-4,y:gy+2,spin:1,age:0});
        eddies.push({x:gx+4,y:gy-2,spin:-1,age:0});
        if(eddies.length>8)eddies.splice(0,eddies.length-8);
      }
      live=true;
      if(!raf){last=0;raf=requestAnimationFrame(tick);}
    }
    function stroke(ax,ay,bx,by,initial=false){
      const length=Math.hypot(bx-ax,by-ay);
      const steps=Math.max(1,Math.min(30,Math.ceil(length/12)));
      const dx=(bx-ax)/steps,dy=(by-ay)/steps;
      for(let s=1;s<=steps;s++)addInk(ax+dx*s,ay+dy*s,dx,dy,initial && s===1);
    }
    function sample(arr,x,y){
      x=clamp(x,0,w-1.001);y=clamp(y,0,h-1.001);
      const ix=x|0,iy=y|0;
      const tx=x-ix,ty=y-iy,idx=iy*w+ix;
      const a=arr[idx]*(1-tx)+arr[idx+1]*tx;
      const b=arr[idx+w]*(1-tx)+arr[idx+w+1]*tx;
      return a*(1-ty)+b*ty;
    }
    function simulate(dt){
      const step=Math.min(.045,dt);
      const velDecay=Math.pow(.976,step*60);
      const dyeDecay=Math.pow(.987,step*60);
      for(const e of eddies)e.age+=step;
      while(eddies.length && eddies[0].age>2.5)eddies.shift();
      // Semi-Lagrangian advection. Dye is transported by its velocity field.
      for(let y=1;y<h-1;y++){
        const row=y*w;
        for(let x=1;x<w-1;x++){
          const i=row+x;
          const atx=x-vx[i]*step,aty=y-vy[i]*step;
          let ux=sample(vx,atx,aty),uy=sample(vy,atx,aty);
          // Tiny local curl preserves twisting movement after finger leaves.
          const curlX=(ink[i+w]-ink[i-w])*.095;
          const curlY=(ink[i+1]-ink[i-1])*.095;
          ux=(ux+curlX)*velDecay;
          uy=(uy-curlY)*velDecay;
          for(const e of eddies){
            const ex=x-e.x,ey=y-e.y,d2=ex*ex+ey*ey;
            if(d2>650)continue;
            const force=Math.exp(-d2/195)*Math.max(0,1-e.age/2.5)*step*60;
            ux+=(-ey*e.spin*.27+ex*.15)*force;
            uy+=(ex*e.spin*.27+ey*.15)*force;
          }
          vxNext[i]=clamp(ux,-36,36);vyNext[i]=clamp(uy,-36,36);
          inkNext[i]=Math.max(0,sample(ink,atx,aty)*dyeDecay);
        }
      }
      [vx,vxNext]=[vxNext,vx];[vy,vyNext]=[vyNext,vy];[ink,inkNext]=[inkNext,ink];
      // Clear temporary buffers (also zeroes the one-cell boundary).
      vxNext.fill(0);vyNext.fill(0);inkNext.fill(0);
    }
    function paint(){
      const data=image.data;
      let max=0;
      for(let i=0,j=0;i<n;i++,j+=4){
        const d=ink[i];if(d>max)max=d;
        if(d<.016){data[j+3]=0;continue;}
        const body=1-Math.exp(-d*.83);
        const x=i%w, y=(i/w)|0;
        const edge=(x>0&&y>0&&x<w-1&&y<h-1)
          ?Math.min(1,(Math.abs(d-ink[i+1])+Math.abs(d-ink[i-1])+Math.abs(d-ink[i+w])+Math.abs(d-ink[i-w]))*.55):0;
        const shine=Math.min(1,edge*.8+Math.sqrt(Math.max(0,body))*.17);
        data[j]=Math.round(6+42*shine);           // dark-blue ink with electric reflections
        data[j+1]=Math.round(42+112*body+84*shine);
        data[j+2]=Math.round(151+82*body+22*shine);
        data[j+3]=Math.round(Math.min(225,body*188+edge*35));
      }
      fieldCtx.putImageData(image,0,0);
      view.clearRect(0,0,cw,ch);
      view.drawImage(fieldCanvas,0,0,cw,ch);
      return max;
    }
    function tick(t){
      raf=0;
      if(doc.hidden){last=0;return;}
      const dt=last?Math.min(.048,(t-last)/1000):1/60;last=t;
      simulate(dt);
      const remaining=paint();
      elapsed+=dt;
      if(remaining>.021 || active.size){raf=requestAnimationFrame(tick);}
      else {live=false;last=0;view.clearRect(0,0,cw,ch);}
    }
    function point(e){return {x:e.clientX,y:e.clientY};}
    // Mouse/pen: only while pressed. Touch handled below for reliable mobile scrolling.
    doc.addEventListener('pointerdown',e=>{
      if(e.pointerType==='touch' || (e.pointerType==='mouse' && e.button!==0))return;
      const p=point(e);active.set('p'+e.pointerId,p);addInk(p.x,p.y,0,0,true);
    },{passive:true,capture:true});
    doc.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch')return;
      const id='p'+e.pointerId,prev=active.get(id);
      if(!prev)return;
      const p=point(e);stroke(prev.x,prev.y,p.x,p.y);active.set(id,p);
    },{passive:true,capture:true});
    for(const event of ['pointerup','pointercancel'])doc.addEventListener(event,e=>{
      if(e.pointerType!=='touch')active.delete('p'+e.pointerId);
    },{passive:true,capture:true});
    // Touch listeners stay passive: no cancelled events, no blocked swipes or clicks.
    doc.addEventListener('touchstart',e=>{
      for(const t of e.changedTouches){const id='t'+t.identifier;const p=point(t);active.set(id,p);addInk(p.x,p.y,0,0,true);}
    },{passive:true,capture:true});
    doc.addEventListener('touchmove',e=>{
      for(const t of e.changedTouches){const id='t'+t.identifier,p=point(t),prev=active.get(id);
        if(prev)stroke(prev.x,prev.y,p.x,p.y);else addInk(p.x,p.y,0,0,true);
        active.set(id,p);
      }
    },{passive:true,capture:true});
    for(const event of ['touchend','touchcancel'])doc.addEventListener(event,e=>{
      for(const t of e.changedTouches)active.delete('t'+t.identifier);
    },{passive:true,capture:true});
    let resizeQueued=0;
    window.addEventListener('resize',()=>{
      if(resizeQueued)cancelAnimationFrame(resizeQueued);
      resizeQueued=requestAnimationFrame(()=>{resizeQueued=0;allocate();active.clear();});
    },{passive:true});
    doc.addEventListener('visibilitychange',()=>{
      if(!doc.hidden && live && !raf){raf=requestAnimationFrame(tick);}
    });
    // Debug/read-only status for deployment testing: no store data exposed.
    window.__grimAbyssTouchStatus=()=>({ready:!!canvas.isConnected,overlay:canvas.style.pointerEvents,grid:[w,h],activeInputs:active.size,liquidVisible:live});
  };
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

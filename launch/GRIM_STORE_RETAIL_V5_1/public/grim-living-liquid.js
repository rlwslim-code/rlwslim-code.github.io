/* GRIM Bloodline x Abyss | organic fluid field, visual-only progressive enhancement. */
(()=>{'use strict';
if(window.__grimLiquidV2)return;window.__grimLiquidV2=true;
const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
const targets='button,a,[role="button"],input[type="submit"],input[type="button"],.filter-chip,.product-card';
const ignore='input,select,textarea,[contenteditable],.care-fab,[disabled],[aria-disabled="true"]';
const active=new WeakMap();let count=0;const MAX=4;
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t)};
const clamp=v=>Math.max(0,Math.min(255,v|0));
function launch(el,e){
 if(reduce.matches||count>=MAX||el.matches(ignore)||el.closest('[inert]'))return;
 const r=el.getBoundingClientRect(),w=r.width,h=r.height;
 if(w<18||h<18||w>950||h>650)return;
 const prior=active.get(el);if(prior)prior();
 // The overlay has NO colored rectangular backdrop: only a soft-edged fluid silhouette.
 const layer=document.createElement('span');layer.className='grim-liquid-surface';layer.setAttribute('aria-hidden','true');
 const canvas=document.createElement('canvas');layer.appendChild(canvas);
 el.classList.add('grim-liquid-host');el.appendChild(layer);
 const ratio=Math.min(0.55,Math.sqrt(18000/(w*h)));const cw=Math.max(16,Math.ceil(w*ratio)),ch=Math.max(12,Math.ceil(h*ratio));
 canvas.width=cw;canvas.height=ch;
 const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:false});if(!ctx){layer.remove();return;}
 const image=ctx.createImageData(cw,ch),pixels=image.data;
 const x0=(Number.isFinite(e.clientX)?e.clientX-r.left:w/2)/w;
 const y0=(Number.isFinite(e.clientY)?e.clientY-r.top:h/2)/h;
 const aspect=w/h,originX=x0*aspect,originY=y0;
 const far=Math.max(Math.hypot(originX,originY),Math.hypot(aspect-originX,originY),Math.hypot(originX,1-originY),Math.hypot(aspect-originX,1-originY));
 const start=performance.now(),duration=1550;
 let frame=0,stopped=false;count++;
 function cleanup(){if(stopped)return;stopped=true;cancelAnimationFrame(frame);layer.remove();active.delete(el);count=Math.max(0,count-1);}
 active.set(el,cleanup);
 function draw(now){if(stopped)return;if(!layer.isConnected){cleanup();return;}
 const t=Math.min(1,(now-start)/duration),growth=smooth(0,.77,t),fade=1-smooth(.76,1,t);
 const reach=(.045+far*1.35*growth),swirl=t*10;
 // Multiple moving lobes form a continuously deforming liquid mass.
 const blobs=[];
 blobs.push([originX,originY,reach*.72,1.5,0]);
 for(let j=0;j<11;j++){
  const a=j*2.399963+swirl*(j%2?-.22:.27);
  const d=reach*(.29+.47*(.5+.5*Math.sin(j*2.7+t*7)));
  const bx=originX+Math.cos(a)*d,by=originY+Math.sin(a)*d;
  blobs.push([bx,by,reach*(.23+.11*Math.sin(j*1.3+t*6)**2),.67,j%2]);
 }
 for(let py=0;py<ch;py++){
  const y=(py+.5)/ch;
  for(let px=0;px<cw;px++){
   const x=(px+.5)/cw*aspect;
   // Advected coordinate field creates folds and travelling fluid currents.
   const dx=x-originX,dy=y-originY;
   const twist=.055*growth*Math.sin(dy*9+swirl)*Math.cos(dx*4-swirl*.7);
   const fx=x+twist,fy=y+.05*growth*Math.cos(dx*8-swirl*.8);
   let field=0,blue=0,red=0;
   for(let j=0;j<blobs.length;j++){
    const b=blobs[j],bx=fx-b[0],by=fy-b[1],q=(bx*bx+by*by)/(b[2]*b[2]+.0001);
    const v=b[3]*Math.exp(-q*1.65);
    field+=v;if(b[4])blue+=v;else red+=v;
   }
   const edge=smooth(.43,.68,field),a=edge*fade;
   const i=(py*cw+px)*4;
   if(a<.006){pixels[i+3]=0;continue;}
   const mix=blue/(blue+red+.0001);
   const ripple=.5+.5*Math.sin(fx*15+fy*7-swirl*1.7);
   const shine=Math.pow(Math.max(0,1-Math.abs(field-.76)*3.5),2)*.40;
   pixels[i]=clamp(174*(1-mix)+23*mix+24*ripple+38*shine);
   pixels[i+1]=clamp(15*(1-mix)+73*mix+15*ripple+40*shine);
   pixels[i+2]=clamp(68*(1-mix)+225*mix+25*ripple+44*shine);
   pixels[i+3]=clamp(235*a);
  }
 }
 ctx.putImageData(image,0,0);
 if(t<1)frame=requestAnimationFrame(draw);else cleanup();
 }
 frame=requestAnimationFrame(draw);setTimeout(cleanup,duration+450);
}
document.addEventListener('pointerdown',e=>{const el=e.target.closest?.(targets);if(el)launch(el,e);},{passive:true,capture:true});
document.addEventListener('keydown',e=>{if(e.repeat||!['Enter',' '].includes(e.key))return;const el=e.target.closest?.(targets);if(el)launch(el,{});},true);
})();

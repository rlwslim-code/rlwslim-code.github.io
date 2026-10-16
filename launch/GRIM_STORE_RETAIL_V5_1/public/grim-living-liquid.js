/* GRIM Living Bloodline x Abyss. Progressive enhancement: visual-only, non-blocking. */
(()=>{'use strict';if(window.__grimLivingLiquid)return;window.__grimLivingLiquid=true;
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const targets='button,a,[role="button"],input[type="submit"],input[type="button"],.product-card,.filter-chip';
const ignored='input,select,textarea,[contenteditable],.care-fab,[disabled],[aria-disabled="true"]';
const TAU=Math.PI*2;let active=0;const LIMIT=5;
function color(hex,a){let n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`}
function begin(el,event){if(reduce.matches||active>=LIMIT||el.matches(ignored)||el.closest('[inert]'))return;
 const box=el.getBoundingClientRect();if(box.width<16||box.height<14||box.width>1100||box.height>1000)return;
 const old=el.querySelector(':scope > .grim-liquid-surface');if(old)old.remove();
 el.classList.add('grim-liquid-host');const surface=document.createElement('span');surface.className='grim-liquid-surface';surface.setAttribute('aria-hidden','true');
 const canvas=document.createElement('canvas');surface.append(canvas);el.append(surface);
 const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.ceil(box.width*dpr);canvas.height=Math.ceil(box.height*dpr);
 const ctx=canvas.getContext('2d',{alpha:true});if(!ctx){surface.remove();return}ctx.scale(dpr,dpr);
 const px=event.clientX!=null?event.clientX-box.left:box.width/2,py=event.clientY!=null?event.clientY-box.top:box.height/2;
 const maxR=Math.hypot(Math.max(px,box.width-px),Math.max(py,box.height-py))*1.22;
 const duration=860,start=performance.now();let raf=0;active++;
 function draw(now){if(!surface.isConnected){active--;return}const t=Math.min((now-start)/duration,1);const fill=1-Math.pow(1-Math.min(t/0.68,1),3);const fade=t<.70?1:Math.max(0,1-(t-.70)/.30);
 ctx.clearRect(0,0,box.width,box.height);ctx.save();ctx.globalCompositeOperation='source-over';
 const r=Math.max(2,maxR*fill);const grd=ctx.createRadialGradient(px,py,0,px,py,r);
 grd.addColorStop(0,color('#b30e48',.84*fade));grd.addColorStop(.32,color('#961a69',.78*fade));grd.addColorStop(.70,color('#183fbd',.72*fade));grd.addColorStop(1,color('#102657',0));
 ctx.fillStyle=grd;ctx.beginPath();ctx.arc(px,py,r,0,TAU);ctx.fill();
 // Moving translucent streams follow curved trajectories and overlap like liquid ink.
 for(let i=0;i<5;i++){const phase=i*TAU/5;const travel=r*(.32+.16*Math.sin(t*8+phase));
 const x=px+Math.cos(phase+t*5)*travel,y=py+Math.sin(phase+t*4.3)*travel*.65;
 const rr=Math.max(4,r*(.24+.07*Math.sin(t*12+i)));const g=ctx.createRadialGradient(x,y,0,x,y,rr);
 g.addColorStop(0,color(i%2?'#1c68e9':'#e01a56',(.38+.10*Math.sin(t*12+i))*fade));g.addColorStop(1,color(i%2?'#1c68e9':'#e01a56',0));
 ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,rr,0,TAU);ctx.fill();}
 // Thin moving specular sheen gives a submerged-glass finish.
 ctx.globalAlpha=.24*fade;ctx.strokeStyle='#b7c5ff';ctx.lineWidth=1.4;ctx.beginPath();ctx.ellipse(px,py,r*.85,r*.30,t*1.5,0,TAU);ctx.stroke();ctx.restore();
 if(t<1)raf=requestAnimationFrame(draw);else{surface.remove();active--;}}
 raf=requestAnimationFrame(draw);
 // When navigation removes a node, still release resources.
 setTimeout(()=>{if(surface.isConnected){cancelAnimationFrame(raf);surface.remove();active=Math.max(0,active-1)}},duration+180);
 }
 document.addEventListener('pointerdown',e=>{const el=e.target.closest?.(targets);if(el)begin(el,e)},{passive:true,capture:true});
 document.addEventListener('keydown',e=>{if(e.repeat||!['Enter',' '].includes(e.key))return;const el=e.target.closest?.(targets);if(el)begin(el,{})},{capture:true});
})();

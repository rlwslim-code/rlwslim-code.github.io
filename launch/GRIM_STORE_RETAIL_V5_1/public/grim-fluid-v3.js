/* GRIM — Bloodline × Abyss living fluid. One viewport-level transparent canvas.
   No rectangular overlay, no pointer interception, no auth/checkout changes. */
(()=>{'use strict';
if(window.__grimFluidV3)return;window.__grimFluidV3=true;
const motion=matchMedia('(prefers-reduced-motion: reduce)');
const eligible='button,a,[role="button"],.filter-chip,.product-card,[type="submit"],[type="button"]';
const blocked='[disabled],[aria-disabled="true"],input,select,textarea,[contenteditable="true"]';
let canvas,ctx,raf=0,flows=[],width=0,height=0,dpr=1,last=0;
const TAU=Math.PI*2,rand=(a,b)=>a+Math.random()*(b-a);
function init(){if(canvas)return;canvas=document.createElement('canvas');canvas.id='grim-fluid-v3-canvas';canvas.setAttribute('aria-hidden','true');canvas.style.cssText='position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483000!important;pointer-events:none!important;background:transparent!important;border:0!important;box-shadow:none!important;mix-blend-mode:screen!important;';document.documentElement.appendChild(canvas);ctx=canvas.getContext('2d',{alpha:true});resize();addEventListener('resize',resize,{passive:true});addEventListener('pagehide',()=>{flows=[];cancelAnimationFrame(raf);raf=0});}
function resize(){if(!canvas)return;dpr=Math.min(devicePixelRatio||1,1.5);width=innerWidth;height=innerHeight;canvas.width=Math.ceil(width*dpr);canvas.height=Math.ceil(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
function spawn(x,y,el){if(motion.matches)return;init();const r=el.getBoundingClientRect();const size=Math.min(180,Math.max(55,Math.hypot(r.width,r.height)*.38));const group={birth:performance.now(),life:1750,particles:[]};
// Dense droplets in two entwined currents; each has its own velocity and undulating edge.
for(let i=0;i<32;i++){const blue=i%2===0;const angle=(i/32)*TAU+rand(-.55,.55);const speed=rand(.025,.16)*size;group.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,r:rand(size*.15,size*.35),phase:rand(0,TAU),blue,seed:rand(.6,1.4)});}
flows.push(group);if(flows.length>5)flows.shift();if(!raf){last=performance.now();raf=requestAnimationFrame(frame);}}
function paintDrop(p,t,fade){const wobble=Math.sin(t*9+p.phase)*p.r*.16;const radius=p.r*(.6+1.1*Math.sin(Math.min(1,t)*Math.PI*.5))+wobble;const x=p.x+p.vx*t*12+Math.sin(t*7+p.phase)*p.r*.32;const y=p.y+p.vy*t*12+Math.cos(t*6+p.phase)*p.r*.30;
const gradient=ctx.createRadialGradient(x,y,0,x,y,Math.max(1,radius));
if(p.blue){gradient.addColorStop(0,`rgba(26,125,255,${.52*fade})`);gradient.addColorStop(.37,`rgba(19,82,215,${.44*fade})`);gradient.addColorStop(.76,`rgba(10,53,171,${.18*fade})`);}else{gradient.addColorStop(0,`rgba(231,24,87,${.54*fade})`);gradient.addColorStop(.38,`rgba(158,9,60,${.45*fade})`);gradient.addColorStop(.76,`rgba(107,7,42,${.18*fade})`);}gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,Math.max(1,radius),0,TAU);ctx.fill();}
function frame(now){raf=0;if(!ctx)return;ctx.clearRect(0,0,width,height);flows=flows.filter(g=>now-g.birth<g.life);for(const group of flows){const t=Math.min(1,(now-group.birth)/group.life);const fade=Math.pow(1-t,1.25);ctx.globalCompositeOperation='screen';for(const p of group.particles)paintDrop(p,t,fade);}ctx.globalCompositeOperation='source-over';if(flows.length)raf=requestAnimationFrame(frame);}
function touch(e){if(motion.matches||e.button>0)return;const el=e.target.closest?.(eligible);if(!el||el.matches(blocked)||el.closest('[inert]'))return;spawn(e.clientX,e.clientY,el);}
document.addEventListener('pointerdown',touch,{capture:true,passive:true});
document.addEventListener('keydown',e=>{if(motion.matches||e.repeat||!['Enter',' '].includes(e.key))return;const el=e.target.closest?.(eligible);if(el&&!el.matches(blocked)){const r=el.getBoundingClientRect();spawn(r.left+r.width/2,r.top+r.height/2,el);}},true);
// Remove legacy per-control overlays that created visible rectangular clipping.
function clearLegacy(){document.querySelectorAll('.grim-liquid-surface').forEach(n=>n.remove());}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',clearLegacy,{once:true});else clearLegacy();
})();

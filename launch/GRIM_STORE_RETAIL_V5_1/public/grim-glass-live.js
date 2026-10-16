/* GRIM living glass: viewport-wide soft fluid blobs; never captures touches. */
(()=>{'use strict';if(window.__GRIM_GLASS_LIVE__)return;window.__GRIM_GLASS_LIVE__=true;
if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
const c=document.createElement('canvas');c.id='grim-glass-live-canvas';c.setAttribute('aria-hidden','true');document.body.appendChild(c);const ctx=c.getContext('2d',{alpha:true});if(!ctx)return;
let W=0,H=0,dpr=1,blobs=[],frame=0,raf=0,visible=true;
function resize(){dpr=Math.min(devicePixelRatio||1,1.5);W=innerWidth;H=innerHeight;c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}resize();addEventListener('resize',resize,{passive:true});
function blob(x,y,red,velocity,scale){return{x,y,vx:(Math.random()-.5)*velocity,vy:(Math.random()-.5)*velocity,r:scale*(.72+Math.random()*.65),age:0,life:70+Math.random()*45,color:red?'198,25,78':'27,118,235',seed:Math.random()*10}}
function spawn(x,y,major){const count=major?16:5;for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,dist=Math.random()*(major?23:12);blobs.push(blob(x+Math.cos(a)*dist,y+Math.sin(a)*dist,i%2===0,major?3.3:1.9,major?40:24))}if(blobs.length>120)blobs.splice(0,blobs.length-120);start()}
function start(){if(!raf&&visible)raf=requestAnimationFrame(draw)}
function draw(){raf=0;ctx.clearRect(0,0,W,H);frame++;for(let i=blobs.length-1;i>=0;i--){const b=blobs[i];b.age++;if(b.age>b.life){blobs.splice(i,1);continue}const t=b.age/b.life,e=Math.sin(Math.PI*t),spread=1+t*1.65,r=b.r*spread,alpha=.32*e;b.vx+=Math.sin(frame*.04+b.seed)*.055;b.vy+=Math.cos(frame*.035+b.seed)*.055;b.vx*=.988;b.vy*=.988;b.x+=b.vx;b.y+=b.vy;const g=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,r);g.addColorStop(0,`rgba(${b.color},${alpha*.95})`);g.addColorStop(.25,`rgba(${b.color},${alpha*.64})`);g.addColorStop(.62,`rgba(${b.color},${alpha*.22})`);g.addColorStop(1,`rgba(${b.color},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,r,0,Math.PI*2);ctx.fill()}
if(blobs.length)start()}
addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;spawn(e.clientX,e.clientY,true)},{passive:true,capture:true});let last=0;addEventListener('pointermove',e=>{if(!e.buttons&&e.pointerType!=='touch')return;const now=performance.now();if(now-last<60)return;last=now;spawn(e.clientX,e.clientY,false)},{passive:true,capture:true});document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)start();else{cancelAnimationFrame(raf);raf=0}});
})();

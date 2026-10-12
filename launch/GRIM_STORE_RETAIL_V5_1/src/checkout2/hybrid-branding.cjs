'use strict';
const colors={obsidian:'#0B0B0D',veil:'#F8F5EE',bloodline:'#A31D32',abyss:'#194A94',voidViolet:'#593475',roseReaper:'#CB6D97',eclipseGold:'#C9A45B'};
const escape=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function email({title,body,cta,href}){
  if(href&&!/^https:\/\/www\.grimwear\.store\//.test(href))throw Error('UNTRUSTED_PAYMENT_LINK');
  return `<!doctype html><html><body style="margin:0;background:${colors.obsidian};color:${colors.veil};font-family:Arial,sans-serif"><main style="max-width:580px;margin:auto;padding:35px 25px"><div style="border-top:3px solid ${colors.eclipseGold};padding-top:26px"><h1 style="letter-spacing:0.3em;color:${colors.veil}">GRIM</h1><div style="height:4px;background:linear-gradient(90deg,${colors.bloodline},${colors.abyss},${colors.voidViolet},${colors.roseReaper},${colors.eclipseGold})"></div><h2 style="color:${colors.eclipseGold}">${escape(title)}</h2><p style="line-height:1.7">${escape(body)}</p>${href?`<a style="background:${colors.eclipseGold};color:${colors.obsidian};padding:13px 22px;display:inline-block" href="${escape(href)}">${escape(cta||'VIEW YOUR ORDER')}</a>`:''}<p style="margin-top:36px;font-size:11px;letter-spacing:.14em">TIME IS BORROWED. LEGACY IS EARNED.</p></div></main></body></html>`;
}
function sms(orderId,status){return `GRIM | Order ${String(orderId).replace(/[^A-Za-z0-9-]/g,'')} — ${String(status).replace(/[^A-Za-z0-9 -]/g,'')}. Track securely in your GRIM account. TIME IS BORROWED. LEGACY IS EARNED.`}
module.exports={colors,email,sms};

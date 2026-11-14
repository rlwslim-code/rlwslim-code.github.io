'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const root = path.resolve(__dirname, '../../public');
const read = file => readFileSync(path.join(root, file), 'utf8');

test('arrival homepage preserves the live account, bag and checkout entry points', () => {
  const html = read('index.html');
  for (const id of ['id="auth"', 'id="checkout"', 'id="bag"', 'id="marketModal"', 'id="grimLaunchFeatured"', 'id="newsForm"']) {
    assert.ok(html.includes(id), `missing ${id}`);
  }
  for (const src of ['/app.js?', '/grim-v6.js?', '/grim-v7.js?', '/checkout2-bridge.js', '/grim-launch.js?']) {
    assert.ok(html.includes(src), `missing ${src}`);
  }
  assert.ok(!html.includes('PREORDER'));
  assert.ok(html.includes('CHAPTER I HAS ARRIVED'));
});

test('launch category deep links correspond to real filter values', () => {
  const home = read('index.html');
  const shop = read('shop.html');
  const expected = [['Hoodie', 'Hoodie'], ['Tee', 'Tee'], ['Complete%20GRIM%20Outfit', 'Complete GRIM Outfit']];
  for (const [url, category] of expected) {
    assert.ok(home.includes(`href="/shop.html?category=${url}"`), `missing ${url}`);
    assert.ok(shop.includes(`<option value="${category}"`), `missing filter option ${category}`);
  }
  assert.match(read('app.js'), /URLSearchParams\(window\.location\.search\)/);
  assert.ok(!shop.includes('PREORDER'));
});

test('all new launch assets and original branded visual assets exist', () => {
  for (const file of ['grim-launch.css', 'grim-launch.js', 'assets/designs/design-18.jpeg', 'assets/designs/design-10.jpeg', 'assets/designs/design-24.jpeg', 'assets/ravkael-art.jpeg', 'assets/grim-primary.png']) {
    assert.ok(existsSync(path.join(root, file)), `missing ${file}`);
  }
});

test('featured catalogue renders active server data without invented availability, and handles failure', async () => {
  class El {
    constructor(tag = 'div') {this.tag = tag;this.children=[];this.textContent='';this.href='';this.className='';this.src='';}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children=children;}
  }
  const featured = new El();
  const document = {getElementById: id => id === 'grimLaunchFeatured' ? featured : null, createElement: tag => new El(tag)};
  const script = read('grim-launch.js');
  let response = {ok:true, json:async()=>[
    {id:18, name:'Obsidian', type:'Hoodie', price:28000, color:'Black', active:1},
    {id:23, name:'Obsidian', type:'Tee', price:18000, color:'Black', active:1},
    {id:8, name:'Obsidian', type:'Armless', price:15000, color:'Black', active:1},
    {id:7, name:'Hidden', type:'Hoodie', price:1, color:'Red', active:0},
  ]};
  const context={document, window:{}, AbortController, setTimeout, clearTimeout,
    fetch:async()=>response, Intl, Number, String, Array, Error, encodeURIComponent};
  runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(featured.children.length,3);
  assert.equal(featured.children[0].tag,'a');
  assert.ok(featured.children[0].href.startsWith('/shop.html?search='));
  assert.equal(featured.children[0].children[1].children[3].children[0].textContent,'₦28,000');
  assert.ok(!JSON.stringify(featured.children).includes('Hidden'));
  // Fail closed instead of inventing stock or prices.
  featured.replaceChildren();
  response={ok:false};
  runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(featured.children.length,1);
  assert.ok(featured.children[0].children[1].href === '/shop.html');
});

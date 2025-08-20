// .github/scripts/codemod.js
const fs = require('fs');
const path = require('path');

const CMD = (process.argv[2] || '').trim();

// Helpers
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'index.html');
const ASSIST = path.join(ROOT, 'freeflow-assistant.js');

// --- Patches ---

function ensureGlassChips(html, on = true) {
  // 1) Nadaj klasę "glass" przyciskom kafelków
  html = html.replace(/(<div class="bottom-buttons"[^>]*>[\s\S]*?<\/div>)/, (m) => {
    let section = m;
    if (on) {
      section = section.replace(/(<button\b[^>]*)(class="[^"]*")?/g, (g1, gOpen, gClass) => {
        const cls = gClass ? gClass.replace(/"$/, ' glass"') : 'class="glass"';
        return g1 + (gClass ? cls : ' ' + cls);
      });
    } else {
      section = section.replace(/\bglass\b/g, '').replace(/\s{2,}/g, ' ');
    }
    return section;
  });

  // 2) Wstrzyknij (albo usuń) definicję .glass w <style>
  if (on) {
    if (!/\.glass\s*\{/.test(html)) {
      html = html.replace(/<\/style>/, `
    .glass{
      background: rgba(0,0,0,.18);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      border:1px solid rgba(255,255,255,.06);
      border-radius:14px;
      box-shadow:0 6px 24px rgba(0,0,0,.35);
    }
  </style>`);
    }
  }
  return html;
}

function toggleCartUI(html, on = true) {
  // Badge koszyka (id="cartBadge") i przycisk (id="cartBtn")
  if (on && !/id="cartBtn"/.test(html)) {
    html = html.replace(/<\/header>/, `
      <div style="position:relative">
        <button class="iconbtn" id="cartBtn" aria-label="Koszyk">🛒</button>
        <div class="badge" id="cartBadge">0</div>
      </div>
    </header>`);
  }
  if (!on) {
    html = html.replace(/<div style="position:relative">[\s\S]*?<\/div>\s*<\/header>/, `</header>`);
    html = html.replace(/id="cartBadge"[\s\S]*?<\/div>/, '');
  }
  return html;
}

function setBackendUrl(js, url) {
  return js.replace(
    /(BACKEND_URL:\s*['"])([^'"]+)(['"])/,
    (_m, p1, _old, p3) => p1 + url + p3
  );
}

// --- Router komend ---

function apply(cmd) {
  // Normalizacja
  const c = (cmd || '').trim();

  if (/^\/ui\s+help/i.test(c)) {
    console.log(`Available:
  /ui glass-chips on|off
  /ui cart on|off
  /ui backend https://example.com
`);
    return;
  }

  if (/^\/ui\s+glass-chips\s+on/i.test(c)) {
    const html = read(INDEX);
    write(INDEX, ensureGlassChips(html, true));
    console.log('✓ glass chips ON');
    return;
  }
  if (/^\/ui\s+glass-chips\s+off/i.test(c)) {
    const html = read(INDEX);
    write(INDEX, ensureGlassChips(html, false));
    console.log('✓ glass chips OFF');
    return;
  }

  if (/^\/ui\s+cart\s+on/i.test(c)) {
    write(INDEX, toggleCartUI(read(INDEX), true));
    console.log('✓ cart ON');
    return;
  }
  if (/^\/ui\s+cart\s+off/i.test(c)) {
    write(INDEX, toggleCartUI(read(INDEX), false));
    console.log('✓ cart OFF');
    return;
  }

  const m = c.match(/^\/ui\s+backend\s+(https?:\/\/\S+)/i);
  if (m) {
    write(ASSIST, setBackendUrl(read(ASSIST), m[1]));
    console.log('✓ backend set to', m[1]);
    return;
  }

  console.log('No matching command:', c);
}

// --- Run ---
apply(CMD);

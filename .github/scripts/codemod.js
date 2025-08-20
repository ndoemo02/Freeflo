// .github/scripts/codemod.js
// Uruchamiane przez GH Actions. Edytuje index.html według komend ChatOps.
//
// PRZYKŁADY KOMEND (w komentarzu do Issue/PR, jako 1. linia):
//   /ui glass-chips on
//   /ui glass-chips off
//   /ui add-menu "Twoje zamówienia"
//   /ui add-menu "Koszyk"
//   /help
//
// Skrypt jest defensywny: nie duplikuje wstawek, działa idempotentnie.

const fs   = require('fs');
const path = require('path');

const CMD = (process.argv[2] || 'help').trim();

const ROOT   = process.cwd();
const INDEX  = path.join(ROOT, 'index.html');

// ---------- helpers ----------
function readFile(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, 'utf8');
}
function writeFile(p, s) {
  fs.writeFileSync(p, s, 'utf8');
  console.log(`✔ wrote ${p}`);
}
function has(str, needle) {
  return str.includes(needle);
}
function ensureStyleBlock(html, css) {
  // Wstrzykuj <style>...</style> tuż przed </head>, jeśli nie istnieje nasz znacznik
  const MARK = '/* chatops:inject */';
  if (has(html, MARK)) return html;

  const style = `
  <style>
    ${MARK}
    ${css}
  </style>`;
  return html.replace(/<\/head>/i, style + '\n</head>');
}

// ---------- patches ----------
function patchGlassChips(html, turnOn = true) {
  // 1) Upewnij się, że istnieje klasa .glass o lekkiej przezroczystości
  const glassCSS = `
    .glass{background:rgba(0,0,0,.18);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
      border:1px solid rgba(255,255,255,.06);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.35);}
  `;
  html = ensureStyleBlock(html, glassCSS);

  // 2) Nadaj/usuń klasę "glass" z kafelków i baniek
  // - sekcje przycisków (kafelki na dole)
  html = html.replace(
    /(<div\s+class="bottom-buttons"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/main>|<div\s+class="bottom-buttons"[^>]*>[\s\S]*?<\/div>)/,
    (m) => {
      // w środku: <button class="..."> — dodaj/usuń glass
      return m.replace(/(<button[^>]*class=")([^"]*)(")/g, (_m, g1, cls, g3) => {
        const hasGlass = /\bglass\b/.test(cls);
        if (turnOn && !hasGlass) cls += ' glass';
        if (!turnOn && hasGlass) cls = cls.replace(/\bglass\b/g, '').replace(/\s+/g, ' ').trim();
        return g1 + cls + g3;
      });
    }
  );

  // 3) Bąbel transkrypcji
  html = html.replace(/(<div[^>]+id="transcript"[^>]*class=")([^"]*)(")/,
    (_m, g1, cls, g3) => {
      const hasGlass = /\bglass\b/.test(cls);
      if (turnOn && !hasGlass) cls += ' glass';
      if (!turnOn && hasGlass) cls = cls.replace(/\bglass\b/g, '').replace(/\s+/g, ' ').trim();
      return g1 + cls + g3;
    }
  );

  // 4) Dropdown (jeśli jest)
  html = html.replace(/(<div[^>]+id="dropdown"[^>]*class=")([^"]*)(")/,
    (_m, g1, cls, g3) => {
      const hasGlass = /\bglass\b/.test(cls);
      if (turnOn && !hasGlass) cls += ' glass';
      if (!turnOn && hasGlass) cls = cls.replace(/\bglass\b/g, '').replace(/\s+/g, ' ').trim();
      return g1 + cls + g3;
    }
  );

  return html;
}

function patchAddMenuItem(html, label) {
  // Wstaw "div.dd-item" do menu z id="dropdown". Jeśli brak menu — tworzymy proste menu.
  const itemHtml = `\n          <div class="dd-item">${escapeHtml(label)}</div>`;
  const dropdownRegex = /(<div[^>]+id="dropdown"[^>]*>)([\s\S]*?)(<\/div>)/i;

  if (dropdownRegex.test(html)) {
    html = html.replace(dropdownRegex, (m, start, inner, end) => {
      if (inner.includes(label)) {
        console.log('• Menu already contains:', label);
        return m;
      }
      return start + inner + itemHtml + '\n' + end;
    });
  } else {
    // Minimalny fallback – proste menu w topbar
    const topbarRegex = /(<header[^>]*class="topbar"[^>]*>[\s\S]*?<\/header>)/i;
    const inject = `
      <div class="menu-wrap">
        <button class="iconbtn" aria-label="Menu">☰</button>
        <div id="dropdown" class="dropdown glass">
          <div class="dd-item">${escapeHtml(label)}</div>
        </div>
      </div>`;
    if (topbarRegex.test(html)) {
      html = html.replace(topbarRegex, (m) => m.replace(/<\/div>\s*<\/header>/i, inject + '\n</div></header>'));
    }
  }
  return html;
}

// ---------- utils ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

function usage() {
  console.log(`
ChatOps codemods — komendy:
  /ui glass-chips on          - włącz przezroczyste kafelki i bąbel
  /ui glass-chips off         - wyłącz przezroczyste kafelki i bąbel
  /ui add-menu "Twoje zamówienia"  - dodaj pozycję do dropdowna
  /help                       - pokaż pomoc
`);
}

// ---------- main ----------
(function main(){
  let html = readFile(INDEX);

  const parts = CMD.split(/\s+/);
  const ns = parts[0]; // np. "ui" lub "help"

  if (ns === 'help') {
    usage();
    return;
  }

  if (ns === 'ui') {
    const action = parts[1]; // "glass-chips" | "add-menu"
    if (action === 'glass-chips') {
      const state = (parts[2] || 'on').toLowerCase();
      const on = state !== 'off';
      html = patchGlassChips(html, on);
      writeFile(INDEX, html);
      return;
    }

    if (action === 'add-menu') {
      // label po action to reszta argumentu w cudzysłowie lub bez
      const labelMatch = CMD.match(/add-menu\s+["“”]?(.+?)["“”]?$/i);
      const label = (labelMatch && labelMatch[1]) ? labelMatch[1].trim() : 'Twoje zamówienia';
      html = patchAddMenuItem(html, label);
      writeFile(INDEX, html);
      return;
    }

    console.log('Nieznana akcja UI:', action);
    usage();
    return;
  }

  console.log('Nieznane polecenie:', CMD);
  usage();
})();

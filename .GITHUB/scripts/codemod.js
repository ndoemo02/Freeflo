// .github/scripts/codemod.js
const fs = require('fs');

const CMD = (process.argv[2] || '').trim();

function read(p) { return fs.existsSync(p) ? fs.readFileSync(p,'utf8') : ''; }
function write(p, s) { fs.writeFileSync(p, s, 'utf8'); }

function patchIndexHtmlGlass(html, on=true) {
  // Dodaj klasę .glass do kafelków dolnych (buttons) i unifikuj ich styl
  // 1) upewnij się, że przyciski mają klasę 'glass'
  html = html.replace(/(<div class="bottom-buttons"[\s\S]*?<button)( class="([^"]*)")?/g, (m, g1, g2, g3)=>{
    const cls = g3 || '';
    return g1 + ' class="' + (cls.includes('glass') ? cls : (cls ? cls+' glass' : 'glass')) + '"';
  });

  // 2) W sekcji <style> – wstrzyknij/zmień definicję .glass i hover
  // jeśli już jest .glass, zostaw; inaczej dodaj
  if (!/\.glass\{/.test(html)) {
    html = html.replace(/<\/style>/, `
    .glass{
      background: rgba(0,0,0,.18);
      border:1px solid rgba(255,255,255,.10);
      border-radius:14px;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow:0 8px 34px rgba(0,0,0,.35);
    }
    </style>`);
  } else if (on) {
    // podmień tło i border, dołóż blur
    html = html.replace(/\.glass\{[^}]*\}/m, `.glass{
      background: rgba(0,0,0,.18);
      border:1px solid rgba(255,255,255,.10);
      border-radius:14px;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow:0 8px 34px rgba(0,0,0,.35);
    }`);
  }

  return html;
}

function addMenuItem(html, label, id='myOrdersBtn') {
  // Znajdź dropdown
  if (!/id="dropdown"/.test(html)) return html;
  if (html.includes(`id="${id}"`)) return html; // już dodane

  html = html.replace(
    /(id="dropdown"[^>]*>)/,
    `$1\n          <div class="dd-item" id="${id}">${label}</div>`
  );

  // dodaj prosty handler na dole (jeśli nie istnieje)
  if (!new RegExp(`getElementById\\('${id}'\\)`).test(html)) {
    html = html.replace(/<\/script>\s*<\/body>/i, `
<script>
  document.getElementById('${id}')?.addEventListener('click', ()=>{
    alert('${label} (tryb demo)');
  });
</script>
</body>`);
  }
  return html;
}

(function main(){
  const indexPath = 'index.html';
  let html = read(indexPath);
  if (!html) {
    console.error('index.html not found');
    process.exit(1);
  }

  if (/^\/ui\s+glass-chips\s+(on|off)/i.test(CMD)) {
    const on = /on$/i.test(CMD);
    html = patchIndexHtmlGlass(html, on);
    write(indexPath, html);
    console.log(`[codemod] glass-chips -> ${on ? 'ON' : 'OFF'}`);
    return;
  }

  if (/^\/menu\s+add\s+["“](.+?)["”]/i.test(CMD)) {
    const label = CMD.match(/^\/menu\s+add\s+["“](.+?)["”]/i)[1].trim();
    html = addMenuItem(html, label);
    write(indexPath, html);
    console.log(`[codemod] added menu item -> ${label}`);
    return;
  }

  console.log('[codemod] no-op. Commands:\n  /ui glass-chips on|off\n  /menu add "Twoje zamówienia"');
})();

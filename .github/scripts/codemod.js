// .github/scripts/codemod.js
// ChatOps codemod – wstrzykuje dymek (transkrypcja + podgląd zamówienia),
// pulsowanie logo/mic podczas nasłuchu i fix tap-highlight na Androidzie.

const fs   = require('fs');
const path = require('path');

const CMD  = (process.argv[2] || '').trim();
const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'index.html');
const APP   = path.join(ROOT, 'app.js');          // główny skrypt UI
const ASSIST= path.join(ROOT, 'freeflow-assistant.js'); // asystent/NLU (jeśli masz)
const CART  = path.join(ROOT, 'cart.js');         // opcjonalnie

function read(p){ return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }
function write(p,s){ fs.writeFileSync(p, s, 'utf8'); }

function upsert(str, markerStart, markerEnd, payload){
  const s = `<!-- ${markerStart} -->`;
  const e = `<!-- ${markerEnd} -->`;
  let out = str;
  const has = str.includes(s) && str.includes(e);
  if (has){
    out = out.replace(
      new RegExp(`${s}[\\s\\S]*?${e}`,'m'),
      `${s}\n${payload}\n${e}`
    );
  } else {
    // próbujemy tuż przed </body> lub na końcu
    if (out.includes('</body>')){
      out = out.replace('</body>', `${s}\n${payload}\n${e}\n</body>`);
    } else {
      out += `\n${s}\n${payload}\n${e}\n`;
    }
  }
  return out;
}

/* ------------------ Wstrzyknięcia do index.html ------------------ */

const BUBBLE_HTML = `
<div id="ff-bubble" aria-live="polite" aria-atomic="true" class="bubble">
  <div id="ff-transcript">Powiedz lub kliknij pozycję z menu…</div>
  <pre id="ff-order" hidden></pre>
</div>
`;

const UI_CSS = `
<style id="ff-ui-patch">
  /* Dymek */
  .bubble {
    position: fixed; right: 1rem; top: 6.5rem; z-index: 50;
    padding: .9rem 1rem; border-radius: 1rem; backdrop-filter: blur(10px);
    background: rgba(0,0,0,.45); color:#fff; max-width: min(88vw,520px);
    box-shadow: 0 6px 24px rgba(0,0,0,.25);
  }
  #ff-order { margin:.25rem 0 0; white-space: pre-wrap;
     font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  /* Pulsowanie podczas nasłuchu */
  @keyframes ff-pulse {
    from { transform: scale(1);   box-shadow: 0 0 0 0 rgba(255,140,0,.55) }
    to   { transform: scale(1.03); box-shadow: 0 0 20px 12px rgba(255,140,0,0) }
  }
  .listening #ff-logo, .listening #micBtn {
    animation: ff-pulse 900ms ease-in-out infinite alternate;
  }

  /* Tap highlight / zaznaczanie – Android */
  * { -webkit-tap-highlight-color: transparent; }
  a, button { outline: none; }
  img, svg { -webkit-user-drag: none; user-select: none; }
  body { -webkit-user-select:none; -ms-user-select:none; user-select:none; }
  input, textarea, [contenteditable="true"] { user-select:text !important; }
</style>
`;

/* ------------------ Wstrzyki JS (helpery w indexie) ------------------ */
const BUBBLE_HELPERS = `
<script id="ff-ui-helpers">
  (function(){
    function $(id){ return document.getElementById(id); }
    window._ff = window._ff || {};

    _ff.show = function(text){
      var t = $('ff-transcript'); if (t) t.textContent = text || '';
    };

    _ff.renderOrder = function(r){
      var o = $('ff-order'); if (!o) return;
      if (!r){ o.hidden = true; o.textContent=''; return; }
      var items = (r.items||[]).map(function(i){
        var wo = (i.without && i.without.length) ? (' (bez: ' + i.without.join(', ') + ')') : '';
        return '• ' + (i.qty || 1) + ' × ' + (i.name || 'pozycja') + wo;
      }).join('\\n') || '• (brak pozycji)';
      o.textContent = 'Restauracja: ' + (r.restaurant_name || r.restaurant_id || '–')
        + '\\n' + items + '\\nCzas: ' + (r.when || '–');
      o.hidden = false;
    };
  })();
</script>
`;

/* ------------------ Patcher index.html ------------------ */
function patchIndex(){
  let html = read(INDEX);
  if(!html) return false;

  // 1) Dymek HTML
  html = upsert(html, 'FF:BUBBLE-START', 'FF:BUBBLE-END', BUBBLE_HTML.trim());

  // 2) CSS i anty-highlight
  html = upsert(html, 'FF:UI-CSS-START', 'FF:UI-CSS-END', UI_CSS.trim());

  // 3) Helpery JS
  html = upsert(html, 'FF:UI-HELPERS-START', 'FF:UI-HELPERS-END', BUBBLE_HELPERS.trim());

  // 4) Dodaj id do logo jeśli go brak (pierwszy obrazek z nazwą freeflow)
  html = html.replace(
    /<img([^>]*)(src="[^"]*freeflow[^"]*png"[^>]*)>/i,
    (m,g1,g2)=> `<img${g1.replace(/\s+id="ff-logo"/,'')} id="ff-logo" ${g2}>`
  );

  write(INDEX, html);
  return true;
}

/* ------------------ Patcher app.js / assistant.js ------------------ */

function ensureMicHooks(filePath){
  if (!fs.existsSync(filePath)) return false;
  let js = read(filePath);

  // onstart/onend – ustaw/usuń klasę .listening + komunikaty
  if (!/onstart\s*=\s*/.test(js) || !/onend\s*=\s*/.test(js)){
    // Pragmatycznie: próbujemy dodać wrapper nad start/stop Web Speech API
    // Szukamy konstrukcji rozpoznawania mowy
    if (!/new\s+webkitSpeechRecognition|new\s+SpeechRecognition/i.test(js)){
      // nic nie robimy – projekt może mieć inny mechanizm
    }
  }

  // Uniwersalne hooki – dodamy globalne funkcje jeżeli są wołane w Twoim kodzie
  if (!js.includes('function ffOnSpeechStart()')){
    js += `

/* FF hooks – nasłuch */
function ffOnSpeechStart(){
  try{ document.documentElement.classList.add('listening'); }catch(e){}
  if (window._ff && _ff.show) _ff.show('🎙️ Słucham…');
}
function ffOnSpeechEnd(){
  try{ document.documentElement.classList.remove('listening'); }catch(e){}
}
function ffOnPartialTranscript(t){
  if (window._ff && _ff.show) _ff.show(t||'');
}
function ffOnFinalTranscript(t){
  if (window._ff && _ff.show) _ff.show(t||'');
}
`;
  }

  write(filePath, js);
  return true;
}

function wireOrderPreviewTargets(){
  // renderOrder wywołamy w asystencie: po NLU i po zmianie koszyka
  // Spróbujmy podedytować freeflow-assistant.js i cart.js
  let touched = false;

  if (fs.existsSync(ASSIST)){
    let a = read(ASSIST);

    if (!/renderOrder\s*\(/.test(a)){
      // heurystyka: po funkcji, która zwraca wynik NLU / sendToAssistant
      a = a.replace(/(function\s+sendToAssistant\s*\([^\)]*\)\s*\{[\s\S]*?)(\n\})/,
        (m,g1,g2)=> g1 + `\n  try{ if(window._ff && _ff.renderOrder) _ff.renderOrder(result); }catch(e){}\n` + g2
      );
      // inne miejsce: gdy wynik NLU dostępny jako 'r'
      a = a.replace(/(\br\s*=\s*await\s+[^\n;]+;[^\n]*\n)/,
        `$1  try{ if(window._ff && _ff.renderOrder) _ff.renderOrder(r); }catch(e){}\n`
      );
      write(ASSIST, a);
      touched = true;
    }
  }

  if (fs.existsSync(CART)){
    let c = read(CART);
    if (!/renderOrder\s*\(/.test(c)){
      c = c.replace(/(function\s+updateCartUI\s*\([^\)]*\)\s*\{)/,
        `$1\n  try{ if(window._ff && _ff.renderOrder) _ff.renderOrder(window.currentOrder); }catch(e){}\n`
      );
      write(CART, c);
      touched = true;
    }
  }

  return touched;
}

/* ------------------ Główne sterowanie ------------------ */
function applyAll(){
  const a = patchIndex();
  const b = ensureMicHooks(APP);
  const c = ensureMicHooks(ASSIST);
  const d = wireOrderPreviewTargets();

  console.log('codemod done:', {index:a, app:b, assistant:c, orderPreview:d});
}

function help(){
  console.log(`
Usage:
  node .github/scripts/codemod.js "/ui bubble"
  node .github/scripts/codemod.js "/ui full"

Komendy:
  /ui bubble   – dymek + CSS + helpery + hooki (zalecane)
  /ui full     – to samo (alias)
`.trim());
}

if (/^\/ui\s+(bubble|full)/.test(CMD)) applyAll();
else help();

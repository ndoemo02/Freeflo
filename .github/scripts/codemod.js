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
      var o

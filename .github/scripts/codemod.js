// .github/scripts/codemod.js
const fs = require('fs');
const path = require('path');

const CMD = (process.argv[2] || '').trim();

// Helpers
const ROOT = process.cwd();
const INDEX = ['index.html','Index.html','INDEX.html']
  .map(f => path.join(ROOT, f)).find(p => fs.existsSync(p));
const APPJS = ['app.js','App.js','scripts/app.js','assets/app.js']
  .map(f => path.join(ROOT, f)).find(p => fs.existsSync(p));

function read(p){ return fs.existsSync(p) ? fs.readFileSync(p,'utf8') : ''; }
function write(p,s){ fs.writeFileSync(p,s,'utf8'); console.log('write', path.relative(ROOT,p)); }

// ---- Patches ----
function ensureMicButton(html){
  if (!html) return html;
  // usuń anchor/overlay na całą stronę (powód "niebieskiego" podświetlenia)
  html = html.replace(/<a([^>]*?)id=["']?micBtn["']?([^>]*)>([\s\S]*?)<\/a>/i, '<button id="micBtn" class="mic-btn no-tap">$3</button>');
  if (!/id=["']micBtn["']/.test(html)){
    // wstaw przycisk mikrofonu w okolice nagłówka/logo
    html = html.replace(/(<body[^>]*>)/i, `$1
      <button id="micBtn" class="mic-btn no-tap" aria-label="Mikrofon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0h-2zM11 19v3h2v-3h-2z"/>
        </svg>
      </button>
    `);
  }
  // dymki: transkrypcja + zamówienie
  if (!/id=["']liveTranscript["']/.test(html) || !/id=["']orderSummary["']/.test(html)){
    html = html.replace(/(<\/body>)/i, `
      <div id="liveTranscript" class="glass-bubble" aria-live="polite" style="display:none"></div>
      <div id="orderSummary" class="glass-bubble small" style="display:none"></div>
      $1
    `);
  }
  return html;
}

function ensureStyles(html){
  if (!html) return html;
  if (html.includes('/* freeflow-voice-styles */')) return html;
  const css = `
  <style id="freeflow-voice-styles">
  /* freeflow-voice-styles */
  .no-tap{ -webkit-tap-highlight-color:transparent; }
  .mic-btn{ position:fixed; top:20px; right:20px; z-index:50; border:0; outline:0;
    width:56px; height:56px; border-radius:16px; background:rgba(255,255,255,.06);
    color:#fff; backdrop-filter:blur(10px); box-shadow:0 8px 24px rgba(0,0,0,.25);
    display:flex; align-items:center; justify-content:center; }
  .mic-btn.pulse::after{ content:""; position:absolute; inset:0; border-radius:16px;
    animation:pulse 1.3s ease-out infinite; box-shadow:0 0 0 0 rgba(255,153,0,.55); }
  @keyframes pulse { to { box-shadow:0 0 0 18px rgba(255,153,0,0); } }

  .glass-bubble{ position:fixed; left:16px; right:16px; bottom:124px; z-index:45;
    padding:14px 16px; border-radius:18px; background:rgba(20,20,20,.55); color:#fff;
    backdrop-filter:blur(14px); box-shadow:0 10px 30px rgba(0,0,0,.25); font-size:15px; }
  .glass-bubble.small{ bottom:64px; opacity:.95; }
  </style>`;
  // wstrzykniemy tuż przed </head> lub na początku <body>
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, css + '\n</head>');
  return html.replace(/(<body[^>]*>)/i, '$1\n' + css);
}

function ensureSpeechJS(appJs){
  if (!appJs) return appJs;
  if (appJs.includes('handleFinalTranscript(')) return appJs; // już wstawione

  const block = `
// === FreeFlow Voice (interim + final) ===
(function(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('micBtn');
  const live = document.getElementById('liveTranscript');
  const orderBox = document.getElementById('orderSummary');

  function show(el, text){ if(!el) return; el.style.display = text ? 'block':'none'; el.textContent = text || ''; }
  function addToCartSimple(item){
    try {
      window.cart = window.cart || [];
      window.cart.push(item);
      // jeżeli masz własny renderer koszyka – wywołaj go tutaj:
      if (window.updateCartBadge) window.updateCartBadge();
    } catch(e){}
  }

  function handleFinalTranscript(text){
    const lower = text.toLowerCase();
    const qty = (lower.match(/\\b(\\d+)\\s*x?\\b/) || [, '1'])[1];
    const time = (lower.match(/\\b([01]?\\d|2[0-3]):[0-5]\\d\\b/) || [, '—'])[1];
    let dish = lower.replace(/\\b(\\d+)\\s*x?\\b/, '').replace(/\\bna\\s+[01]?\\d:[0-5]\\d\\b/,'').trim();
    if (!dish) dish = 'pozycja';
    show(orderBox, \`Zamówienie: \${qty} × \${dish} • Czas: \${time}\`);
    addToCartSimple({ name: dish, qty: Number(qty), time });
  }

  function ensureSR(){
    if (!SR){ show(live, 'Ta przeglądarka nie wspiera rozpoznawania mowy.'); return null; }
    const r = new SR();
    r.lang = 'pl-PL';
    r.interimResults = true;
    r.maxAlternatives = 1;
    return r;
  }

  function startListen(){
    const r = ensureSR(); if (!r) return;
    micBtn && micBtn.classList.add('pulse');
    show(live, 'Słucham…');

    let finalText = '';

    r.onresult = (e)=>{
      let interim=''; 
      for(let i=e.resultIndex;i<e.results.length;i++){
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) finalText += (finalText?' ':'') + t; else interim += t + ' ';
      }
      if (interim) show(live, interim);
      if (finalText){
        show(live, finalText + ' ✔');
        handleFinalTranscript(finalText);
        finalText = '';
      }
    };
    r.onerror = (e)=> show(live, 'Błąd: '+e.error);
    r.onend   = ()=> { micBtn && micBtn.classList.remove('pulse'); setTimeout(()=>show(live,''), 1200); };
    r.start();
  }

  if (micBtn) micBtn.addEventListener('click', startListen);
})();
  // === /FreeFlow Voice ===
`;
  return appJs + '\n' + block;
}

// ---- Driver ----
function runVoiceOn(){
  if (!INDEX) throw new Error('Nie znaleziono index.html');
  let html = read(INDEX);
  html = ensureMicButton(html);
  html = ensureStyles(html);
  write(INDEX, html);

  let js = APPJS ? read(APPJS) : '';
  if (APPJS){
    js = ensureSpeechJS(js);
    write(APPJS, js);
  } else {
    // jeśli brak app.js – utwórz minimalny
    const target = path.join(ROOT, 'app.js');
    write(target, ensureSpeechJS('// app bootstrap\\n'));
  }
}

function main(){
  console.log('CMD:', CMD);
  if (CMD.startsWith('/ui voice-on')) {
    runVoiceOn();
    return;
  }
  if (CMD.startsWith('/ui test')){
    // przykładowa mała modyfikacja sprawdzająca działanie
    if (!INDEX) throw new Error('Nie znaleziono index.html');
    let html = read(INDEX).replace(/Złóż zamówienie/,'Złóż zamówienie 🚀');
    write(INDEX, html);
    return;
  }
  // brak dopasowania — nic nie rób, żeby job nie padł
  console.log('Nieznane polecenie, brak zmian.');
}

main();

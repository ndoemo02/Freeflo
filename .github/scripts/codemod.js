// .github/scripts/codemod.js
const fs   = require('fs');
const path = require('path');

const CMD = (process.argv[2] || '/help').trim();

// Helpers
const read  = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');
const ROOT  = process.cwd();

// Pliki projektu – dopasuj nazwę jeśli u Ciebie inaczej
const INDEX = path.join(ROOT, 'index.html');
const ASSIST= path.join(ROOT, 'freeflow-assistant.js');

// ---- Patches ----

/** Nadaje klasę .glass kafelkom + wstrzykuje styl gdy brak */
function ensureGlassChips(html, enable = true) {
  // 1) Dopisz klasę "glass" na przyciski szybkich akcji
  html = html.replace(
    /(<div class="bottom-buttons"[^>]*>[\s\S]*?)(<\/div>\s*<\/main>)/,
    (m, g1, g2) => {
      let section = g1;
      section = section.replace(/<button([^>]*?)class="([^"]*?)"([^>]*)>/g, (_m, a1, cls, a3) => {
        const has = cls.includes('glass');
        const newCls = enable ? (has ? cls : (cls + ' glass')) : cls.replace(/\bglass\b/g, '').replace(/\s{2,}/g,' ').trim();
        return `<button${a1}class="${newCls}"${a3}>`;
      });
      return section + g2;
    }
  );

  // 2) Dorzuć definicję .glass jeśli nie istnieje
  const hasGlass = /\.glass\s*\{/.test(html);
  if (enable && !hasGlass) {
    html = html.replace(/<\/style>/, `
    .glass{
      background: rgba(0,0,0,.18);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border:1px solid rgba(255,255,255,.06);
      box-shadow:0 10px 32px rgba(0,0,0,.35), inset 0 0 24px rgba(0,0,0,.25);
    }
    </style>`);
  }
  return html;
}

/** Przywraca topbar z menu i koszykiem (jeśli brakuje) */
function ensureMenuCart(html) {
  if (/id="menuBtn"/.test(html) && /id="cartBtn"/.test(html)) {
    return html; // wygląda, że już jest
  }
  // Wstawiam uproszczony blok topbaru tuż po <body>
  return html.replace(/<body[^>]*>/, (m) => m + `
  <header class="topbar">
    <div>
      <div class="brand">
        <img src="./Freeflow-logo.png" alt="logo" style="width:36px;height:36px;border-radius:8px"/>
        <span class="accent">Free</span>Flow
      </div>
      <div class="claim">Voice to order</div>
    </div>
    <div class="actions">
      <div class="menu-wrap">
        <button class="iconbtn" id="menuBtn" aria-label="Menu">☰</button>
        <div id="dropdown" class="dropdown glass">
          <div class="dd-item expand" id="payExpand">Płatność</div>
          <div class="dd-sub" id="paySub">
            <div class="dd-item" data-pay="card">Karta</div>
            <div class="dd-item" data-pay="blik">BLIK</div>
            <div class="dd-item" data-pay="paypal">PayPal</div>
          </div>
          <div class="dd-item" id="ordersBtn">Twoje zamówienia</div>
          <div class="dd-item" id="settingsBtn">Ustawienia</div>
          <div class="dd-item" id="helpBtn">Pomoc</div>
        </div>
      </div>
      <div style="position:relative">
        <button class="iconbtn" id="cartBtn" aria-label="Koszyk">🛒</button>
        <div class="badge" id="cartBadge">0</div>
      </div>
    </div>
  </header>
  `);
}

/** Szybsza transkrypcja – najpierw pokaż tekst użytkownika, potem dopiero wynik NLU */
function tweakAssistant(js, fast = true) {
  if (!js) return js;
  // show(...) tuż po kliknięciu/rozpoznaniu — wyświetl input usera
  js = js.replace(
    /window\.sendToAssistant\s*=\s*async function\s*\(text\)\s*\{[\s\S]*?show\('[^']*'\);\s*\/\/ upewnij się, że backend żyje/,
    (m) => m.replace(/show\('[^']*'\);/, fast
      ? `show(text || '…'); // fast transcript`
      : `show('⏳ Przetwarzam…'); // normal`
    )
  );
  return js;
}

/** Pasek podsumowania zamówienia (czytelne ładowanie when/items) */
function summarizeBox(html) {
  if (/id="transcript"/.test(html)) return html;
  return html.replace(/<main class="wrap">/, (m)=> m + `
    <div id="transcript" class="bubble glass">Powiedz lub kliknij pozycję z menu…</div>
  `);
}

// ---- Router komend ----

function applyCommand(cmd) {
  const base = cmd.split(/\s+/)[0];

  if (base === '/help') {
    console.log(`
Dostępne komendy:
/ui glass on        – szklane (przezroczyste) kafelki
/ui glass off       – wyłącz szklane kafelki
/ui menu            – przywróć topbar z menu i koszykiem
/ui fast on         – szybkie echo transkryptu (najpierw pokazuje tekst usera)
/ui fast off        – klasyczne "Przetwarzam..."
/ui summary         – upewnij się, że jest bąbel z podsumowaniem
    `.trim());
    return;
  }

  if (base === '/ui') {
    const [, feature, state] = cmd.split(/\s+/);
    // Operujemy na index.html / freeflow-assistant.js
    let html = read(INDEX);
    let js   = read(ASSIST);

    if (!html) {
      console.log('index.html nie znaleziony – nic do zrobienia.');
      return;
    }

    switch (feature) {
      case 'glass': {
        const on = (state || '').toLowerCase() !== 'off';
        html = ensureGlassChips(html, on);
        write(INDEX, html);
        console.log(`OK: glass ${on ? 'ON' : 'OFF'}`);
        break;
      }
      case 'menu': {
        html = ensureMenuCart(html);
        write(INDEX, html);
        console.log('OK: menu + koszyk dopięte');
        break;
      }
      case 'fast': {
        const on = (state || '').toLowerCase() !== 'off';
        js = tweakAssistant(js, on);
        if (js) write(ASSIST, js);
        console.log(`OK: fast transcript ${on ? 'ON' : 'OFF'}`);
        break;
      }
      case 'summary': {
        html = summarizeBox(html);
        write(INDEX, html);
        console.log('OK: transcript / summary box dopięty');
        break;
      }
      default:
        console.log('Nieznana opcja /ui. Użyj: /help');
    }
    return;
  }

  console.log('Nieznana komenda. Użyj /help.');
}

// ---- Run ----
applyCommand(CMD);

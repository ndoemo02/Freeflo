// ===== KATEGORIE (klik) =====
const catsEl = document.getElementById('cats');
const panelEl = document.getElementById('panel');
const panelText = document.getElementById('panelText');
const panelIcon = document.getElementById('panelIcon');
const logoEl = document.getElementById('logo');

let currentType = 'food';
catsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat');
  if (!btn) return;
  document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentType = btn.dataset.type;
  showInfo(`Wybrano: ${btn.textContent.trim()} — tryb testowy (mock).`, 'info');
});

// ===== PANEL helper =====
function showInfo(text, type='info'){
  panelText.textContent = text;
  panelEl.classList.remove('hidden', 'err');
  panelIcon.textContent = (type==='err') ? '✖' : 'ℹ️';
  if(type==='err') panelEl.classList.add('err');
  clearTimeout(showInfo._t);
  showInfo._t = setTimeout(()=>panelEl.classList.add('hidden'), 5500);
}

// ===== WEB SPEECH API =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'pl-PL';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    logoEl.classList.add('listening');
    showInfo('Słucham… mów swój wybór (np. „zarezerwuj stolik na dziś, taxi na 20:00”).','info');
  };

  recognition.onresult = (ev) => {
    let finalText = '';
    for (const res of ev.results) {
      if (res.isFinal) finalText += res[0].transcript;
    }
    const interim = ev.results[ev.results.length-1][0].transcript;
    panelEl.classList.remove('hidden','err');
    panelIcon.textContent = '🎤';
    panelText.textContent = finalText || interim || '…';

    // gdy mamy final — tu podpiąć backend
    if (finalText){
      handleCommand(finalText);
    }
  };

  recognition.onerror = (e) => {
    showInfo(`Błąd rozpoznawania: ${e.error}`, 'err');
  };

  recognition.onend = () => {
    listening = false;
    logoEl.classList.remove('listening');
  };
} else {
  // brak wsparcia (Safari/Firefox mobile)
  showInfo('Uwaga: rozpoznawanie działa w Chrome/Edge. Na iOS użyj „Otwórz w Chrome” lub dodaj do ekranu głównego.', 'info');
}

// Klik w logo: start/stop
logoEl.addEventListener('click', () => {
  if (!recognition){ 
    showInfo('Brak wsparcia Web Speech API w tej przeglądarce.', 'err');
    return;
  }
  try{
    if (!listening) recognition.start();
    else recognition.stop();
  }catch(e){
    // Chrome bywa wrażliwy na wielokrotne start() — zignoruj
  }
});

// ===== DEMO: obsługa komendy (tu podepniesz backend) =====
async function handleCommand(text){
  // Prosty routing po kategorii (na razie mock)
  const nice = text.trim();
  const tag = currentType === 'food' ? 'food' : currentType === 'taxi' ? 'taxi' : 'hotel';
  // TODO: podpiąć prawdziwy endpoint i podać `nice` + `tag`.

  // Pokaż “udane” wrażenie
  showInfo(`✅ ${tag}: ${nice} (mock — backend włączymy po kluczu).`, 'info');
}

// ===== Opcjonalnie: ping backend (żeby nie straszył czerwonym błędem) =====
(async function pingBackend(){
  const url = 'https://snd-vercel.vercel.app/api/health'; // podmień na własne / wyłącz
  try{
    const ctrl = new AbortController();
    setTimeout(()=>ctrl.abort(), 2500);
    const r = await fetch(url, {signal: ctrl.signal});
    if(!r.ok) throw new Error();
  }catch(_){
    // Nie wyświetlaj czerwonego boxa stale – pokaż tylko info
    // showInfo('Order błąd: Failed to fetch (tryb offline / mock).', 'err');
  }
})();

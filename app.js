// ====== UI refs ======
const catsEl = document.getElementById('cats');
const panelEl = document.getElementById('panel');
const panelText = document.getElementById('panelText');
const panelIcon = document.getElementById('panelIcon');
const logoEl = document.getElementById('logo');

// ====== helper: panel ======
function showInfo(text, type='info', keepMs=5500){
  panelText.textContent = text;
  panelEl.classList.remove('hidden','err');
  panelIcon.textContent = (type==='err') ? '✖' : 'ℹ️';
  if(type==='err') panelEl.classList.add('err');
  clearTimeout(showInfo._t);
  if (keepMs) showInfo._t = setTimeout(()=>panelEl.classList.add('hidden'), keepMs);
}

// ====== Kategorie (mock) ======
let currentType = 'food';
catsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat');
  if (!btn) return;
  document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentType = btn.dataset.type;
  showInfo(`Wybrano: ${btn.textContent.trim()} — tryb testowy (mock).`, 'info');
});

// ====== Web Speech + pre-autoryzacja mikrofonu ======
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let micPrimed = false;   // czy mamy już zgodę getUserMedia

async function primeMicOnce(){
  if (micPrimed || !navigator.mediaDevices?.getUserMedia) return true;
  try{
    await navigator.mediaDevices.getUserMedia({ audio: true });
    micPrimed = true;
    return true;
  }catch(err){
    showInfo('Odmowa dostępu do mikrofonu. Włącz mikrofon w przeglądarce i spróbuj ponownie.', 'err', 7000);
    return false;
  }
}

function ensureRecognition(){
  if (!SpeechRecognition) {
    showInfo('Ta przeglądarka nie wspiera rozpoznawania mowy (Web Speech). Użyj Chrome/Edge.', 'err', 7000);
    return null;
  }
  if (recognition) return recognition;

  recognition = new SpeechRecognition();
  recognition.lang = 'pl-PL';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    logoEl.classList.add('listening');
    showInfo('Słucham… powiedz np. „zarezerwuj stolik na dziś” lub „taxi na 20:00”.','info', 0);
  };

  recognition.onresult = (ev) => {
    let finalText = '';
    let interimText = '';
    for (const res of ev.results) {
      if (res.isFinal) finalText += res[0].transcript;
      else interimText = res[0].transcript;
    }
    panelEl.classList.remove('hidden','err');
    panelIcon.textContent = '🎤';
    panelText.textContent = finalText || interimText || '…';

    if (finalText) handleCommand(finalText);
  };

  recognition.onerror = (e) => {
    // typowy: "no-speech", "aborted", "network", "not-allowed"
    showInfo(`Błąd rozpoznawania: ${e.error}`, 'err', 6000);
  };

  recognition.onend = () => {
    listening = false;
    logoEl.classList.remove('listening');
    // domknij panel po chwili, jeśli to był tylko nasłuch
    if (!panelEl.classList.contains('err')) {
      clearTimeout(showInfo._t);
      showInfo._t = setTimeout(()=>panelEl.classList.add('hidden'), 1200);
    }
  };

  return recognition;
}

async function toggleListen(){
  const ok = await primeMicOnce();
  if (!ok) return;

  const rec = ensureRecognition();
  if (!rec) return;

  try{
    if (!listening) rec.start();
    else rec.stop();
  }catch(_){ /* Chrome potrafi rzucić gdy start() za szybko — ignoruj */ }
}

// obsłuż tapnięcia w logo (różne eventy na mobile)
['click','touchstart'].forEach(evt =>
  logoEl.addEventListener(evt, (e)=>{ e.preventDefault(); toggleListen(); }, {passive:false})
);

// ====== Demo „obsługa komendy” (tu podłączysz backend) ======
function handleCommand(text){
  const tag = currentType === 'food' ? 'food' : currentType === 'taxi' ? 'taxi' : 'hotel';
  showInfo(`✅ ${tag}: ${text.trim()} (mock — backend do podpięcia).`, 'info', 4500);
}

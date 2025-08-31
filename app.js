// >>> USTAW SWÓJ BACKEND:
const BASE_URL = "https://freeflow-backend-vercel.vercel.app";

const els = {
  mic: document.getElementById('micBtn'),
  query: document.getElementById('query'),
  send: document.getElementById('sendBtn'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
};

let rec, listening = false;
try {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    rec = new SR();
    rec.lang = "pl-PL";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join(' ');
      if (text) els.query.value = text;
    };
    rec.onend = () => { listening = false; els.mic.classList.remove('active'); info("Koniec nasłuchiwania."); };
  }
} catch {}

document.querySelectorAll('.tile').forEach(tile=>{
  tile.addEventListener('click', ()=>{
    els.query.value = tile.dataset.example || "";
    els.query.focus();
  });
});

els.mic.addEventListener('click', ()=>{
  if (!rec) return warn("Przeglądarka nie wspiera rozpoznawania mowy.");
  if (!listening) {
    try { rec.start(); listening = true; els.mic.classList.add('active'); info("Słucham… powiedz zamówienie."); }
    catch(e){ warn("Nie mogę uruchomić mikrofonu."); }
  } else {
    try { rec.stop(); } catch {}
  }
});

els.send.addEventListener('click', submit);
els.query.addEventListener('keydown', (e)=>{ if(e.key==='Enter') submit(); });

async function submit() {
  const q = (els.query.value || "").trim();
  if (!q) { error("Podaj treść zamówienia."); return; }
  info("Wysyłam…");

  const plan = await postJson('/api/plan', { query: q });
  if (plan.error) { return showError(plan.error); }

  renderPlan(plan);

  // jeżeli jedzenie – dociągnij propozycje miejsc
  if (plan.intent === 'food') {
    const cityHint = (plan.entities?.cities?.[0]) || '';
    const placesQ = cityHint ? `pizzeria ${cityHint}` : 'pizzeria';
    const places = await getJson(`/api/places?query=${encodeURIComponent(placesQ)}&n=3&language=pl`);
    renderPlaces(places);
  }
}

function renderPlan(plan) {
  const pills = [
    plan.intent && `<span class="pill">intencja: ${plan.intent}</span>`,
    plan.entities?.time?.raw && `<span class="pill">${plan.entities.time.raw}</span>`,
    plan.entities?.date && `<span class="pill">${plan.entities.date.slice(0,10)}</span>`,
    plan.entities?.count && `<span class="pill">${plan.entities.count} szt.</span>`,
    plan.from && `<span class="pill">z: ${plan.from}</span>`,
    plan.to && `<span class="pill">do: ${plan.to}</span>`,
  ].filter(Boolean).join(' ');

  const steps = (plan.steps||[]).map(s=>`
    <div class="row">
      <div><strong>${s.service}</strong></div>
      <div class="hint">${s.message}</div>
    </div>`).join('') || `<div class="hint">Brak dalszych kroków.</div>`;

  els.result.innerHTML = `
    <h3>Plan</h3>
    <div>${pills || '<span class="hint">Brak rozpoznanych szczegółów</span>'}</div>
    ${steps}
  `;
  ok("OK.");
}

function renderPlaces(places) {
  if (!places?.results?.length) {
    els.result.innerHTML += `<div class="row"><div class="hint">Brak propozycji miejsc.</div></div>`;
    return;
  }
  els.result.innerHTML += `<h3 style="margin-top:14px">Propozycje</h3>`;
  places.results.slice(0,3).forEach(p=>{
    els.result.innerHTML += `
      <div class="row">
        <div>
          <div><strong>${p.name}</strong></div>
          <div class="hint">${p.address || ''}</div>
        </div>
        <div class="hint">⭐ ${p.rating ?? '-'} (${p.votes ?? 0})</div>
      </div>`;
  });
}

/* ───── helpers ───────────────────────────────────────── */
async function postJson(path, body) {
  try {
    const res = await fetch(BASE_URL + path, {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(()=> ({}));
    if (!res.ok) return { error: json.error || res.statusText || 'request_failed' };
    return json;
  } catch (e) { return { error: 'network_error' }; }
}

async function getJson(path) {
  try {
    const res = await fetch(BASE_URL + path);
    const json = await res.json().catch(()=> ({}));
    if (!res.ok) return { error: json.error || res.statusText || 'request_failed' };
    return json;
  } catch (e) { return { error: 'network_error' }; }
}

function showError(code){
  const map = {
    rate_limited: "Za dużo zapytań – spróbuj za chwilę.",
    empty_query: "Podaj treść zamówienia.",
    network_error: "Błąd sieci – sprawdź połączenie.",
  };
  error(map[code] || `Błąd: ${code}`);
}
function info(m){ els.status.textContent = m; els.status.style.color = "#9aa3ad"; }
function ok(m){ els.status.textContent = m; els.status.style.color = "#35d49a"; }
function warn(m){ els.status.textContent = m; els.status.style.color = "#eab308"; }
function error(m){ els.status.textContent = m; els.status.style.color = "#ff6b6b"; }

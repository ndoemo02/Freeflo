/* ===== Konfiguracja ===== */
const CONFIG = {
  // Ustaw swój endpoint. Jeśli nie działa, polecimy MOCK.
  // Przykład dla Vercel: "https://snd-vercel.vercel.app/api/order"
  BACKEND_URL: localStorage.getItem("ff_backend") || "",
  // Ping do sprawdzenia dostępu/CORS:
  PING_URL: localStorage.getItem("ff_ping") || "",
};

const els = {
  micBtn: document.getElementById("micBtn"),
  logo: document.getElementById("logo"),
  transcript: document.getElementById("transcript"),
  result: document.getElementById("resultCard"),
  alert: document.getElementById("alert"),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

/* ====== INIT ====== */
function initASR(){
  if(!SpeechRecognition){
    setTranscript("Rozpoznawanie mowy nie jest wspierane w tej przeglądarce. Użyj Chrome/Edge.");
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "pl-PL";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (e)=>{
    let finalText = "";
    for (const res of e.results){
      const t = res[0].transcript.trim();
      if(res.isFinal){ finalText += t + " "; }
      setTranscript(res.isFinal ? finalText : t);
    }
  };

  recognition.onend = async ()=>{
    toggleUI(false);
    const text = els.transcript.textContent.trim();
    if(text && text !== "Powiedz, co chcesz zamówić…"){
      const parsed = parseUtterance(text);
      await handleOrder(parsed, text);
    }
  };

  recognition.onerror = (e)=>{
    toggleUI(false);
    showError(`Rozpoznawanie mowy: ${e.error}`);
  };
}

function setTranscript(t){ els.transcript.textContent = t || "…" }
function toggleUI(listen){
  isListening = listen;
  els.logo.classList.toggle("listening", listen);
}

/* ====== Klik / Start ====== */
els.micBtn.addEventListener("click", ()=>{
  if(!recognition){ initASR(); }
  try{
    if(!isListening){ recognition.start(); toggleUI(true); setTranscript("Słucham…"); }
    else { recognition.stop(); }
  }catch(_){}
});

/* ====== Szybkie kafelki ====== */
document.querySelectorAll("[data-quick]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const kind = btn.dataset.quick; // food/taxi/hotel
    const payload = { intent: kind, count: 1, time: null, destination: null, item: (kind==="food"?"pizza":"") };
    await handleOrder(payload, kind);
  });
});

/* ====== Parsowanie proste PL (demo) ====== */
function parseUtterance(t){
  const low = t.toLowerCase();

  // liczba sztuk (0..9)
  let count = 1;
  const map = { "jedna":1,"jeden":1,"dwie":2,"dwa":2,"trzy":3,"cztery":4,"pięć":5,"szesc":6,"sześć":6,"siedem":7,"osiem":8,"dziewięć":9,"dziewiec":9 };
  for(const k of Object.keys(map)){ if(new RegExp(`\\b${k}\\b`).test(low)) { count = map[k]; break; } }
  const numMatch = low.match(/\b(\d)\b/g); if(numMatch) count = Number(numMatch.at(-1));

  // godzina HH:MM lub “na 19/19:00”
  let time=null;
  const m1 = low.match(/\b(\d{1,2})[:\.](\d{2})\b/);
  const m2 = low.match(/\bna\s+(\d{1,2})(?:[:\.]?00)?\b/);
  if(m1){ time = `${m1[1].padStart(2,"0")}:${m1[2]}` }
  else if(m2){ time = `${String(m2[1]).padStart(2,"0")}:00` }

  // intent + item/destination
  let intent=null, item=null, destination=null;
  if(/\btaxi\b|\btaks|dojazd/.test(low)){ intent="taxi"; destination = (low.match(/do\s+([a-ząćęłńóśżź\- ]{3,})/i)||[])[1] || null; }
  else if(/\bhotel|nocleg/.test(low)){ intent="hotel"; destination = (low.match(/w\s+([a-ząćęłńóśżź\- ]{3,})/i)||[])[1] || null; }
  else { intent="food"; item = (low.match(/\b(pizza|pepperoni|capricciosa|makaron|burger|pierogi|kebab)\b/i)||[])[1] || "posiłek"; }

  return { intent, count, time, destination, item };
}

/* ====== Zamówienie: BACKEND -> fallback MOCK + TTS ====== */
async function handleOrder(parsed, rawText){
  clearError();
  const payload = { text: rawText, ...parsed };

  // Spróbuj BACKENDu
  let usedMock = false;
  let data = null;

  try{
    if(CONFIG.PING_URL){
      // szybki ping, żeby od razu wiedzieć, czy nie ma CORS
      await fetch(CONFIG.PING_URL, {mode:"cors"});
    }
    if(CONFIG.BACKEND_URL){
      const res = await fetch(CONFIG.BACKEND_URL, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(payload),
      });
      if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      data = await res.json();
    } else {
      usedMock = true;
    }
  }catch(err){
    usedMock = true;
    showError(`Backend niedostępny: ${err.message || "Failed to fetch"} (tryb mock).`);
  }

  if(usedMock){
    data = buildMockResponse(parsed);
  }

  // pokaż kartę i powiedz
  showResult(data);
  speak(buildTTS(data));
}

function buildMockResponse(p){
  if(p.intent==="taxi"){
    return {
      status:"gotowe",
      type:"taxi",
      destination: p.destination || "centrum",
      time: p.time || "15 min",
      price: "demo",
    };
  }
  if(p.intent==="hotel"){
    return {
      status:"gotowe",
      type:"hotel",
      destination: p.destination || "Warszawa",
      time: p.time || "dzisiaj",
      price: "demo",
    };
  }
  return {
    status:"gotowe",
    type:"food",
    item: p.item || "pizza",
    count: p.count || 1,
    time: p.time || "18:00",
    price: "demo",
  };
}

function showResult(data){
  const r = els.result; r.style.display="block";
  if(data.type==="food"){
    r.innerHTML = `✅ <b>Status:</b> ${data.status} &nbsp;•&nbsp; 🍕 <b>Danie:</b> ${data.count} × ${escapeHtml(data.item)} &nbsp;•&nbsp; ⏰ <b>Czas:</b> ${data.time} &nbsp;•&nbsp; 💲 <b>Cena:</b> ${data.price}`;
  }else if(data.type==="taxi"){
    r.innerHTML = `✅ <b>Status:</b> ${data.status} &nbsp;•&nbsp; 🚕 <b>Kierunek:</b> ${escapeHtml(data.destination)} &nbsp;•&nbsp; ⏰ <b>Czas:</b> ${data.time}`;
  }else{
    r.innerHTML = `✅ <b>Status:</b> ${data.status} &nbsp;•&nbsp; 🏠 <b>Miasto:</b> ${escapeHtml(data.destination)} &nbsp;•&nbsp; ⏰ <b>Termin:</b> ${data.time}`;
  }
}

function buildTTS(d){
  if(d.type==="food")  return `Potwierdzam. ${d.count} ${d.item} na ${d.time}.`;
  if(d.type==="taxi")  return `Zamawiam taxi w kierunku ${d.destination}.`;
  if(d.type==="hotel") return `Szukam noclegu w ${d.destination}.`;
  return "Przyjęto.";
}

function speak(text){
  try{
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "pl-PL";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }catch(_){}
}

/* ====== Helpers ====== */
function showError(msg){ els.alert.textContent = msg; els.alert.className = "bubble alert error"; }
function clearError(){ els.alert.textContent=""; els.alert.className = "bubble alert"; }
function escapeHtml(s){ return s?.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])) ?? "" }

/* Auto-init */
initASR();

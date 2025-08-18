/* freeflow-assistant.js
 * Minimalny asystent: ASR (mowa->tekst) + NLU (backend) + TTS (mowa z tekstu)
 * Działa mobilnie na Chrome/Edge (Web Speech API). Ma lekki fallback, gdy ASR niedostępny.
 */

const CONFIG = {
  // >>> PODMIEŃ na swój backend (masz go na Vercel)
  BACKEND_URL: "https://freeflow-backend-vercel.vercel.app",
  // <<< tylko to zmieniasz w razie potrzeby
};

// ---------- Pomocnicze ----------
const $ = (id) => document.getElementById(id);
const $bubble = $("transcript");
const $micBtn = $("micBtn");
const $tts = $("ttsPlayer"); // w HTML istnieje <audio id="ttsPlayer">
let recognizing = false;

// Uproszczone logowanie do bąbla
function setBubble(html) {
  $bubble.innerHTML = html;
}
function setBubbleText(txt) {
  $bubble.textContent = txt;
}

// Ładna prezentacja zamówienia zamiast surowego JSON
function renderOrder(parsed) {
  // oczekiwane pola z Twojego NLU:
  // { restaurant_name, items:[{name, qty, without?}], when, note?, keep_data? }
  if (!parsed || !parsed.items) {
    setBubble("🤔 <b>Nie udało się rozpoznać zamówienia.</b>");
    return;
  }
  const itemsList = parsed.items
    .map(
      (i) =>
        `<li>${i.qty || 1} × <b>${i.name}</b>${
          i.without && i.without.length
            ? ` <small>(bez: ${i.without.join(", ")})</small>`
            : ""
        }</li>`
    )
    .join("");

  const when = parsed.when ? parsed.when : "jak najszybciej";
  const rest = parsed.restaurant_name ? parsed.restaurant_name : "—";

  setBubble(`
    <div style="line-height:1.35">
      <div>🟢 <b>Zamówienie przyjęte</b></div>
      <div>Restauracja: <b>${rest}</b></div>
      <ul style="margin:8px 0 4px 18px">${itemsList}</ul>
      <div>Czas: <b>${when}</b></div>
      ${parsed.note ? `<div>Notatka: ${parsed.note}</div>` : ""}
    </div>
  `);
}

// Mów odpowiedź (proste TTS przeglądarkowe)
function speak(text) {
  try {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } else {
      // Gdybyś wolał backendowe /api/tts – tu możesz zawołać i odtworzyć w <audio>
      // zostawiam proste przeglądarkowe na teraz
    }
  } catch {}
}

// ---------- HEALTH CHECK ----------
async function checkHealth() {
  try {
    const r = await fetch(`${CONFIG.BACKEND_URL}/api/health`, {
      cache: "no-store",
    });
    const j = await r.json();
    if (j && j.status === "ok") {
      setBubble(`✅ Backend: ok`);
      return true;
    }
  } catch (e) {
    // ignore
  }
  setBubble("⚠️ Backend niedostępny");
  return false;
}

// ---------- NLU ----------
async function sendToNLU(text) {
  const url = `${CONFIG.BACKEND_URL}/api/nlu`;
  const body = { text };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) throw new Error(`NLU HTTP ${r.status}`);
    const j = await r.json();

    // Spodziewany shape: { ok:true, parsed:{...}, raw:"..." }
    if (j.ok && j.parsed) {
      renderOrder(j.parsed);
      // krótki voice feedback:
      const firstItem = j.parsed.items?.[0]?.name || "zamówienie";
      speak(`OK. ${firstItem}. Wysyłam do restauracji.`);
    } else {
      setBubble(
        `🤔 Nie zrozumiałem. <small>${j.error || "spróbuj powiedzieć inaczej"}</small>`
      );
      speak("Nie zrozumiałem. Spróbuj jeszcze raz.");
    }
  } catch (err) {
    setBubble(
      `❌ Błąd NLU. <small>${(err && err.message) || String(err)}</small>`
    );
  }
}

// Udostępniam globalnie – do klików z kafelków
window.sendToAssistant = (text) => {
  if (typeof text !== "string" || !text.trim()) return;
  setBubble(`🧠 ${text}`);
  sendToNLU(text);
};

// ---------- ASR (Web Speech API) ----------
let recognition = null;
(function prepareASR() {
  const SR =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    window.mozSpeechRecognition ||
    window.msSpeechRecognition;
  if (!SR) {
    // Brak natywnego ASR – fallback: prompt po kliknięciu
    $micBtn.addEventListener("click", () => {
      const text = prompt("Powiedz/napisz zamówienie:");
      if (text && text.trim()) {
        setBubble(`🧠 ${text}`);
        sendToNLU(text);
      } else {
        setBubble("🙂 ASR niedostępny – wpisz tekst ręcznie.");
      }
    });
    return;
  }

  recognition = new SR();
  recognition.lang = "pl-PL";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    recognizing = true;
    setBubble("🎤 Słucham...");
    // wizualny stan mikrofonu (opcjonalnie można dodać klasę CSS)
  };

  recognition.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += chunk;
      else interim += chunk;
    }
    if (interim) setBubbleText("🎙️ " + interim);
    if (final) {
      setBubble("🧠 " + final);
      sendToNLU(final);
    }
  };

  recognition.onerror = (e) => {
    recognizing = false;
    setBubble("😕 ASR błąd: " + e.error);
  };

  recognition.onend = () => {
    recognizing = false;
    // nic – czekamy na kolejne kliknięcie
  };

  // Klik mikrofonu – start/stop
  $micBtn.addEventListener("click", () => {
    try {
      if (!recognizing) {
        recognition.start();
      } else {
        recognition.stop();
      }
    } catch (e) {
      // jeśli "not-allowed" itp.
      setBubble("⚠️ Nie mam dostępu do mikrofonu.");
    }
  });
})();

// ---------- Szybkie akcje (kafelki) mogą zawołać window.sendToAssistant ----------
document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const t = btn.dataset.quick;
    window.sendToAssistant(`Zamówienie: ${t}. Pomóż dokończyć szczegóły.`);
  });
});

// ---------- Start ----------
(async () => {
  await checkHealth();
})();

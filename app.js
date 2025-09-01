// app.js — FreeFlow (front)
// ------------------------------------------------------------
// Założenia:
// - index.html ma elementy: #tileFood, #tileTaxi, #tileHotel, #transcript, #banner, #micBtn
// - meta[name="gmaps-proxy"] -> URL backendu /api/places (Vercel)
// - meta[name="gpt-proxy"]   -> URL backendu /api/gpt
// - TTS: backend /api/tts (ten sam host co /api/places -> bierzemy z URL-a meta i zamieniamy końcówkę)
// - Fallback TTS: Web Speech API (speechSynthesis)
//
// Kliknięcie kafelka = natychmiastowe zapytanie:
//  * Jedzenie -> "restauracja w okolicy"
//  * Taxi     -> "taxi w okolicy"
//  * Hotel    -> "hotel w okolicy"
// ------------------------------------------------------------

(function () {
  // --------- helpers ---------
  const $ = (sel) => document.querySelector(sel);
  const getMeta = (name) => {
    const m = document.querySelector(`meta[name="${name}"]`);
    return m ? m.content : "";
  };

  // Endpoints z meta-tagów
  const PLACES_URL = getMeta("gmaps-proxy"); // np. https://.../api/places
  const GPT_URL = getMeta("gpt-proxy");      // np. https://.../api/gpt
  if (!PLACES_URL || !GPT_URL) {
    console.warn("Brak meta gmaps-proxy lub gpt-proxy w index.html");
  }
  // Wylicz TTS URL (ten sam host co PLACES_URL, tylko /api/tts)
  let TTS_URL = "";
  try {
    const u = new URL(PLACES_URL);
    u.pathname = "/api/tts";
    u.search = "";
    TTS_URL = u.toString();
  } catch (e) {
    console.warn("Nie udało się zbudować URL TTS na podstawie gmaps-proxy:", e);
  }

  // --------- UI refs ---------
  const tileFood  = $("#tileFood");
  const tileTaxi  = $("#tileTaxi");
  const tileHotel = $("#tileHotel");
  const transcriptEl = $("#transcript");
  const bannerEl = $("#banner");
  const micBtn = $("#micBtn");

  // --------- state ---------
  let mode = "food"; // "food" | "taxi" | "hotel"
  let lastGeo = null; // { lat, lng } po pobraniu geolokacji
  let speaking = false;

  // --------- init ---------
  setMode("food");
  setupMic(); // mic dalej działa do doprecyzowania

  // Zdarzenia kafelków — NATYCHMIASTOWE SZUKANIE
  tileFood?.addEventListener("click", () => {
    setMode("food");
    onUserQuery("restauracja w okolicy");
  });
  tileTaxi?.addEventListener("click", () => {
    setMode("taxi");
    onUserQuery("taxi w okolicy");
  });
  tileHotel?.addEventListener("click", () => {
    setMode("hotel");
    onUserQuery("hotel w okolicy");
  });

  // --------- funkcje UI ---------
  function setMode(m) {
    mode = m;
    [tileFood, tileTaxi, tileHotel].forEach((btn) => btn?.classList.remove("active"));
    if (mode === "food") tileFood?.classList.add("active");
    if (mode === "taxi") tileTaxi?.classList.add("active");
    if (mode === "hotel") tileHotel?.classList.add("active");
  }

  function setTranscript(text, ghost = false) {
    if (!transcriptEl) return;
    transcriptEl.textContent = text || "";
    transcriptEl.classList.toggle("ghost", !!ghost);
  }

  function showBanner(html) {
    if (!bannerEl) return;
    if (!html) {
      bannerEl.classList.add("hidden");
      bannerEl.innerHTML = "";
      return;
    }
    bannerEl.innerHTML = html;
    bannerEl.classList.remove("hidden");
  }

  // --------- geolokacja ---------
  async function getGeo() {
    if (lastGeo) return lastGeo;
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Brak geolokacji w przeglądarce"));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 });
      });
      lastGeo = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
    } catch (e) {
      // fallback – bez geolokacji też damy radę (backend może sam dodać default lub użyć IP)
      lastGeo = null;
    }
    return lastGeo;
  }

  // --------- integracje ---------
  async function searchPlaces(query) {
    // proste API: POST { query, lat?, lng?, mode? }
    const geo = await getGeo();
    const body = {
      query,
      mode, // informacja dla backendu (opcjonalna)
    };
    if (geo) {
      body.lat = geo.lat;
      body.lng = geo.lng;
    }
    const r = await fetch(PLACES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`/api/places HTTP ${r.status}`);
    return r.json(); // oczekujemy tablicy miejsc
  }

  async function askGpt(prompt) {
    // API: POST { prompt } -> { reply }
    const r = await fetch(GPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok) throw new Error(`/api/gpt HTTP ${r.status}`);
    const j = await r.json();
    return j.reply || "";
  }

  async function speakTTS(text, lang = "pl-PL") {
    // 1) spróbuj backend TTS (wav/mp3 w base64)
    if (TTS_URL) {
      try {
        const r = await fetch(TTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang, format: "mp3" }),
        });
        if (r.ok) {
          const j = await r.json();
          if (j && j.audioContent) {
            const b = atob(j.audioContent);
            const len = b.length;
            const buf = new Uint8Array(len);
            for (let i = 0; i < len; i++) buf[i] = b.charCodeAt(i);
            const blob = new Blob([buf], { type: "audio/mpeg" });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            speaking = true;
            audio.addEventListener("ended", () => {
              speaking = false;
              URL.revokeObjectURL(url);
            });
            await audio.play();
            return;
          }
        }
      } catch (e) {
        // spadamy do Web Speech
      }
    }
    // 2) fallback: Web Speech API
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pl-PL";
      speaking = true;
      u.onend = () => (speaking = false);
      speechSynthesis.speak(u);
    }
  }

  // --------- render wyników ---------
  function renderPlacesShort(list) {
    if (!Array.isArray(list) || list.length === 0) {
      showBanner(`<div>Nie znalazłem wyników w okolicy.</div>`);
      return;
    }
    // bierzemy top 2
    const top = list.slice(0, 2);
    const html = top
      .map((p, i) => {
        const name = p.name || p.title || "Miejsce";
        const rating = p.rating ? ` (${p.rating}★${p.votes ? ", " + p.votes : ""})` : "";
        const addr = p.address ? `, ${p.address}` : "";
        return `${i + 1}) ${name}${rating}${addr}`;
      })
      .join(" • ");
    showBanner(`<div>Top 2: ${html}</div>`);
  }

  // --------- główna ścieżka zapytania ---------
  async function onUserQuery(text) {
    try {
      setTranscript(text, false);

      // 1) miejsca
      const results = await searchPlaces(text);
      renderPlacesShort(results);

      // 2) 1 zdanie komentarza
      const oneLinerPrompt =
        mode === "food"
          ? "Powiedz jedno krótkie zdanie po polsku polecające dobrą restaurację w okolicy, naturalne i zwięzłe."
          : mode === "taxi"
          ? "Powiedz jedno krótkie zdanie po polsku o możliwości zamówienia taxi w okolicy, naturalne i zwięzłe."
          : "Powiedz jedno krótkie zdanie po polsku o hotelu w okolicy, naturalne i zwięzłe.";

      const reply = await askGpt(oneLinerPrompt);
      if (reply) {
        showBanner(bannerEl.innerHTML + `<div style="margin-top:.5rem">${reply}</div>`);
        // TTS
        speakTTS(reply, "pl-PL");
      }
    } catch (e) {
      console.error(e);
      showBanner(`<div>Błąd podczas wyszukiwania. Spróbuj ponownie.</div>`);
    }
  }

  // --------- mikrofon (opcjonalne doprecyzowanie) ---------
  function setupMic() {
    if (!micBtn) return;
    let rec = null;
    let listening = false;

    micBtn.addEventListener("click", async () => {
      if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
        // brak rozpoznawania — poproś o tekst promptem
        const t = prompt("Powiedz/napisz, czego szukasz:");
        if (t) onUserQuery(t);
        return;
      }
      if (listening) {
        rec && rec.stop();
        return;
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      rec = new SR();
      rec.lang = "pl-PL";
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        listening = true;
        setTranscript("Słucham...", true);
      };
      rec.onerror = () => {
        listening = false;
        setTranscript("Powiedz, co chcesz zamówić…", true);
      };
      rec.onend = () => {
        listening = false;
        if (!speaking) setTranscript("Powiedz, co chcesz zamówić…", true);
      };
      rec.onresult = (ev) => {
        const t = ev.results[0][0].transcript;
        onUserQuery(t);
      };
      rec.start();
    });
  }

  // Na start pokaż „placeholder”
  setTranscript("Powiedz, co chcesz zamówić…", true);
})();

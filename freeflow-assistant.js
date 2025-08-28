// ===== FreeFlow Assistant (frontend) =====
// Działa z index.html, czyta meta-konfigurację i uderza do Twojego backendu na Vercelu

(() => {
  // ---- Konfiguracja z <meta> ----
  const meta = (name, fallback = "") =>
    document.querySelector(`meta[name="${name}"]`)?.content || fallback;

  const ASR_PROVIDER = meta("asr-provider", "browser");
  const GMAPS_PROXY  = meta("gmaps-proxy", "/api/places");
  const GPT_PROXY    = meta("gpt-proxy",   "/api/gpt");

  // ---- Elementy UI ----
  const $ = (sel) => document.querySelector(sel);
  const page       = $("#app");
  const logoWrap   = $("#logoWrap");
  const logoBtn    = $("#logoBtn");
  const micBtn     = $("#micBtn");
  const dot        = $("#dot");
  const transcript = $("#transcript");
  const banner     = $("#banner");
  const tileFood   = $("#tileFood");
  const tileTaxi   = $("#tileTaxi");
  const tileHotel  = $("#tileHotel");

  // aktywna kategoria (wpływa na dobór słów kluczowych)
  let activeCategory = "food";
  tileFood.addEventListener("click", () => setCategory("food"));
  tileTaxi.addEventListener("click", () => setCategory("taxi"));
  tileHotel.addEventListener("click", () => setCategory("hotel"));
  function setCategory(cat) {
    activeCategory = cat;
    [tileFood, tileTaxi, tileHotel].forEach(el => el.classList.remove("active"));
    ({food: tileFood, taxi: tileTaxi, hotel: tileHotel}[cat].classList.add("active"));
  }

  // ---- Geolokalizacja ----
  let coords = null; // { lat, lng }
  askGeoOnce();

  async function askGeoOnce() {
    if (!navigator.geolocation) return;
    try {
      coords = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          }),
          (err) => resolve(null), // brak zgody = brak blokady
          { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 }
        );
      });
      if (!coords) {
        showInfo("Brak dostępu do lokalizacji — szukam ogólnie (możesz włączyć dostęp).", "warn");
      } else {
        hideBanner();
      }
    } catch {
      // ignoruj
    }
  }

  // ---- Rozpoznawanie mowy (browser) ----
  let listening = false;
  let recognizer = null;

  function initASR() {
    if (ASR_PROVIDER !== "browser") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showInfo("Ten browser nie obsługuje rozpoznawania mowy. Użyj Chrome/Edge na Android/desktop.", "warn");
      return;
    }
    recognizer = new SR();
    recognizer.lang = "pl-PL";
    recognizer.interimResults = true;
    recognizer.continuous = false;

    let finalText = "";

    recognizer.onstart = () => {
      listening = true;
      page.classList.add("listening");
      transcript.classList.remove("ghost");
      setTranscript("Słucham…");
    };

    recognizer.onresult = (e) => {
      let interim = "";
      for (const res of e.results) {
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript((finalText || interim || "…").trim());
    };

    recognizer.onerror = () => stopASR();
    recognizer.onend    = () => {
      // zakończone; jeśli jest tekst — wyślij; jeśli nie, po prostu zatrzymaj stan
      page.classList.remove("listening");
      listening = false;
      if (transcript.textContent && transcript.textContent !== "Powiedz, co chcesz zamówić…") {
        handleUserUtterance(transcript.textContent.trim());
      } else {
        setTranscriptPlaceholder();
      }
    };
  }

  function startASR() {
    if (!recognizer) return;
    try { recognizer.start(); } catch {}
  }

  function stopASR() {
    if (!recognizer) return;
    try { recognizer.stop(); } catch {}
  }

  // UI bind
  initASR();
  micBtn.addEventListener("click", () => listening ? stopASR() : startASR());
  logoBtn.addEventListener("click", () => listening ? stopASR() : startASR());

  // ---- Główna obsługa wypowiedzi użytkownika ----
  async function handleUserUtterance(text) {
    // 1) GPT — krótka odpowiedź
    askGPT(text).catch(() => {});

    // 2) Places — jeśli wykryjemy intencję wyszukiwania miejsca
    const keyword = extractKeyword(text);
    if (keyword) {
      const places = await searchPlaces(keyword);
      if (places && places.length) {
        const top2 = places.slice(0, 2);
        showPlaces(top2);
      } else {
        showInfo("Niestety nie znalazłem miejsc dla tego zapytania.", "warn");
      }
    }
  }

  // ---- Słowa kluczowe ↔ intencje ----
  const WORDS = {
    food: ["pizzeria","pizza","kebab","sushi","burger","restauracja","tajska","włoska","chińska","indyjska","bar","bistro"],
    taxi: ["taxi","taksówka","uber","bolt"],
    hotel:["hotel","nocleg","hostel","apartament","spa"]
  };
  function extractKeyword(text) {
    const t = text.toLowerCase();
    const base = new Set([...(WORDS.food), ...(WORDS.taxi), ...(WORDS.hotel)]);
    // preferencja wg aktywnej kategorii
    const prefer = WORDS[activeCategory];
    const all = [...prefer, ...base];
    for (const w of all) {
      if (t.includes(w)) return w;
    }
    // fallback: szukaj po "dwie najlepsze X", "najbliższe X"
    const m = t.match(/najlepsze|najbliższe|w okolicy|blisko/i);
    if (m) {
      const noun = t.split(/\bnajlepsze\b|\bnajbliższe\b|\bw okolicy\b|\bblisko\b/i).pop().trim().split(/\s+/)[0];
      if (noun && noun.length > 2) return noun;
    }
    return null;
  }

  // ---- GPT ----
  async function askGPT(userText) {
    try {
      const res = await fetch(GPT_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userText })
      });
      const data = await res.json();
      if (data?.reply) {
        showInfo(`🧠 ${data.reply}`, "info");
      }
    } catch (e) {
      showInfo("Błąd połączenia z GPT.", "error");
    }
  }

  // ---- Places ----
  async function searchPlaces(keyword) {
    try {
      // preferujemy textsearch z location, jeśli mamy GPS
      const params = new URLSearchParams({
        path: "/maps/api/place/textsearch/json",
        query: keyword,
        language: "pl"
      });

      if (coords) {
        params.set("location", `${coords.lat},${coords.lng}`);
        params.set("radius", "5000");
      }

      const url = `${GMAPS_PROXY}?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();

      const list = (data?.results || []).map(r => ({
        name: r.name,
        rating: r.rating ?? 0,
        votes: r.user_ratings_total ?? 0,
        address: r.formatted_address ?? r.vicinity ?? "-"
      }));

      // sortowanie: najpierw ocena, potem liczba opinii
      list.sort((a,b) => (b.rating - a.rating) || (b.votes - a.votes));
      return list;
    } catch (e) {
      showInfo("Błąd połączenia z Google Places.", "error");
      return null;
    }
  }

  // ---- UI helpers ----
  function setTranscript(t) {
    transcript.textContent = t || "";
  }
  function setTranscriptPlaceholder() {
    transcript.classList.add("ghost");
    transcript.textContent = "Powiedz, co chcesz zamówić…";
  }
  setTranscriptPlaceholder();

  function showPlaces(items) {
    if (!items?.length) return hideBanner();
    const html = items.map((p,i) =>
      `<div><b>${i+1}. ${escapeHTML(p.name)}</b> — ${p.address}<br/>⭐ ${p.rating} • ${p.votes} opinii</div>`
    ).join("<hr style='border:0;border-top:1px solid rgba(255,255,255,.12);margin:6px 0'/>");

    banner.classList.remove("hidden");
    banner.style.background = "rgba(33,212,253,.12)";
    banner.style.color = "#bfefff";
    banner.innerHTML = html;
  }

  function showInfo(msg, type="info") {
    banner.classList.remove("hidden");
    banner.innerHTML = escapeHTML(msg);
    if (type === "warn") {
      banner.style.background = "rgba(255,203,72,.15)";
      banner.style.color = "#ffe6a3";
    } else if (type === "error") {
      banner.style.background = "rgba(255,72,72,.18)";
      banner.style.color = "#ffd2d2";
    } else {
      banner.style.background = "rgba(33,212,253,.12)";
      banner.style.color = "#cfefff";
    }
  }
  function hideBanner() {
    banner.classList.add("hidden");
    banner.textContent = "";
  }
  function escapeHTML(s="") {
    return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
})();

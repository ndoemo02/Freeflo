// freeflow-assistant.js
// Lekki formatter + TTS + baner na odpowiedzi (PL)

(() => {
  // ----------- Config -----------
  const MAX_WORDS = 25;
  const LANG = "pl-PL";
  const BANNER_ID = "ff-response-banner";

  // ----------- Utils -----------
  const normalizeWhitespace = (s) =>
    (s || "")
      .replace(/\s+/g, " ")
      .replace(/[“”„]+/g, '"')
      .trim();

  const stripSystemish = (s) => {
    if (!s) return "";
    // usuń linie meta i prefiksy roli
    const lines = s
      .split(/\n+/)
      .map((l) =>
        l
          .replace(/^\s*(user|assistant|system|role|prompt|instruction)[:\-]\s*/i, "")
          .replace(/^\s*(Użytkownik|User)\s+poprosił.*$/i, "")
          .replace(/^\s*Odpowiedź(?:\s*krótko.*)?[:\-]?\s*/i, "")
      )
      .filter((l) => l.trim().length > 0);

    let t = lines.join(" ");

    // usuń cytaty użytkownika / echa promptu
    t = t.replace(/"(?:[^"]{3,})"\s*—?\s*(?:powiedział|napisał|użytkownik).*?$/i, "");
    t = t.replace(/(?:użytkownik|klient)\s+(mówi|napisał|poprosił).*?:?\s*".*?"/gi, "");

    return normalizeWhitespace(t);
  };

  // Zamień 4.9★ → 4,9 gwiazdki; 5.0★ → 5,0 gwiazdek itp.
  function polishStars(s) {
    if (!s) return s;
    let t = String(s);
    // kropka dziesiętna → przecinek
    t = t.replace(/(\d+)\.(\d+)/g, "$1,$2");
    // symbol gwiazdek na słowo
    t = t.replace(/★/g, " gwiazdki");
    // „5,0 gwiazdki” → „5,0 gwiazdek”
    t = t.replace(/\b([2-4]),\d\s+gwiazdki\b/g, "$1,$2 gwiazdki"); // 2–4: gwiazdki (OK)
    t = t.replace(/\b(0|1|[5-9]),\d\s+gwiazdki\b/g, "$1,$2 gwiazdek"); // 0/1/5-9: gwiazdek
    t = t.replace(/\b([2-4])\s+gwiazdki\b/g, "$1 gwiazdki");
    t = t.replace(/\b(0|1|[5-9])\s+gwiazdki\b/g, "$1 gwiazdek");
    return t;
  }

  const toPolishShort = (s) => {
    let t = normalizeWhitespace(s);

    // usuń ang. wstępy
    t = t.replace(/^Here(?:'|’)s.*?:\s*/i, "");
    t = t.replace(/^Sure[,!\s]*/i, "");
    t = t.replace(/^Okay[,!\s]*/i, "");
    t = t.replace(/^Note[:\-]\s*/i, "");
    t = t.replace(/^\**(Answer|Response)\**[:\-]?\s*/i, "");

    // usuń dyrektywy typu „w 25 słowach…”
    t = t.replace(/\b(w\s*\d+\s*słowach|krótko|skróć odpowiedź)\b.*$/i, "");

    // popraw gwiazdki/liczby
    t = polishStars(t);

    // przytnij do MAX_WORDS
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > MAX_WORDS) {
      t = words.slice(0, MAX_WORDS).join(" ") + "…";
    }

    // usuń „Cytując …”
    t = t.replace(/^Cytując.*?:\s*/i, "");

    return t.trim();
  };

  // ----------- Banner -----------
  const ensureBanner = () => {
    let el = document.getElementById(BANNER_ID);
    if (el) return el;

    el = document.createElement("div");
    el.id = BANNER_ID;
    el.setAttribute("role", "status");
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.bottom = "24px";
    el.style.maxWidth = "min(92vw, 920px)";
    el.style.zIndex = "99999";
    el.style.padding = "12px 16px";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 6px 20px rgba(0,0,0,.18)";
    el.style.backdropFilter = "blur(8px)";
    el.style.background = "rgba(18, 18, 18, .85)";
    el.style.color = "white";
    el.style.fontFamily =
      "system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji'";
    el.style.fontSize = "15px";
    el.style.lineHeight = "1.35";
    el.style.letterSpacing = "0.2px";
    el.style.userSelect = "text";
    el.style.cursor = "default";
    el.style.border = "1px solid rgba(255,255,255,.06)";
    el.style.display = "none";

    const txt = document.createElement("div");
    txt.id = `${BANNER_ID}-text`;
    txt.style.whiteSpace = "pre-wrap";
    el.appendChild(txt);

    document.body.appendChild(el);
    return el;
  };

  const showBanner = (message = "") => {
    const el = ensureBanner();
    const txt = el.querySelector(`#${BANNER_ID}-text`);
    if (txt) txt.textContent = message || "";
    el.style.display = message ? "block" : "none";

    clearTimeout(showBanner._hideT);
    showBanner._hideT = setTimeout(() => {
      if (!el.matches(":hover")) el.style.display = "none";
    }, 8000);
  };

  // ----------- TTS -----------
  async function speakWithWebSpeech(text) {
    return new Promise((resolve) => {
      try {
        if (!("speechSynthesis" in window)) return resolve(false);

        window.speechSynthesis.cancel();

        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = LANG;
        utter.rate = 1.0;
        utter.pitch = 1.0;
        utter.volume = 1.0;

        const pickVoice = () => {
          const voices = window.speechSynthesis.getVoices() || [];
          const plPriority = voices.find((v) => /pl[-_]PL/i.test(v.lang || ""));
          const anyPL = voices.find((v) => /pl/i.test(v.lang || ""));
          const fallback =
            voices.find((v) => /google.*polish/i.test((v.name || "").toLowerCase())) ||
            voices[0];

          utter.voice = plPriority || anyPL || fallback || null;
          window.speechSynthesis.speak(utter);
        };

        utter.onend = () => resolve(true);
        utter.onerror = () => resolve(false);

        const voices = window.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) {
          window.speechSynthesis.onvoiceschanged = () => {
            pickVoice();
            window.speechSynthesis.onvoiceschanged = null;
          };
          setTimeout(() => {
            window.speechSynthesis.getVoices();
          }, 0);
        } else {
          pickVoice();
        }
      } catch {
        resolve(false);
      }
    });
  }

  const speak = async (text) => {
    // (NotebookLM nie ma publicznego TTS API – pomijamy)
    const okWeb = await speakWithWebSpeech(text);
    return okWeb;
  };

  // ----------- Public API -----------
  const formatAssistantReply = (raw) => {
    const cleaned = stripSystemish(raw);
    const shortPL = toPolishShort(cleaned);
    return shortPL;
  };

  // Główne wejście – podaj tu surową odpowiedź (np. GPT albo z Places)
  const handleAssistantOutput = async (raw) => {
    const msg = formatAssistantReply(raw);
    showBanner(msg);
    await speak(msg);
    return msg;
  };

  // Z Places: obiekt → zdanie (krótko)
  const handlePlacesResult = async (result) => {
    const parts = [];
    if (result?.name) parts.push(result.name);
    if (result?.address) parts.push(result.address);
    if (result?.distanceText) parts.push("~" + result.distanceText);
    if (result?.openNow === true) parts.push("teraz otwarte");
    if (result?.openNow === false) parts.push("teraz zamknięte");

    let raw = parts.filter(Boolean).join(", ");
    if (!raw) raw = String(result ?? "");
    return handleAssistantOutput(raw);
  };

  // Sprzątanie ewentualnych „echo promptów” (opcjonalne)
  const removePromptEchoes = () => {
    const selectors = [
      "[data-role='prompt-echo']",
      ".prompt-echo",
      "pre[data-kind='prompt']",
      "div:has(> .prompt-echo)",
    ].join(",");
    document.querySelectorAll(selectors).forEach((el) => el.remove());
  };
  document.addEventListener("DOMContentLoaded", removePromptEchoes);

  // ----------- Export -----------
  const api = {
    handleAssistantOutput,
    handlePlacesResult,
    formatAssistantReply,
    showBanner,
    speak,
  };
  window.FreeFlowAssistant = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

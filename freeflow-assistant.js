/* freeflow-assistant.js  — front bez zmian w HTML
 * Dock z kaflami (Jedzenie/Taxi/Hotel) + połączenie z backendem (plan + tts)
 * Wszystko PL, minimalne style wstrzykiwane z JS.
 */

(() => {
  // >>>>> KONFIG <<<<<
  const API_BASE = 'https://freeflow-backend-vercel.vercel.app'; // Twój backend na Vercel
  const TTS_LANG = 'pl-PL';
  const TTS_FORMAT = 'mp3';

  // ===== Pomocnicze =====
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  // Wstrzyknięcie prostych styli (bez ruszania index.html)
  const css = `
  .ff-dock {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
    display: flex; gap: 12px; z-index: 9999; padding: 10px 12px;
    backdrop-filter: blur(8px); background: rgba(20,20,20,.35);
    border-radius: 16px; box-shadow: 0 8px 28px rgba(0,0,0,.35);
  }
  .ff-btn {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 110px; height: 44px; padding: 0 14px;
    border-radius: 12px; border: 1px solid rgba(255,255,255,.12);
    color: #fff; background: rgba(255,255,255,.08); font-weight: 600;
    letter-spacing:.2px; cursor: pointer; user-select: none;
    transition: transform .06s ease, background .2s ease, opacity .2s ease;
  }
  .ff-btn:hover { background: rgba(255,255,255,.18); }
  .ff-btn:active { transform: translateY(1px) scale(.99); }
  .ff-results {
    position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%);
    width: min(720px, 92vw); max-height: 42vh; overflow: auto;
    padding: 12px 14px; margin: 0 auto; z-index: 9998;
    border-radius: 16px; background: rgba(15,15,15,.55);
    backdrop-filter: blur(8px); color: #f4f4f4; font-size: 15px;
    box-shadow: 0 6px 22px rgba(0,0,0,.35);
  }
  .ff-result { padding: 10px 8px; border-bottom: 1px dashed rgba(255,255,255,.12); }
  .ff-result:last-child { border-bottom: none; }
  .ff-muted { opacity: .7; font-size: 13px; }
  .ff-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .ff-badge { padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.14); font-size: 12px; }
  .ff-loading { opacity: .8; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Dock + panel wyników
  const dock = document.createElement('div');
  dock.className = 'ff-dock';
  dock.innerHTML = `
    <button class="ff-btn" data-intent="food">🍽️ Jedzenie</button>
    <button class="ff-btn" data-intent="taxi">🚕 Taxi</button>
    <button class="ff-btn" data-intent="hotel">🏨 Hotel</button>
  `;
  document.body.appendChild(dock);

  const panel = document.createElement('div');
  panel.className = 'ff-results';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  function showPanel(html) {
    panel.innerHTML = html;
    panel.style.display = 'block';
  }
  function hidePanel() {
    panel.style.display = 'none';
    panel.innerHTML = '';
  }

  async function speak(text) {
    try {
      const r = await fetch(`${API_BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: TTS_LANG, format: TTS_FORMAT }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'TTS HTTP error');
      const b64 = data?.audioContent;
      if (!b64) return; // backend mógł tylko zwrócić "ok"
      const blob = b64ToBlob(b64, TTS_FORMAT === 'mp3' ? 'audio/mpeg' : 'audio/wav');
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch (e) {
      console.warn('TTS error:', e);
    }
  }

  function b64ToBlob(b64Data, contentType = '', sliceSize = 1024) {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  }

  function getGeo() {
    return new Promise(resolve => {
      const fallback = () => resolve(null);
      if (!('geolocation' in navigator)) return fallback();
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        }),
        () => fallback(),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
      );
    });
  }

  async function plan(query) {
    const where = await getGeo(); // może być null – backend sobie poradzi
    const body = { query };
    if (where) body.where = where;

    const started = Date.now();
    showPanel(`<div class="ff-result ff-loading">🔎 Szukam: <b>${escapeHtml(query)}</b>…</div>`);
    try {
      const res = await fetch(`${API_BASE}/api/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Błąd zapytania');

      // Oczekuję: data.results[] (name, rating, votes, address, distanceText…)
      const list = Array.isArray(data?.results) ? data.results : [];
      if (!list.length) {
        showPanel(`<div class="ff-result">Brak wyników.</div>`);
        await speak('Nie znalazłem nic w pobliżu.');
        return;
      }

      const rows = list.slice(0, 5).map((p, i) => {
        const rating = p.rating ? `⭐ ${p.rating}` : '';
        const votes = p.votes ? `(${p.votes})` : '';
        const dist = p.distanceText ? `<span class="ff-badge">${p.distanceText}</span>` : '';
        const addr = p.address ? `<div class="ff-muted">${escapeHtml(p.address)}</div>` : '';
        return `
          <div class="ff-result">
            <div class="ff-row">
              <div><b>${i + 1}. ${escapeHtml(p.name || 'Miejsce')}</b></div>
              <div class="ff-muted">${rating} ${votes}</div>
              ${dist}
            </div>
            ${addr}
          </div>
        `;
      }).join('');

      const took = ((Date.now() - started) / 1000).toFixed(1);
      showPanel(`
        <div class="ff-muted" style="padding:4px 8px 10px;">Gotowe w ${took}s • Top ${Math.min(5, list.length)}</div>
        ${rows}
      `);

      // Zgrabne jednozdaniowe podsumowanie do TTS:
      const top = list[0];
      if (top?.name) {
        const line = `Top propozycja: ${top.name}. ${top.address ? 'Adres: ' + top.address + '. ' : ''}${top.distanceText ? 'Dystans: ' + top.distanceText + '. ' : ''}`;
        await speak(line);
      }
    } catch (e) {
      console.error(e);
      showPanel(`<div class="ff-result">Ups, coś poszło nie tak. Spróbuj ponownie.</div>`);
      await speak('Coś poszło nie tak. Spróbuj ponownie.');
    }
  }

  function escapeHtml(s='') {
    return s.replace(/[&<>"']/g, m =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])
    );
  }

  // Zdarzenia kafli
  dock.addEventListener('click', (e) => {
    const btn = e.target.closest('.ff-btn');
    if (!btn) return;
    const intent = btn.dataset.intent;

    // Proste predefiniowane zapytania – możesz zmienić pod siebie
    if (intent === 'food') plan('dwie najlepsze pizzerie w okolicy');
    if (intent === 'taxi') plan('taxi z mojej lokalizacji do centrum');
    if (intent === 'hotel') plan('dwa najlepsze hotele w okolicy');
  });

  // Schowanie panelu po kliknięciu poza nim (opcjonalne)
  document.addEventListener('click', (e) => {
    const insideDock = e.target.closest('.ff-dock');
    const insidePanel = e.target.closest('.ff-results');
    if (!insideDock && !insidePanel) hidePanel();
  });
})();

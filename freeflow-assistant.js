// === NOWA ZAWARTOŚĆ PLIKU freeflow-assistant.js ===

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Pobieranie elementów z Twojego HTML ---
    const micBtn = document.getElementById('micBtn');
    const logoImg = micBtn.querySelector('.logo'); // Obrazek logo wewnątrz przycisku
    const transcriptBubble = document.getElementById('transcript');
    
    // Na razie nie używamy modala, ale zostawiamy na przyszłość
    // const confirmModal = document.getElementById('confirmModal');

    // --- 2. Konfiguracja rozpoznawania mowy (Web Speech API) ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        updateTranscript("Twoja przeglądarka nie wspiera rozpoznawania mowy.", true);
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pl-PL';
    recognition.interimResults = false; // Wyniki dopiero po zakończeniu mówienia
    recognition.continuous = false;     // Zakończ po jednej frazie

    let isRecording = false;

    // --- 3. Obsługa zdarzeń ---
    micBtn.addEventListener('click', () => {
        if (isRecording) {
            recognition.stop(); // Zatrzymanie na żądanie
        } else {
            recognition.start();
        }
    });

    recognition.onstart = () => {
        isRecording = true;
        logoImg.style.animation = 'neonPulse 1.5s ease-in-out infinite'; // Używamy Twojej animacji
        updateTranscript("Słucham...");
    };

    recognition.onend = () => {
        isRecording = false;
        logoImg.style.animation = 'none'; // Zatrzymanie animacji
        // Nie zmieniamy tekstu, aby użytkownik widział ostatni wynik
    };

    recognition.onerror = (event) => {
        console.error("Błąd rozpoznawania mowy: ", event.error);
        updateTranscript(`Błąd: ${event.error}`, true);
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        updateTranscript(`Rozpoznano: „${transcript}”`);
        processCommand(transcript);
    };

    // --- 4. Przetwarzanie poleceń ---
    function processCommand(command) {
        const searchKeywords = ['znajdź', 'pokaż', 'wyszukaj', 'gdzie jest', 'gdzie zjem'];
        const orderKeywords = ['zamów', 'zamawiam', 'chciałbym', 'poproszę', 'chcę'];

        // Sprawdzamy, czy polecenie pasuje do słów kluczowych
        const isSearchCommand = searchKeywords.some(keyword => command.toLowerCase().startsWith(keyword));
        const isOrderCommand = orderKeywords.some(keyword => command.toLowerCase().startsWith(keyword));

        if (isSearchCommand) {
            // Usuwamy słowo kluczowe, aby uzyskać czyste zapytanie (np. "pizzerie w Warszawie")
            const query = command.replace(new RegExp(`^(${searchKeywords.join('|')})\\s*`, 'i'), '');
            searchForPlaces(query);
        } else if (isOrderCommand) {
            // Na razie tylko potwierdzamy, że usłyszeliśmy zamówienie
            speak(`Przyjąłem do wiadomości zamówienie: ${command}. Funkcja realizacji jest w budowie.`);
            updateTranscript(`OK, przyjąłem: "${command}"`);
        } else {
            // Jeśli nie pasuje do niczego, traktujemy to jako potencjalne zamówienie
            speak(`OK, zanotowałem: ${command}.`);
            updateTranscript(`Zanotowano: "${command}"`);
        }
    }

    // --- 5. Komunikacja z backendem (Vercel) ---
    async function searchForPlaces(query) {
        updateTranscript(`Szukam: „${query}”...`);
        speak(`Dobrze, szukam ${query}`);

        // Upewnij się, że backend na Vercel działa i jest dostępny
        const backendUrl = `https://freeflow-backend-vercel.vercel.app/api/search?query=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(backendUrl);
            if (!response.ok) {
                throw new Error(`Błąd serwera: ${response.status}`);
            }
            const results = await response.json();

            if (results.length > 0) {
                speak("Oto co udało mi się znaleźć.");
                // Zamiast tworzyć nowe elementy, wyświetlimy wyniki w "bańce"
                const resultsHtml = results.slice(0, 3) // Pokaż pierwsze 3 wyniki
                    .map(r => `• <a href="${r.link}" target="_blank">${r.title}</a>`)
                    .join('<br>');
                updateTranscript(`<b>Oto co znalazłem:</b><br>${resultsHtml}`, false, true);
            } else {
                speak("Niestety, nic nie znalazłem.");
                updateTranscript(`Nie znaleziono wyników dla: "${query}"`);
            }

        } catch (error) {
            console.error("Błąd podczas wyszukiwania:", error);
            speak("Przepraszam, wystąpił błąd podczas wyszukiwania.");
            updateTranscript("Wystąpił błąd serwera. Spróbuj ponownie później.", true);
        }
    }

    // --- 6. Funkcje pomocnicze ---
    function updateTranscript(text, isError = false, allowHtml = false) {
        if (allowHtml) {
            transcriptBubble.innerHTML = text;
        } else {
            transcriptBubble.textContent = text;
        }
        transcriptBubble.style.color = isError ? '#ff8a8a' : 'var(--text)';
    }

    function speak(text) {
        // Anuluj poprzednie wypowiedzi, aby się nie nakładały
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pl-PL';
        // Możesz tu dodać więcej opcji, np. zmiana głosu, prędkości
        window.speechSynthesis.speak(utterance);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const micIcon = document.getElementById('mic-icon');
    const statusText = document.getElementById('status-text');
    const transcriptText = document.getElementById('transcript-text');
    const resultsContainer = document.getElementById('results-container');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        statusText.textContent = "Twoja przeglądarka nie wspiera rozpoznawania mowy.";
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pl-PL';
    recognition.interimResults = false;
    recognition.continuous = false;

    let isRecording = false;

    micIcon.addEventListener('click', () => {
        if (isRecording) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });

    recognition.onstart = () => {
        isRecording = true;
        micIcon.classList.add('is-recording');
        statusText.textContent = "Słucham...";
        transcriptText.textContent = "";
        resultsContainer.innerHTML = "";
    };

    recognition.onend = () => {
        isRecording = false;
        micIcon.classList.remove('is-recording');
        statusText.textContent = "Naciśnij mikrofon, aby mówić";
    };

    recognition.onerror = (event) => {
        console.error("Błąd rozpoznawania mowy: ", event.error);
        statusText.textContent = "Wystąpił błąd. Spróbuj ponownie.";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        transcriptText.textContent = `Rozpoznano: "${transcript}"`;
        processCommand(transcript);
    };

    function processCommand(command) {
        const searchKeywords = ['znajdź', 'pokaż', 'wyszukaj', 'gdzie jest'];
        const orderKeywords = ['zamów', 'zamawiam', 'chciałbym', 'poproszę'];

        const isSearchCommand = searchKeywords.some(keyword => command.toLowerCase().startsWith(keyword));
        const isOrderCommand = orderKeywords.some(keyword => command.toLowerCase().startsWith(keyword));

        if (isSearchCommand) {
            const query = command.split(' ').slice(1).join(' ');
            searchForPlaces(query);
        } else if (isOrderCommand) {
            // Zamiast wysyłać email, tylko potwierdzamy głosowo
            statusText.textContent = "Przyjąłem Twoje zamówienie.";
            speak(`Rozumiem, zanotowałem: ${command}. Funkcja wysyłki jest obecnie wyłączona.`);
        } else {
            speak("Nie zrozumiałem. Czy chcesz coś wyszukać, czy złożyć zamówienie?");
        }
    }

    async function searchForPlaces(query) {
        statusText.textContent = `Szukam: "${query}"...`;
        speak(`Dobrze, szukam ${query}`);

        try {
            const response = await fetch(`https://freeflow-backend-vercel.vercel.app/api/search?query=${encodeURIComponent(query)}`);
            
            if (!response.ok) {
                throw new Error(`Błąd serwera: ${response.statusText}`);
            }

            const results = await response.json();
            statusText.textContent = "Oto co znalazłem:";
            speak("Oto co udało mi się znaleźć.");
            
            resultsContainer.innerHTML = "";
            results.forEach(result => {
                const item = document.createElement('div');
                item.className = 'result-item';
                item.innerHTML = `<a href="${result.link}" target="_blank">${result.title}</a><p>${result.snippet}</p>`;
                resultsContainer.appendChild(item);
            });

        } catch (error) {
            console.error("Błąd podczas wyszukiwania:", error);
            statusText.textContent = "Przepraszam, wystąpił błąd podczas wyszukiwania.";
            speak("Przepraszam, nie udało mi się nic znaleźć.");
        }
    }

    function speak(text) {
        // Anuluj poprzednie wypowiedzi, aby się nie nakładały
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pl-PL';
        window.speechSynthesis.speak(utterance);
    }
});

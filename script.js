document.addEventListener('DOMContentLoaded', () => {
    const micIcon = document.getElementById('mic-icon');
    const statusText = document.getElementById('status-text');
    const transcriptText = document.getElementById('transcript-text');
    const resultsContainer = document.getElementById('results-container');
    const orderForm = document.getElementById('orderForm');
    const orderContentInput = document.getElementById('order_content');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        statusText.textContent = "Twoja przeglądarka nie wspiera rozpoznawania mowy.";
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pl-PL';
    recognition.interimResults = false; // Wyniki dopiero po zakończeniu mówienia
    recognition.continuous = false; // Zakończ po jednej frazie

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
            // Usuwamy słowo kluczowe, aby uzyskać czyste zapytanie
            const query = command.split(' ').slice(1).join(' ');
            searchForPlaces(query);
        } else if (isOrderCommand) {
            sendOrder(command);
        } else {
            speak("Nie zrozumiałem. Czy chcesz coś wyszukać, czy złożyć zamówienie?");
        }
    }

    async function searchForPlaces(query) {
        statusText.textContent = `Szukam: "${query}"...`;
        speak(`Dobrze, szukam ${query}`);

        try {
            // UWAGA: Zmień URL jeśli Vercel przypisał Ci inną domenę!
            const response = await fetch(`https://freeflow-backend-vercel.vercel.app/api/search?query=${encodeURIComponent(query)}`);
            
            if (!response.ok) {
                throw new Error(`Błąd serwera: ${response.statusText}`);
            }

            const results = await response.json();
            statusText.textContent = "Oto co znalazłem:";
            speak("Oto co udało mi się znaleźć.");
            
            resultsContainer.innerHTML = ""; // Wyczyść poprzednie wyniki
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

    function sendOrder(order) {
        statusText.textContent = "Przetwarzam Twoje zamówienie...";
        speak("Przyjąłem Twoje zamówienie. Wysyłam je do realizacji.");
        
        // Wypełnij i wyślij ukryty formularz
        orderContentInput.value = order;
        orderForm.submit();
    }

    function speak(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pl-PL';
        window.speechSynthesis.speak(utterance);
    }
});

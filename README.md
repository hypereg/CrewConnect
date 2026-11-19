# CrewConnect z MySQL

Backend wymaga Node.js 22 i dostępu sieciowego do MySQL ZUT. Uruchom go na komputerze lub serwerze z dostępem do sieci uczelni albo VPN.

1. Uruchom `npm install`.
2. Skopiuj `.env.example` do `.env` i uzupełnij `MYSQL_PASSWORD` nowym hasłem. W hostingu ustaw te wartości jako zmienne środowiskowe. Plik `.env` jest ignorowany przez Git.
3. Uruchom `node --env-file=.env server.mjs` i otwórz `http://localhost:3000`. Aplikacja tworzy tabelę `crewconnect_workspaces` przy starcie, więc konto potrzebuje uprawnienia CREATE w swojej bazie.

Dane demonstracyjne są zapisywane jako stan danego obszaru roboczego w MySQL. Losowy identyfikator w ciasteczku HttpOnly wiąże obszar z przeglądarką. Profile demo w tym obszarze współdzielą wydarzenia i raporty. Przy utracie połączenia zmiany zostają w pamięci przeglądarki i są wysyłane po ponownym połączeniu. Do uruchomienia za HTTPS ustaw `NODE_ENV=production`.

Statyczne wdrożenie Sites nie uruchamia tego serwera Node i nadal zapisuje dane lokalnie.

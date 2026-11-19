# CrewConnect z MongoDB Atlas

Backend wymaga Node.js 22 oraz dostępu do klastra Atlas. W Atlas dodaj adres IP serwera aplikacji do listy dostępu i nadaj użytkownikowi bazy prawo odczytu oraz zapisu w bazie `crewconnect`.

1. Uruchom `npm ci`.
2. Skopiuj `.env.example` do `.env` i ustaw `MONGODB_URI` na adres połączenia Atlas. W hostingu ustaw go jako sekret środowiskowy. Plik `.env` jest ignorowany przez Git.
3. Uruchom `node --env-file=.env server.mjs` i otwórz `http://localhost:3000`.
4. Na serwerze HTTPS ustaw `NODE_ENV=production`. Przy wdrożeniu w kontenerze ustaw dodatkowo `HOST=0.0.0.0`.

Domyślna baza to `crewconnect`, a kolekcja `workspaces` powstaje przy pierwszym zapisie. Losowy identyfikator w ciasteczku HttpOnly wiąże obszar roboczy z przeglądarką. W jednym obszarze profile demo współdzielą wydarzenia i raporty. Zmiany offline są przechowywane lokalnie i synchronizowane po odzyskaniu połączenia.

Wcześniejsze dane zapisane w przeglądarce mogą zostać zsynchronizowane po uruchomieniu backendu. Rekordy przechowywane wyłącznie w MySQL wymagają osobnej migracji. Statyczne demo Sites korzysta z pamięci przeglądarki. Do użycia Atlas online uruchom serwer Node.js na hostingu z dostępem do klastra.

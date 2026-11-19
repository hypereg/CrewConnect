# CrewConnect z MongoDB Atlas

Backend wymaga Node.js 22 oraz dostępu do klastra Atlas. W Atlas dodaj adres IP serwera aplikacji do listy dostępu i nadaj użytkownikowi bazy prawo odczytu oraz zapisu w bazie `crewconnect`.

1. Uruchom `npm ci`.
2. Skopiuj `.env.example` do `.env` i ustaw `MONGODB_URI` na adres połączenia Atlas. W hostingu ustaw go jako sekret środowiskowy. Plik `.env` jest ignorowany przez Git.
3. Uruchom `node --env-file=.env server.mjs` i otwórz `http://localhost:3000`.
4. Na serwerze HTTPS ustaw `NODE_ENV=production`. Przy wdrożeniu w kontenerze ustaw dodatkowo `HOST=0.0.0.0`.

Domyślna baza to `crewconnect`, a kolekcja `workspaces` powstaje przy pierwszym zapisie. Losowy identyfikator w ciasteczku HttpOnly wiąże obszar roboczy z przeglądarką. W jednym obszarze profile demo współdzielą wydarzenia i raporty. Zmiany offline są przechowywane lokalnie i synchronizowane po odzyskaniu połączenia.

## GitHub Pages i Atlas

1. Wdróż backend Node.js na hostingu HTTPS z dostępem do Atlas. Ustaw sekret `MONGODB_URI`, opcjonalną nazwę bazy `MONGODB_DATABASE` oraz `FRONTEND_ORIGIN=https://hypereg.github.io`. Przy wdrożeniu dostarczanym przez platformę ustaw adres nasłuchu `HOST=0.0.0.0`.
2. W ustawieniach repozytorium wybierz **Pages → Source → GitHub Actions**. W **Secrets and variables → Actions → Variables** ustaw zmienną `CREWCONNECT_API_URL` na publiczny adres HTTPS backendu, bez ścieżki.
3. Uruchom workflow **Deploy CrewConnect to GitHub Pages**. Wejdź na `https://hypereg.github.io/CrewConnect/`. Bez skonfigurowanego adresu API frontend pracuje w trybie lokalnym.

GitHub Pages hostuje pliki PWA. Backend łączy się z Atlas, a frontend używa prywatnego tokenu obszaru roboczego zapisanego w przeglądarce. Przeglądarka synchronizuje się z API po odzyskaniu połączenia. URI Atlas pozostaje na serwerze.

## Vercel i Atlas

Zaimportuj repozytorium `hypereg/CrewConnect` jako projekt Vercel. Zostaw główny katalog repozytorium jako Root Directory. Plik `vercel.json` wskazuje katalog PWA, a Vercel uruchamia `api/workspace.mjs` jako funkcję Node.js.

W ustawieniach projektu dodaj `MONGODB_URI` jako sekret produkcyjny. Opcjonalnie ustaw `MONGODB_DATABASE`, jeśli baza ma inną nazwę niż `crewconnect`. Adresy wyjściowe funkcji muszą mieć dostęp do klastra Atlas. Po wdrożeniu PWA i API działają na tej samej domenie, więc `FRONTEND_ORIGIN` jest potrzebne tylko wtedy, gdy z API ma korzystać też osobny frontend GitHub Pages.

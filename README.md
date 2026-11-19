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

## Wspólny harmonogram i raporty głosowe

1. Ustaw jedno wspólne hasło `CREW_PASSWORD` i klucz `NVIDIA_API_KEY` w sekretach środowiskowych backendu.
2. Opcjonalnie ustaw `CREW_MEMBERS` z własną listą osób, np. `[{"id":"ola","name":"Ola Nowak"},{"id":"jan","name":"Jan Kowalski"}]`. Domyślnie dostępne są trzy profile demonstracyjne. Zachowaj identyfikatory `id` przy zmianie nazw, aby zachować przypisania.
3. Po restarcie wybierz **Warty i obowiązki → Moje przydziały**, wpisz hasło załogi i wybierz profil. Każdy, kto zna wspólne hasło, może wybrać dowolny profil. Przydziały dodasz w **Planie załogi**, a zapisane raporty znajdziesz w **Dzienniku raportów**.

Kolekcje `crewDuties` i `crewDutyReports` MongoDB przechowują wspólny harmonogram i dziennik. Załoga widzi wszystkie wpisy i może planować przydziały. Zapis wykonania i raportu z przydziału jest dostępny po wybraniu przypisanego profilu. Raporty ze wcześniejszego obszaru roboczego są dostępne w sekcji „Raporty w tej przeglądarce”. Instalacje bez `CREW_PASSWORD` korzystają z trybu demo.

Raport głosowy wymaga HTTPS lub `localhost` i dostępu do mikrofonu. Po wybraniu „Przygotuj szkic” aplikacja wysyła do [NVIDIA Parakeet RNNT Multilingual](https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/api) maksymalnie 30 sekund dźwięku. Po transkrypcji [Qwen3-Next przez NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/qwen-qwen3-next-80b-a3b-instruct-infer) redaguje polski raport. Użytkownik może odsłuchać nagranie i poprawić szkic przed zapisem. CrewConnect zapisuje w MongoDB wyłącznie zatwierdzony tekst. Backend potrzebuje dostępu do `grpc.nvcf.nvidia.com:443` i `integrate.api.nvidia.com:443`.

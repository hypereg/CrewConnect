# CrewConnect

## Wspólne demo wydarzeń

1. Użyj Node.js 22 lub nowszego, uruchom `npm ci` i `npm start`, a potem otwórz `http://localhost:3000`.
2. W lokalnym demie zaloguj się jako `admin@example.test` z kodem `crew-admin-demo`. W panelu admina utwórz rejs, dodaj kabinę i wygeneruj jej kod QR. W sekcji **Konta** utwórz plannera i zapisz jego indywidualny kod.
3. Otwórz link QR w drugiej przeglądarce lub na drugim telefonie. Podaj testowy e-mail gościa i wpisz kod `123456`. Planner używa tego samego ekranu logowania i własnego kodu.

Lokalnie serwer bez MongoDB współdzieli dane między przeglądarkami do czasu restartu procesu. Do testu na drugim telefonie uruchom serwer z `HOST=0.0.0.0` i otwórz go z obu urządzeń przez ten sam adres sieciowy przed wygenerowaniem QR. Test instalacji PWA i ponownego otwarcia offline wymaga HTTPS lub `localhost`.

### Wdrożenie demo

- Na Vercel lub serwerze Node pod HTTPS skonfiguruj `SOCIAL_MONGODB_URI` (lub `MONGODB_URI`), `DEMO_ADMIN_EMAIL`, indywidualny `DEMO_ADMIN_CODE` (min. 12 znaków) i losowy `DEMO_SESSION_SECRET` (min. 32 znaki). Ustaw `NODE_ENV=production` przy wdrożeniu Node. Dane demo trafiają do osobnej bazy `SOCIAL_MONGODB_DATABASE`, domyślnie `crewconnect_social_demo`.
- Użyj danych testowych. Kod gościa ma stałą wartość, a adres e-mail jest identyfikatorem demonstracyjnym.
- Hosting bez ustawień demo udostępnia poprzedni prototyp. Po ustawieniu zmiennych ekranem startowym stają się nowe wydarzenia.
- Uruchamiaj PWA i API z jednej domeny. Ustaw repozytoryjną zmienną `CREWCONNECT_API_URL` na adres wdrożonego demo, aby GitHub Pages kierował na tę domenę. Workflow zachowuje dotychczasową publikację, gdy zmienna jest pusta.
- Zestaw testów uruchamia polecenie `npm test`.

## Poprzednia wersja CrewConnect

Poniższe sekcje opisują zachowane moduły poprzedniego prototypu. W jego interfejsie były dostępne warty, obowiązki i raporty głosowe.

Backend wymaga Node.js 22. Wspólny harmonogram wymaga MongoDB. Jeśli korzystasz z Atlas, dodaj adres IP serwera aplikacji do listy dostępu i nadaj użytkownikowi bazy prawo odczytu oraz zapisu w bazie `crewconnect`.

1. Uruchom `npm ci`.
2. Skopiuj `.env.example` do `.env`. Aby włączyć synchronizację danych, ustaw `MONGODB_URI` na adres połączenia MongoDB. W hostingu ustaw go jako sekret środowiskowy. Plik `.env` jest ignorowany przez Git.
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
2. Każda osoba tworzy własny profil w zakładce **Mój profil**. Harmonogram pobiera nazwy z tych profili. Dawne przydziały przypisane do identyfikatorów z konfiguracji są zachowane w bazie.
3. Po restarcie wybierz **Warty i obowiązki → Moje przydziały**, wpisz hasło załogi i wybierz profil. Każdy, kto zna wspólne hasło, może wybrać dowolny profil. Przydziały dodasz w **Planie załogi**, a zapisane raporty znajdziesz w **Dzienniku raportów**.

Kolekcje `crewDuties` i `crewDutyReports` MongoDB przechowują wspólny harmonogram i dziennik. Załoga widzi wszystkie wpisy i może planować przydziały. Zapis wykonania i raportu z przydziału jest dostępny po wybraniu przypisanego profilu. Raporty ze wcześniejszego obszaru roboczego są dostępne w sekcji „Raporty w tej przeglądarce”. Instalacje bez `CREW_PASSWORD` korzystają z trybu demo.

Raport głosowy działa również w prototypie bez bazy. Wystarczy uruchomić backend z `CREW_PASSWORD` i `NVIDIA_API_KEY`, otworzyć raport i wpisać wspólne hasło załogi przy pierwszym użyciu mikrofonu w danej karcie. W trybie wspólnego harmonogramu wystarczy wcześniejsze zalogowanie.

Raport głosowy wymaga HTTPS lub `localhost` i dostępu do mikrofonu. Wybierz „Nagraj raport”, powiedz, co się wydarzyło, i kliknij „Zakończ i wyślij do AI”. [NVIDIA Parakeet RNNT Multilingual](https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/api) przepisuje do 30 sekund dźwięku, a [Qwen3-Next przez NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/qwen-qwen3-next-80b-a3b-instruct-infer) redaguje polski szkic. Gotowa treść trafia do edytowalnego pola raportu. Jeżeli użytkownik już coś wpisał, może sam zdecydować, czy zastąpić to szkicem. CrewConnect zapisuje wyłącznie zatwierdzony tekst. Backend potrzebuje dostępu do `grpc.nvcf.nvidia.com:443` i `integrate.api.nvidia.com:443`.

## Vercel i Atlas

Zaimportuj repozytorium `hypereg/CrewConnect` jako projekt Vercel. Zostaw główny katalog repozytorium jako Root Directory. Plik `vercel.json` wskazuje katalog PWA, a Vercel uruchamia funkcje Node.js z katalogu `api/`.

W ustawieniach projektu dodaj `MONGODB_URI` jako sekret produkcyjny. Opcjonalnie ustaw `MONGODB_DATABASE`, jeśli baza ma inną nazwę niż `crewconnect`. Adresy wyjściowe funkcji muszą mieć dostęp do klastra Atlas. Po wdrożeniu PWA i API działają na tej samej domenie, więc `FRONTEND_ORIGIN` jest potrzebne tylko wtedy, gdy z API ma korzystać też osobny frontend GitHub Pages.

Aby włączyć raporty głosowe na Vercel, ustaw tam również `CREW_PASSWORD` i `NVIDIA_API_KEY`.

## Mapa statku dla gości

W menu wybierz **Mapa statku**. Demo obejmuje 11 miejsc na pokładach 4–7 Wonder of the Seas. Mapa izometryczna pokazuje aktywny pokład i pobliski poziom, a podczas zmiany pokładu pokazuje poziom docelowy. Animowane strzałki prowadzą po korytarzach, windą lub schodami. Start wybiera się z listy lub wskazuje na mapie. Geometria korytarzy i odległości są poglądowe. [Plany Royal Caribbean](https://www.royalcaribbean.com/cruise-ships/wonder-of-the-seas/deck-plans)

**Zarządzaj miejscami** pozwala dodawać, przesuwać i usuwać pinezki. Wejście można wybrać z listy lub wskazać na mapie, gdzie zostanie przypisane do najbliższego korytarza. Z `MONGODB_URI` katalog powstaje przy pierwszym odczycie w kolekcji `shipMaps`. Ustaw osobny sekret `MAP_ADMIN_PASSWORD`, aby zmiany administratora trafiały do bazy i były widoczne dla gości. W trybie demo edycje zapisują się lokalnie w przeglądarce.

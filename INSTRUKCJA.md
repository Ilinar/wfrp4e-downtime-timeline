# WFRP4e: Oś czasu zajęć (Downtime) — instrukcja

**Do czego:** planowanie i rozliczanie czynności postaci między sesjami na siatce
**postacie × dni tygodnia** (tydzień czytany z Simple Calendar). Rzuty trafiają na czat,
a moduł automatycznie nalicza **koszt utrzymania**.

## Otwarcie
Ikona **kalendarza** w lewym pasku narzędzi sceny. Albo makro:
`game.modules.get("wfrp4e-downtime-timeline").api.open()`

## Widok
- Wiersze = **postacie graczy** (GM widzi całą drużynę). Kolumny = dni bieżącego tygodnia, „dziś" podświetlone.
- **‹ / ›** = poprzedni / następny tydzień, **Dziś** = bieżący tydzień.
- **Kafelki są kompaktowe**: ikona typu + nazwa (umiejętność testu, nazwa testu wydłużonego,
  „Dochód" + kwota, „Leczenie", „Przygoda"). Test pokazuje **rzut + PS** w jednej linii (np. „20 +3 PS").
- **Klik na postać lub jej kafelek rozwija cały wiersz** i pokazuje szczegóły oraz **„X" do skasowania**.
  W szczegółach: cel rzutu (np. „20 **na 50** +3 PS"), typ („Test" / „Test wydłużony" + umiejętność),
  przy dochodzie umiejętność, przy leczeniu „u kogo" + liczba schorzeń, przy przygodzie notatka,
  a także **koszt utrzymania** i **odpoczynek**. Drugi klik zwija. Gracz ma domyślnie rozwiniętą swoją
  postać; **MG klika, kogo chce podejrzeć**.
- Skróty „zrób teraz" pokazują się na pustym dniu (lub gdy wiersz jest rozwinięty); gdy dzień ma już
  kafelek, są schowane w szczegóły.
- **Klik w portret** otwiera kartę postaci (klik w nazwę/status dalej rozwija wiersz).

## Grupy i chowanie postaci
- Postacie są **grupowane wg folderów z zakładki Aktorzy** (np. „Bogen"); nagłówek grupy ma kolor folderu.
  **Klik w nagłówek zwija/rozwija grupę.** Postacie bez folderu trafiają do „Bez folderu". Gdy żadna postać
  nie jest w folderze, nagłówków nie ma. Przeniesienie postaci do innego folderu od razu przegrupowuje oś.
- **Oko** (prawy górny róg komórki postaci, po najechaniu) **chowa postać z osi**. W pasku pojawia się
  wtedy **„Ukryte (N)"** — włączenie pokazuje schowane postacie przyciemnione, z okiem do przywrócenia.
- Zwinięcie i schowanie są **osobne dla każdego użytkownika** (MG chowa u siebie, gracze mają swój widok)
  i zostają po odświeżeniu. Schowane/zwinięte wiersze **wypadają z zaznaczenia** trybu planowania.

## Akcje na dany dzień (ikony w komórce)
- 🎲 **Test** — wybierz umiejętność/cechę → rzut.
- ⏳ **Test wydłużony** — wybierz istniejący z karty albo **utwórz nowy** (utworzenie otwiera arkusz konfiguracji — trudność/cel; rzut wykonasz potem przez ⏳ → istniejący). Każdy rzut dolicza PS na karcie postaci.
- 🪙 **Dochód** — rzut dochodu z aktualnej kariery (zgodny z Income Scaler); kasę dodaje przycisk „Zastosuj” z czatu (albo automatycznie, gdy włączysz ustawienie).
- 🏕️ **Przygoda/podróż** — bez testu, opcjonalna notatka; checkbox **„nalicz koszt utrzymania"**
  (domyślnie tak — odznacz, jeśli ten dzień ma być bez utrzymania).
- ⚕️ **Leczenie** — podaj liczbę dolegliwości i **„u kogo"** (domyślnie „Kapłanki Shallyi") → koszt
  = utrzymanie + dopłata × dolegliwości.
- 💤 **Odpoczynek** — rzut na leczenie (Wytrzymałość). **Nie zużywa dnia, bez kosztu** (osobna sekcja).
- **X** (prawy górny róg karty, po rozwinięciu wiersza) = wyczyść wpis.
- **✎** (obok „X", przy przygodzie i leczeniu) = otwórz i edytuj notatkę (przygoda: opis; leczenie: „u kogo").

Pokazywane są tylko **zrealizowane** dni; szczegóły (rzut, cel, koszt, odpoczynek) widać po rozwinięciu wiersza.

## Status (standard życia) pod postacią
Pod nazwą postaci jest **„Status"** używany do **kosztu utrzymania** — jak na karcie postaci:
**lewy klik podpisu podnosi, prawy obniża** (po całej drabinie, z przejściem progu, np. Srebro 5 → Złoto 1),
można też **wpisać pełny status** („Srebro 5"). Zmianę pokazuje **strzałka ▲/▼** i kolor (zielony w górę,
czerwony w dół), a **↺** przywraca status z karty. Baza pochodzi z karty; **dochód liczy się dalej z karty
(bez zmian)** — status wpływa tylko na to, ile wydajesz na utrzymanie.

## Koszt utrzymania
Koszt pojawia się na osi (złoty chip w szczegółach) **dopiero po zaakceptowaniu** — odpowiada realnemu
wydatkowi z chwili rzutu i **nie zmienia się** po późniejszej zmianie statusu/modyfikatora.
- **Auto-pobieranie** (ustawienia): kasa schodzi od razu przy realizacji → chip od razu.
- **Ręcznie** (domyślnie): na czat trafia **karta „Zapłać"**; po kliknięciu kasa schodzi (dokładnie co do
  ¼p) i koszt pojawia się na osi. Brak środków / brak kliknięcia → chipu nie ma.
Leczenie: koszt = utrzymanie + dopłata × liczba schorzeń. Tryb wielu dni = jedna karta „Zapłać" za okres.
Kwoty są **ułamkowe** (z dokładnością do ćwierćpensa, jak Income Scaler).

## Modyfikatory kosztu dni (MG)
Przycisk **„Modyfikatory"** (tylko MG, obok „Tryb planowania"): **zamaluj nagłówki dni**, ustaw
**mnożnik kosztu** przyciskami **+/−** (krok 0,5; domyślnie 1) lub wpisem (np. 0 / 0,5 / 1,5 / 2 —
święto, klęska, drożyzna) + **powód**, „Zastosuj".
Modyfikator widać na nagłówku dnia („×0,5"), a po najechaniu dymek z mnożnikiem i powodem.
**×1 = usunięcie modyfikatora** (dzień wraca do normy; zajęć nie rusza). Reguła „dzień pracy"
(podwójny dochód w 1. dzień tygodnia) ma na nagłówku znaczek **⚒**.

## Tryb wielu dni (planowanie)
1. Kliknij **„Tryb planowania"** w pasku.
2. Wybierz czynność (Dochód / Przygoda / Leczenie / Test wydłużony / Odpoczynek).
3. **Zamaluj dni** (klik lub przeciągnięcie). Albo włącz tryb **„Zaznacz tydzień"** i **klikaj wiersze** —
   każdy klik zaznacza **wolne dni** widocznego tygodnia tej postaci (pomija dni już zajęte). Możesz przejść
   strzałką na kolejny tydzień i kliknąć następny wiersz — zaznaczenia się kumulują.
4. **„Wykonaj plan"** — rzuty lecą po cichu (**Dochód**, **Test wydłużony**, **Odpoczynek** pokazują okno
   rzutu **raz**). Dla **Przygody** po „Wykonaj plan" pojawia się **okno** z notatką i opcją kosztu.
   Na czacie jedno podsumowanie + jedna karta „Zapłać" za okres; każdy dzień widoczny na osi.
- **„Wyczyść dni"** — usuwa zajęcia **tylko z zamalowanych komórek** (dana postać + dany dzień; nie
  rusza całej kolumny ani innych graczy; z potwierdzeniem).

## Ustawienia (Konfiguracja → Ustawienia modułu)
- **Koszt życia: Brąz / Srebro / Złoto (na poziom)** — 3 pola; koszt dnia = wartość × standing.
- **Leczenie: Brąz / Srebro / Złoto (formuła)** — dopłata u Szaljanek za każdą dolegliwość, jako edytowalna
  formuła ze zmiennymi `daily` (koszt dnia) i `standing`. Domyślnie: Brąz „daily - 3", Srebro „standing * 5",
  Złoto „standing * 30". Możesz je zmienić (np. „standing * 7"); błędna formuła liczy 0.
- **Modyfikator downtime: Brąz / Srebro / Złoto (na poziom)** — modyfikator do **celu** testów robionych z osi
  (Test / Test wydłużony / Dochód) wg statusu **z karty**. Kumulatywnie po drabinie: +stawka_Brąz za każdy
  poziom Brązu, dalej +stawka_Srebro za poziomy Srebra, +stawka_Złoto za poziomy Złota; zaokrąglane w górę.
  Domyślnie 0,5 / 1 / 1,5 (np. Srebro 3 → +6). 0/0/0 = wyłączone. Dotyczy tylko rzutów z osi (nie zwykłych testów).
- **Karty kosztu utrzymania** — włącz/wyłącz automatyczne karty „Zapłać".
- **Automatycznie pobieraj koszt utrzymania** — gdy włączone (i powyższe też), koszt schodzi od
  razu z karty + potwierdzenie zamiast klikalnej karty; tryb wielu dni = jedno zbiorcze pobranie.
- **Automatyczne dodawanie kasy za dochód** — gdy włączone, pojedynczy dochód od razu dolicza
  kasę na kartę (w bp); domyślnie wyłączone (kasę dodaje przycisk „Zastosuj" Income Scalera).
- **Podwójny zarobek w pierwszy dzień tygodnia** (houserule) — gdy włączone, dochód w pierwszy
  dzień tygodnia (kalendarz imperialny z Simple Calendar) jest podwojony; karta z dopiskiem
  „(dzień pracy)".
- **Łącz sąsiednie identyczne dni** (per użytkownik, domyślnie wył.) — serie kolejnych dni o tym
  samym typie, nazwie i koszcie pokazują się (w widoku zwiniętym) jako **jeden szerszy kafelek z zakresem**
  (np. „Przygoda 25–27"). To tylko wizualizacja — dane, koszt i kasowanie zostają **per dzień**
  (po rozwinięciu wiersza widać dni osobno).
- **Liczba dni** — tylko fallback, gdy Simple Calendar jest wyłączony.

Zajęcia zapisują się na karcie postaci — gracz zarządza swoimi bez uprawnień GM.

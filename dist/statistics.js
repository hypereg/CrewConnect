let shipStatistics;
let shipStatisticsError = '';
let shipStatisticsLoading = false;
const statisticsNumber = new Intl.NumberFormat('pl-PL');

async function loadShipStatistics() {
  if (shipStatisticsLoading || location.hash !== '#statystyki') return;
  shipStatisticsLoading = true;
  try {
    await syncWorkspace();
    const response = await fetch('api/statistics', {cache:'no-store'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Statystyki są chwilowo niedostępne.');
    shipStatistics = result;
    shipStatisticsError = '';
  } catch (error) {
    shipStatisticsError = error.message;
  } finally {
    shipStatisticsLoading = false;
    if (location.hash === '#statystyki') render();
  }
}

function renderShipStatistics() {
  const heading = `<header class="statistics-header"><div><h1>Statystyki statku</h1>
    <p>Dane z CrewConnect dla MV Horizon</p></div>
    <button type="button" class="secondary" data-action="statistics-refresh">Odśwież dane</button></header>`;
  const error = shipStatisticsError ? `<p class="form-error" role="status">${escape(shipStatisticsError)}</p>` : '';
  const data = shipStatistics;
  if (!data) return heading + (error || '<p role="status">Wczytywanie statystyk…</p>');
  const count = value => statisticsNumber.format(value);
  const metric = (label,value) => `<div class="stat"><b>${count(value)}</b><span>${label}</span></div>`;
  const totals = data.places.reduce((sum,place) => ({
    bookings:sum.bookings+place.bookings,seats:sum.seats+place.seats,pastSeats:sum.pastSeats+place.pastSeats,
    reviews:sum.reviews+place.reviews
  }),{bookings:0,seats:0,pastSeats:0,reviews:0});
  return heading + error + `<section class="statistics-section"><h2>Załoga i aktywności</h2>
    <div class="statistics-grid">${metric('Aktywne profile załogi',data.members)}${metric('Opublikowane profile',data.publicProfiles)}
      ${metric('Dopasowania',data.matches)}${metric('Wydarzenia na tablicy',data.events)}
      ${metric('Wydarzenia z uzgodnionym terminem',data.scheduled)}${metric('Zapisy na wydarzenia',data.signups)}</div>
    <p class="muted">Liczba aktywnych profili pochodzi z portalu. Nie mierzy fizycznej obecności na statku.</p>
  </section>
  <section class="statistics-section"><h2>Restauracje</h2>
    <div class="statistics-grid">${metric('Restauracje',data.places.length)}${metric('Rezerwacje',totals.bookings)}
      ${metric('Zarezerwowane miejsca',totals.seats)}${metric('Miejsca w zakończonych terminach',totals.pastSeats)}
      ${metric('Opinie o restauracjach',totals.reviews)}</div>
    <p class="muted">Liczba miejsc pochodzi z rezerwacji. Portal nie rejestruje przybycia gości.</p>
    <div class="statistics-table" role="region" aria-label="Statystyki restauracji" tabindex="0"><table>
      <thead><tr><th scope="col">Restauracja</th><th scope="col">Rezerwacje</th><th scope="col">Miejsca</th><th scope="col">Opinie</th><th scope="col">Średnia</th></tr></thead>
      <tbody>${data.places.map(place => `<tr><th scope="row">${escape(place.name)}</th><td>${count(place.bookings)}</td>
        <td>${count(place.seats)}</td><td>${count(place.reviews)}</td><td>${place.average === null ? '—' :
          new Intl.NumberFormat('pl-PL',{maximumFractionDigits:1}).format(place.average) + '/5'}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>
  ${data.own && state.userProfile ? `<section class="statistics-section"><h2>Moje statystyki</h2><div class="statistics-grid">
    ${metric('Moje rezerwacje w przyszłych terminach',data.own.bookings)}${metric('Moje opinie',data.own.reviews)}</div></section>` : ''}`;
}

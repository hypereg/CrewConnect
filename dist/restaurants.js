let restaurantBoard;
let restaurantError = '';
let restaurantLoading = false;
const restaurantMoney = new Intl.NumberFormat('pl-PL', {style:'currency', currency:'PLN'});
const restaurantThemes = new Set(['ocean','ember','lagoon']);

async function restaurantRequest(payload) {
  const response = await fetch('api/restaurants', payload ? {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  } : {cache:'no-store'});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Restauracje są chwilowo niedostępne.');
  return result;
}

async function loadRestaurants() {
  if (restaurantLoading || location.hash !== '#restauracje') return;
  restaurantLoading = true;
  try {
    await syncWorkspace();
    restaurantBoard = await restaurantRequest();
    restaurantError = '';
  } catch (error) {
    restaurantError = error.message;
  } finally {
    restaurantLoading = false;
    if (location.hash === '#restauracje') render();
  }
}

function renderRestaurants() {
  const board = restaurantBoard;
  const error = restaurantError ? `<p class="form-error" role="status">${escape(restaurantError)}</p>` : '';
  const canBook = Boolean(board?.canBook && state.userProfile);
  const signIn = '<a class="secondary" href="#profil">Uzupełnij mój profil</a>';
  const hero = `<header class="restaurant-hero"><div><h1>Restauracje na pokładzie</h1>
    <p>Sprawdź menu, zaplanuj wspólny posiłek i podziel się opinią.</p></div>
    ${canBook ? '<button type="button" class="primary" data-action="restaurant-add">+ Dodaj restaurację</button>' : ''}</header>`;
  const welcome = renderWelcomeDraw();
  if (!board) return hero + welcome + (error ? error + '<button class="secondary" data-action="restaurant-refresh">Spróbuj ponownie</button>' : '<p role="status">Ładowanie restauracji…</p>');
  const ratingByRestaurant = new Map((board.ratings ?? []).map(rating => [rating.restaurantId,rating]));
  const ownReviewIds = new Set((board.ownReviews ?? []).map(review => review.restaurantId));
  const cards = board.restaurants.map(place => {
    const rating = ratingByRestaurant.get(place.id);
    const theme = restaurantThemes.has(place.theme) ? place.theme : 'ocean';
    const menu = place.menu.map(item => `<li><span>${escape(item.name)}</span><strong>${restaurantMoney.format(item.price / 100)}</strong></li>`).join('');
    const opinions = rating?.latest.map(item => `<article class="restaurant-opinion">
      <strong>${escape(item.author)}</strong><span aria-label="Ocena ${item.rating} na 5">${item.rating}/5 ★</span>
      ${item.comment ? `<p>${escape(item.comment)}</p>` : ''}</article>`).join('');
    return `<article class="card restaurant-card">
      <div class="restaurant-masthead ${theme}"><span>${escape(place.deck)}</span>
        <h2>${escape(place.name)}</h2><p>${escape(place.cuisine)}</p></div>
      <div class="restaurant-body">
        ${place.description ? `<p>${escape(place.description)}</p>` : ''}
        <h3>Menu</h3><ul class="restaurant-menu">${menu}</ul>
        <details class="restaurant-reviews"><summary>${rating ? `★ ${rating.average.toLocaleString('pl-PL',{maximumFractionDigits:1})}/5 · opinii: ${rating.count}` : 'Opinie'}</summary>
          ${opinions || '<p class="muted">Brak opinii.</p>'}</details>
        <div class="restaurant-actions">${canBook ? `
          <button class="primary" data-action="restaurant-reserve" data-id="${escape(place.id)}">Zarezerwuj stolik</button>
          <button class="secondary" data-action="restaurant-review" data-id="${escape(place.id)}">${ownReviewIds.has(place.id) ? 'Edytuj opinię' : 'Dodaj opinię'}</button>` : signIn}</div>
      </div></article>`;
  }).join('');
  const bookings = canBook ? `<section class="restaurant-bookings"><h2>Moje rezerwacje</h2>
    ${board.reservations.length ? board.reservations.map(item => `<article class="card restaurant-booking">
      <div><h3>${escape(item.restaurantName)}</h3><p>${formatDate(item.date + 'T' + item.time)} · stolik ${item.table} · osób: ${item.guests}${item.freeItem ? ` · darmowy deser: ${escape(item.freeItem)}` : item.discount ? ` · kupon −${item.discount}%` : ''}</p></div>
      <button class="secondary" data-action="restaurant-cancel" data-id="${escape(item.id)}">Anuluj rezerwację</button>
    </article>`).join('') : '<p class="muted">Nie masz nadchodzących rezerwacji.</p>'}
  </section>` : '';
  return hero + welcome + error + `<div class="restaurant-grid">${cards}</div>` + bookings;
}

function parseRestaurantMenu(value) {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(.+?)\s*[|]\s*(\d+(?:[.,]\d{1,2})?)$/);
    if (!match) throw new Error('Wpisz każdą pozycję w osobnej linii w formacie: nazwa | cena.');
    return {name:match[1].trim(),price:Math.round(Number(match[2].replace(',','.')) * 100)};
  });
}

async function handleRestaurantAction(action, id) {
  if (action === 'restaurant-refresh') return loadRestaurants();
  if (!restaurantBoard?.canBook || !state.userProfile) return;
  const place = restaurantBoard.restaurants.find(item => item.id === id);
  const finish = async (payload, message) => {
    await restaurantRequest(payload);
    await loadRestaurants();
    announce(message);
  };
  if (action === 'restaurant-add') {
    openForm('Dodaj restaurację', `
      <label>Nazwa <input name="name" maxlength="65" required></label>
      <label>Rodzaj kuchni <input name="cuisine" maxlength="60" required></label>
      <label>Lokalizacja <input name="deck" maxlength="40" placeholder="Np. Pokład 7" required></label>
      <label>Opis <textarea name="description" rows="2" maxlength="240"></textarea></label>
      <label>Liczba stolików <input name="tableCount" type="number" min="1" max="20" value="5" required></label>
      <label>Menu i ceny w PLN <textarea name="menu" rows="4" maxlength="1400" placeholder="Makaron | 32,50" required></textarea></label>
      <small class="muted">Jedna pozycja w wierszu. Oddziel nazwę od ceny znakiem |.</small>`,
      'Dodaj restaurację', data => finish({action:'addRestaurant',name:data.get('name'),cuisine:data.get('cuisine'),
        deck:data.get('deck'),description:data.get('description'),tableCount:Number(data.get('tableCount')),menu:parseRestaurantMenu(data.get('menu'))}, 'Dodano restaurację.'));
  } else if (action === 'restaurant-reserve' && place) {
    const applicable = (restaurantBoard.ownCoupons ?? []).filter(coupon => coupon.restaurantId === id);
    openForm('Zarezerwuj stolik', `<p>${escape(place.name)} · rezerwacja na 90 min</p>
      <label>Data <input type="date" name="date" min="${dateValue()}" max="${dateValue(30)}" value="${dateValue()}" required></label>
      <label>Godzina <select name="time">${restaurantBoard.times.map(time => `<option>${escape(time)}</option>`).join('')}</select></label>
      <label>Liczba osób <input type="number" name="guests" min="1" max="${Math.max(...place.tables)}" value="2" required></label>
      ${applicable.length ? `<label>Bon lub kupon <select name="couponId"><option value="">Bez bonu lub kuponu</option>
        ${applicable.map(coupon => `<option value="${escape(coupon.id)}">${escape(restaurantCouponLabel(coupon))}</option>`).join('')}</select></label>` : ''}`,
      'Potwierdź rezerwację', data => finish({action:'reserve',restaurantId:id,date:data.get('date'),time:data.get('time'),guests:Number(data.get('guests')),couponId:data.get('couponId')},'Stolik zarezerwowany.'));
  } else if (action === 'restaurant-review' && place) {
    const review = restaurantBoard.ownReviews?.find(item => item.restaurantId === id);
    openForm(review ? 'Edytuj opinię' : 'Dodaj opinię', `<p>${escape(place.name)}</p>
      <label>Ocena <select name="rating">${[5,4,3,2,1].map(value => `<option value="${value}" ${value === review?.rating ? 'selected' : ''}>${value}/5 ★</option>`).join('')}</select></label>
      <label>Komentarz <textarea name="comment" maxlength="360" rows="3">${escape(review?.comment ?? '')}</textarea></label>
      <small class="muted">Ocena, komentarz i Twoja nazwa będą widoczne na karcie restauracji.</small>`,
      'Zapisz opinię', data => finish({action:'review',restaurantId:id,rating:Number(data.get('rating')),comment:data.get('comment')},'Zapisano opinię.'));
  } else if (action === 'restaurant-cancel' && window.confirm('Anulować tę rezerwację?')) {
    try {
      await finish({action:'cancel',id},'Anulowano rezerwację.');
    } catch (error) {
      announce(error.message);
    }
  }
}

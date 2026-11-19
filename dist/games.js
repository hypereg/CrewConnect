let welcomeDraw;
let welcomeDrawLoading = false;
let welcomeDrawPending = false;
let welcomeDrawError = '';
let welcomeDrawResult = '';

async function requestWelcomeDraw(method = 'GET') {
  const response = await fetch('api/games', {method, cache: 'no-store'});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Losowanie jest chwilowo niedostępne.');
  return result;
}

async function loadWelcomeDraw() {
  if (welcomeDrawLoading || welcomeDrawPending || !state.userProfile || location.hash !== '#restauracje') return;
  const profile = state.userProfile.id;
  welcomeDrawLoading = true;
  try {
    await syncWorkspace();
    const result = await requestWelcomeDraw();
    if (state.userProfile?.id === profile) {
      welcomeDraw = result;
      welcomeDrawError = '';
    }
  } catch (error) {
    if (state.userProfile?.id === profile) welcomeDrawError = error.message;
  } finally {
    welcomeDrawLoading = false;
    if (location.hash === '#restauracje') render();
  }
}

function resetWelcomeDraw() {
  welcomeDraw = undefined;
  welcomeDrawError = '';
  welcomeDrawResult = '';
}

function restaurantCouponLabel(coupon) {
  return coupon.freeItem ? `Bon na deser · ${coupon.freeItem}` : `Kupon −${coupon.percent}%`;
}

function renderWelcomeDraw() {
  const account = state.userProfile;
  const coupons = (welcomeDraw?.coupons ?? []).map(coupon => `<li>
    <strong>${escape(restaurantCouponLabel(coupon))} · ${escape(coupon.restaurantName)}</strong>
    <span>${coupon.bookingId ? 'Dołączony do rezerwacji' : 'Ważny do ' + formatDate(coupon.expiresAt.slice(0, 10))}</span>
  </li>`).join('');
  return `<section class="card welcome-draw" aria-labelledby="welcome-draw-title">
    <div>
      <h2 id="welcome-draw-title">Powitanie przy stole</h2>
      <p>Na powitanie każdy pasażer dostaje 3 losowania. Do wygrania jest jeden bon na darmowy deser w restauracji na pokładzie. Bon wykorzystasz podczas rezerwacji stolika w ciągu 7 dni.</p>
      ${account ? `
        <p class="muted">${welcomeDraw ? `Pozostało losowań: ${welcomeDraw.remaining} z 3` : welcomeDrawLoading ? 'Sprawdzanie dostępnych losowań…' : ''}</p>
        <button class="primary" data-action="welcome-draw" ${welcomeDrawPending || !welcomeDraw?.remaining ? 'disabled' : ''}>${welcomeDrawPending ? 'Losowanie…' : 'Weź udział w losowaniu'}</button>
        <p role="status">${escape(welcomeDrawResult)}</p>
        ${welcomeDrawError ? `<p class="form-error" role="alert">${escape(welcomeDrawError)}</p><button class="secondary" data-action="welcome-draw-refresh">Sprawdź ponownie</button>` : ''}
      ` : '<a href="#profil">Uzupełnij profil, aby odebrać losowania</a>'}
    </div>
    ${coupons ? `<div><h3>Moje bony i kupony</h3><ul class="welcome-coupons">${coupons}</ul></div>` : ''}
  </section>`;
}

async function drawWelcomeReward() {
  if (welcomeDrawPending || welcomeDrawLoading || !welcomeDraw?.remaining || !state.userProfile) return;
  const profile = state.userProfile.id;
  welcomeDrawPending = true;
  welcomeDrawResult = '';
  welcomeDrawError = '';
  render();
  try {
    const result = await requestWelcomeDraw('POST');
    if (state.userProfile?.id !== profile) return;
    welcomeDraw = {
      remaining: result.remaining,
      coupons: result.coupon ? [result.coupon, ...welcomeDraw.coupons] : welcomeDraw.coupons
    };
    welcomeDrawResult = result.coupon
      ? `Twój bon na darmowy deser w restauracji ${result.coupon.restaurantName} jest gotowy.`
      : 'Tym razem bon nie został wylosowany.';
    if (result.coupon) void loadRestaurants();
  } catch (error) {
    if (state.userProfile?.id === profile) welcomeDrawError = error.message;
  } finally {
    welcomeDrawPending = false;
    if (location.hash === '#restauracje') render();
  }
}

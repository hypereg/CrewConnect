const gameTabs={slots:'Sloty',roulette:'Ruletka',blackjack:'Blackjack'};
const gameSymbols=['🍒','🍋','💎','⭐','⚓','7️⃣'];
const casinoWheel=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const redNumbers=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const gameColor=value=>value===0?'green':redNumbers.has(value)?'red':'black';
const gameColorLabel={red:'czerwone',black:'czarne',green:'zielone'};
const motionOff=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const gameSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let gameTab='slots';
let gameBoard;
let gameLoading=false;
let gameError='';
let slotBusy=false;
let slotValues=['🍒','⚓','⭐'];
let slotStatus='';
let rouletteBusy=false;
let rouletteAngle=0;
let rouletteChoice='red';
let rouletteStatus='';
let blackjack;

async function gameRequest(method='GET'){
  const response=await fetch('api/games',{method,cache:'no-store'});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || 'Automat jest chwilowo niedostępny.');
  return data;
}

async function loadGameBoard(){
  if(gameLoading||!state.userProfile||location.hash!=='#gry')return;
  const profile=state.userProfile.id;
  gameLoading=true;
  try{
    if(syncing)await syncing;
    const board=await gameRequest();
    if(state.userProfile?.id===profile){gameBoard=board;gameError='';}
  }catch(error){
    if(state.userProfile?.id===profile)gameError=error.message;
  }finally{
    gameLoading=false;
    updateGameView();
  }
}

function updateGameView(){
  if(location.hash==='#gry')render();
}

function resetGameSession(){
  gameBoard=undefined;
  gameError='';
  slotStatus='';
  slotValues=['🍒','⚓','⭐'];
}

function renderGameSlots(){
  const coupons=(gameBoard?.coupons??[]).map(coupon=>`<li><strong>−${coupon.percent}% · ${escape(coupon.restaurantName)}</strong>
    <span>${coupon.bookingId?'Przypięty do rezerwacji':'Ważny do '+formatDate(coupon.expiresAt.slice(0,10))}</span></li>`).join('');
  return `<section class="card game-table"><h2>Automat z kuponami</h2>
    <p>Trzy takie same symbole wygrywają kupon 20–30% do jednej z przykładowych restauracji. Masz 8 obrotów i maksymalnie 1 kupon dziennie.</p>
    <div class="slot-reels${slotBusy?' spinning':''}" aria-hidden="true">${slotValues.map(symbol=>`<span>${symbol}</span>`).join('')}</div>
    <p class="game-result" role="status">${escape(slotStatus)}</p>
    ${state.userProfile?`<button class="primary" data-action="game-spin" ${slotBusy||!gameBoard||!gameBoard.remaining?'disabled':''}>Zakręć</button>
      <p class="muted">${gameBoard?`Pozostało obrotów dziś: ${gameBoard.remaining}`:'Sprawdzanie limitu obrotów…'}</p>`:
      '<a href="#profil">Utwórz profil, żeby grać o kupony</a>'}
    ${gameError?`<p class="form-error">${escape(gameError)}</p><button class="secondary" data-action="game-refresh">Spróbuj ponownie</button>`:''}
    </section>
    ${state.userProfile?`<section class="card game-side"><h2>Moje kupony</h2>
      ${coupons?`<ul class="game-coupons">${coupons}</ul>`:'<p class="muted">Nie masz aktywnych kuponów.</p>'}
      <a href="#restauracje">Przejdź do restauracji</a></section>`:''}`;
}

function renderRoulette(){
  const arc=360/casinoWheel.length;
  const palette={red:'#a33644',black:'#242c40',green:'#237155'};
  const segments=casinoWheel.map((number,index)=>`${palette[gameColor(number)]} ${index*arc}deg ${(index+1)*arc}deg`).join(',');
  return `<section class="card game-table"><h2>Ruletka</h2><p>Wybierz kolor i sprawdź, gdzie zatrzyma się koło.</p>
    <div class="roulette-frame" aria-hidden="true"><span class="roulette-pointer"></span>
      <div class="roulette-wheel" style="--wheel-angle:${rouletteAngle}deg;--wheel-start:${-arc/2}deg;--wheel-segments:${segments}">
        ${casinoWheel.map((number,index)=>`<span style="--wheel-index:${index*arc}deg">${number}</span>`).join('')}
        <b>⚓</b></div></div>
    <div class="game-controls">
      <label for="roulette-color">Kolor <select id="roulette-color" ${rouletteBusy?'disabled':''}>
        ${Object.entries(gameColorLabel).map(([key,label])=>`<option value="${key}" ${key===rouletteChoice?'selected':''}>${label}</option>`).join('')}
      </select></label>
      <button class="primary" data-action="game-roulette" ${rouletteBusy?'disabled':''}>Zakręć kołem</button></div>
    <p class="game-result" role="status">${escape(rouletteStatus)}</p></section>`;
}

function dealCard(deck){return deck.pop();}
function blackjackTotal(hand){
  let total=hand.reduce((sum,card)=>sum+Math.min(card.rank,10),0);
  if(hand.some(card=>card.rank===1)&&total+10<=21)total+=10;
  return total;
}
function newBlackjack(){
  const deck=['♠','♥','♦','♣'].flatMap(suit=>Array.from({length:13},(_,index)=>({suit,rank:index+1})));
  for(let index=deck.length-1;index>0;index--){
    const next=Math.floor(Math.random()*(index+1));
    [deck[index],deck[next]]=[deck[next],deck[index]];
  }
  const player=[dealCard(deck),dealCard(deck)],dealer=[dealCard(deck),dealCard(deck)];
  blackjack={deck,player,dealer,result:''};
  const playerNatural=blackjackTotal(player)===21,dealerNatural=blackjackTotal(dealer)===21;
  if(playerNatural||dealerNatural)blackjack.result=playerNatural&&dealerNatural?'Remis.':
    playerNatural?'Blackjack! Wygrywasz.':'Krupier ma blackjacka.';
}
function finishBlackjack(){
  const {player,dealer,deck}=blackjack;
  const score=blackjackTotal(player);
  if(score>21){blackjack.result='Powyżej 21. Wygrywa krupier.';return;}
  while(blackjackTotal(dealer)<17)dealer.push(dealCard(deck));
  const dealerScore=blackjackTotal(dealer);
  blackjack.result=dealerScore>21||score>dealerScore?'Wygrywasz!':score===dealerScore?'Remis.':'Wygrywa krupier.';
}
function renderBlackjack(){
  const cards=(hand,cover)=>hand.map((card,index)=>index===1&&cover?
    '<span class="blackjack-card covered" aria-label="Zakryta karta">◆</span>':
    `<span class="blackjack-card ${['♥','♦'].includes(card.suit)?'red':''}">${['','A','2','3','4','5','6','7','8','9','10','J','Q','K'][card.rank]} <b>${card.suit}</b></span>`).join('');
  return `<section class="card game-table blackjack-table"><h2>Blackjack</h2><p>Zbliż się do 21, nie przekraczając tej liczby.</p>
    ${blackjack?`<div class="blackjack-hands"><div><h3>Krupier ${blackjack.result?'· '+blackjackTotal(blackjack.dealer):''}</h3>
      <div class="blackjack-hand">${cards(blackjack.dealer,!blackjack.result)}</div></div>
      <div><h3>Twoja ręka · ${blackjackTotal(blackjack.player)}</h3>
      <div class="blackjack-hand">${cards(blackjack.player,false)}</div></div></div>`:''}
    <p class="game-result" role="status">${escape(blackjack?.result ?? '')}</p>
    <div class="game-controls">${!blackjack||blackjack.result?'<button class="primary" data-action="game-blackjack-start">Rozdaj karty</button>':
      '<button class="primary" data-action="game-blackjack-hit">Dobierz</button><button class="secondary" data-action="game-blackjack-stand">Pas</button>'}</div></section>`;
}

function renderGames(){
  return `<header class="games-hero"><h1>Gry na pokładzie</h1>
    <p>Wszystkie gry są darmowe. W slotach możesz wygrać kupon do restauracji pokazanej w portalu.</p></header>
    <nav class="game-tabs" aria-label="Wybierz grę">${Object.entries(gameTabs).map(([key,label])=>
      `<button class="secondary" data-action="game-tab" data-id="${key}" aria-pressed="${gameTab===key}">${label}</button>`).join('')}</nav>
    <div class="game-layout">${gameTab==='slots'?renderGameSlots():gameTab==='roulette'?renderRoulette():renderBlackjack()}</div>`;
}

async function spinSlots(){
  if(slotBusy||!gameBoard?.remaining||!state.userProfile)return;
  const profile=state.userProfile.id;
  slotBusy=true;
  slotStatus='Automat się kręci…';
  gameError='';
  updateGameView();
  const animation=motionOff()?null:setInterval(()=>{
    const reels=content.querySelectorAll('.slot-reels span');
    reels.forEach(reel=>reel.textContent=gameSymbols[Math.floor(Math.random()*gameSymbols.length)]);
  },90);
  try{
    const [result]=await Promise.all([gameRequest('POST'),gameSleep(motionOff()?0:970)]);
    if(state.userProfile?.id!==profile)return;
    slotValues=result.reels;
    gameBoard={remaining:result.remaining,coupons:result.coupon?[result.coupon,...gameBoard.coupons]:gameBoard.coupons};
    slotStatus=result.coupon?`Wygrywasz −${result.coupon.percent}% w ${result.coupon.restaurantName}!`:'Tym razem bez wygranej.';
  }catch(error){
    if(state.userProfile?.id===profile){slotStatus='';gameError=error.message;}
  }finally{
    clearInterval(animation);
    slotBusy=false;
    updateGameView();
  }
}

async function spinRoulette(){
  if(rouletteBusy)return;
  rouletteBusy=true;
  rouletteStatus='Koło się kręci…';
  const index=Math.floor(Math.random()*casinoWheel.length);
  const number=casinoWheel[index];
  const result=gameColor(number);
  const start=rouletteAngle;
  rouletteAngle=360*Math.ceil(rouletteAngle/360)+1440-index*(360/casinoWheel.length);
  updateGameView();
  const wheel=content.querySelector('.roulette-wheel');
  if(!motionOff()&&wheel?.animate){
    await wheel.animate([{transform:`rotate(${start}deg)`},{transform:`rotate(${rouletteAngle}deg)`}],
      {duration:2800,easing:'cubic-bezier(.12,.62,.14,1)'}).finished.catch(()=>{});
  }
  rouletteBusy=false;
  rouletteStatus=`Wypadło ${number}, ${gameColorLabel[result]}. ${result===rouletteChoice?'Trafiony kolor!':'Spróbuj ponownie.'}`;
  updateGameView();
}

function handleGameAction(action,id){
  if(action==='game-tab'&&Object.hasOwn(gameTabs,id)){gameTab=id;updateGameView();}
  else if(action==='game-refresh')void loadGameBoard();
  else if(action==='game-spin')void spinSlots();
  else if(action==='game-roulette')void spinRoulette();
  else if(action==='game-blackjack-start'){newBlackjack();updateGameView();}
  else if(action==='game-blackjack-hit'&&blackjack&&!blackjack.result){
    blackjack.player.push(dealCard(blackjack.deck));
    if(blackjackTotal(blackjack.player)>=21)finishBlackjack();
    updateGameView();
  }else if(action==='game-blackjack-stand'&&blackjack&&!blackjack.result){finishBlackjack();updateGameView();}
}

// =====================================================================
// /shop — vitrina de gold. Un singur GET aduce catalogul, gold-ul si
// proprietatile; cumpararea e un POST cu confirmare in doi pasi (click
// pe card → click pe „Confirma"), ca sa nu arunci gold-ul din greseala.
// =====================================================================
import { api, renderNav, toast, clearSession, withBusy , whenActive , getSession, applySiteTheme, initChat } from './core.js';


let data = null;
let myName = 'tunn';

function paint() {
  const grid = document.getElementById('shop-grid');
  const goldEl = document.getElementById('shop-gold');
  if (!data) return;

  goldEl.textContent = `🪙 ${data.gold.toLocaleString('ro-RO')}`;
  // Banner boost XP (⚡ Boost 24h): cat e activ, tot XP-ul e dublu.
  const boostEl = document.getElementById('shop-boost');
  if (boostEl) {
    const until = data.boost_until || 0;
    if (data.boost_active && until > Date.now()) {
      const ms = until - Date.now();
      boostEl.hidden = false;
      boostEl.textContent = `⚡ Boost XP activ — tot XP-ul e dublu încă ${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m.`;
    } else boostEl.hidden = true;
  }
  paintColors();
  paintThemes();
  grid.innerHTML = '';

  for (const item of data.items) {
    const card = document.createElement('div');
    card.className = 'shop-card box';
    if (item.owned) card.classList.add('shop-card--owned');

    const icon = document.createElement('div');
    icon.className = 'shop-card__icon';
    icon.textContent = item.icon;

    const name = document.createElement('h3');
    name.className = 'shop-card__name';
    name.textContent = item.name;

    const desc = document.createElement('p');
    desc.className = 'shop-card__desc';
    desc.textContent = item.desc;

    const foot = document.createElement('div');
    foot.className = 'shop-card__foot';

    const price = document.createElement('span');
    price.className = 'shop-card__price';
    price.textContent = `🪙 ${item.price.toLocaleString('ro-RO')}`;
    foot.appendChild(price);

    if (item.consumable && item.qty > 0) {
      const have = document.createElement('span');
      have.className = 'shop-card__qty';
      have.textContent = `ai ${item.qty}`;
      foot.appendChild(have);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    if (item.owned) {
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = '✅ Deținut';
      btn.disabled = true;
    } else if (data.gold < item.price) {
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = 'Gold insuficient';
      btn.disabled = true;
    } else {
      btn.className = 'btn btn--accent btn--sm';
      btn.textContent = 'Cumpără';
      btn.addEventListener('click', () => confirmBuy(item, btn));
    }
    foot.appendChild(btn);

    card.append(icon, name, desc, foot);
    grid.appendChild(card);
  }
}

// ---------------- culori de nume ----------------
function paintColors() {
  const grid = document.getElementById('colors-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const c of data.colors || []) {
    const card = document.createElement('div');
    card.className = 'color-card box';
    if (c.active) card.classList.add('color-card--active');

    const demo = document.createElement('div');
    demo.className = 'color-card__demo';
    const nm = document.createElement('span');
    nm.className = 'color-card__name';
    nm.textContent = myName;
    if (c.special === 'rainbow') nm.classList.add('nc-rainbow');
    else if (c.special === 'sunset') nm.classList.add('nc-sunset');
    else if (c.special === 'glow') { nm.classList.add(`nc-${c.id.slice(6)}`, 'nc-glow'); }
    else nm.classList.add(`nc-${c.id.slice(6)}`);
    demo.append('Culoare: ', nm);

    const foot = document.createElement('div');
    foot.className = 'color-card__foot';
    const price = document.createElement('span');
    price.className = 'color-card__price';
    price.textContent = `🪙 ${c.price.toLocaleString('ro-RO')}`;
    foot.appendChild(price);
    foot.appendChild(actionBtn(c, () => activate(c, card)));
    card.append(demo, foot);
    grid.appendChild(card);
  }
}

// ---------------- teme ----------------
function paintThemes() {
  const grid = document.getElementById('themes-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const t of data.themes || []) {
    const card = document.createElement('div');
    card.className = 'theme-card box';
    if (t.active) card.classList.add('theme-card--active');

    const name = document.createElement('h3');
    name.className = 'theme-card__name';
    name.textContent = t.id === 'theme_standard' && data.seasonal ? `Standard (sezon: ${data.seasonal.name})` : t.name;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'theme-card__peek';
    chip.textContent = 'Vezi cum arată';
    chip.addEventListener('click', () => peekTheme(t.id));

    const foot = document.createElement('div');
    foot.className = 'color-card__foot';
    const price = document.createElement('span');
    price.className = 'color-card__price';
    price.textContent = t.seasonal && t.owned ? '🍂 Deținută (sezon)' : t.price <= 1 ? 'Gratuit' : `🪙 ${t.price.toLocaleString('ro-RO')}`;
    foot.appendChild(price);
    foot.appendChild(actionBtn(t, () => activate(t, card)));
    card.append(name, chip, foot);
    grid.appendChild(card);
  }
}

/** Butonul potrivit stării: Activ / Activează / Cumpără (+confirmare) / Gold insuficient. */
function actionBtn(item, onActivate) {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (item.active) {
    btn.className = 'btn btn--accent btn--sm';
    btn.textContent = '✓ Activ';
    btn.disabled = true;
  } else if (item.owned) {
    btn.className = 'btn btn--ghost btn--sm';
    btn.textContent = 'Activează';
    btn.addEventListener('click', onActivate);
  } else if (data.gold < item.price) {
    btn.className = 'btn btn--ghost btn--sm';
    btn.textContent = 'Gold insuficient';
    btn.disabled = true;
  } else {
    btn.className = 'btn btn--accent btn--sm';
    btn.textContent = 'Cumpără';
    btn.addEventListener('click', () => confirmBuy(item, btn, () => activate(item, btn)));
  }
  return btn;
}

/** Previzualizare temporară (5s) a unei teme, fără să o cumperi. */
function setThemeClass(slug) {
  document.body.classList.remove(...[...document.body.classList].filter((c) => c.startsWith('theme-') && c !== 'theme-rank'));
  if (slug) document.body.classList.add(`theme-${slug}`);
}
function currentThemeSlug() {
  return data.active_theme && data.active_theme !== 'theme_standard' ? data.active_theme.slice(6) : null;
}
function peekTheme(themeId) {
  const slug = themeId === 'theme_standard' ? null : themeId.slice(6);
  setThemeClass(slug);
  toast('👁️ Previzualizare 5 secunde…', 'info', 2000);
  setTimeout(() => setThemeClass(currentThemeSlug()), 5000);
}

/** Activează un cosmetic deținut (culoare sau temă). */
async function activate(item, btn) {
  const isColor = item.id.startsWith('color_');
  await withBusy(btn, async () => {
    const res = await api('/shop/activate', {
      method: 'POST',
      body: { type: isColor ? 'color' : 'theme', id: item.id },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut activa', 'error'); return; }
    if (isColor) data.active_name_color = res.data.active_name_color;
    else {
      data.active_theme = res.data.active_theme;
      applySiteTheme(res.data.active_theme); // aplica + sincronizeaza cache-ul instant
    }
    // împrospătăm stările active/owned din răspunsul local
    for (const c of data.colors || []) c.active = c.id === data.active_name_color;
    for (const t of data.themes || []) t.active = t.id === (data.active_theme || 'theme_standard');
    paint();
    clearSession();
    renderNav('');
    toast(isColor ? '🎨 Culoarea numelui a fost activată!' : '🖌️ Tema a fost activată!', 'success');
  });
}

function confirmBuy(item, btn, after) {
  // Al doilea click pe acelasi buton = confirmarea.
  if (btn.dataset.confirm) {
    buy(item, btn, after);
    return;
  }
  btn.dataset.confirm = '1';
  btn.textContent = `Sigur? −${item.price.toLocaleString('ro-RO')} 🪙`;
  setTimeout(() => {
    if (btn.dataset.confirm) {
      delete btn.dataset.confirm;
      if (!btn.disabled) btn.textContent = 'Cumpără';
    }
  }, 4000);
}

async function buy(item, btn, after) {
  await withBusy(btn, async () => {
    const res = await api('/shop/buy', { method: 'POST', body: { item_id: item.id } });
    if (!res.ok) {
      toast(res.data?.error || 'Cumpărarea a eșuat.', 'error');
      return;
    }
    delete btn.dataset.confirm;
    if (res.data.refetch) {
      // Articolele instant/pachet schimba mai multe lucruri deodata (gold
      // primit inapoi, boost, chei creditate) — reincarcam starea, nu o peticim.
      const fresh = await api('/shop');
      if (fresh.ok) data = fresh.data;
    } else {
      data.gold = res.data.gold;
      if (item.id.startsWith('color_')) {
        const c = (data.colors || []).find((x) => x.id === item.id);
        if (c) { c.owned = true; c.can_buy = false; }
      } else if (item.id.startsWith('theme_')) {
        const t = (data.themes || []).find((x) => x.id === item.id);
        if (t) { t.owned = true; t.can_buy = false; }
      } else {
        for (const it of data.items) {
          if (it.id === item.id) it.qty = res.data.qty;
          it.owned = !it.consumable && it.qty > 0;
        }
      }
    }
    paint();
    clearSession();          // gold-ul din nav se reimprospateaza
    renderNav('');
    const doneMsg = res.data.reward_text ? `🎁 ${res.data.reward_text}`
      : res.data.boost_until ? '⚡ Boost XP activ — tot XP-ul e dublu 24h!'
      : res.data.xp_granted ? `📚 +${res.data.xp_granted} XP!`
      : `✅ ${item.name || 'Articol'} e al tău!`;
    toast(doneMsg, 'success');
    if (after) await after();
  });
}

async function load() {
  const [nav, res] = await Promise.all([renderNav('/shop'), api('/shop')]);
  const me = await getSession().catch(() => null);
  if (me?.username) myName = me.username;
whenActive(() => initChat().catch(() => { /* chat optional */ }));
  if (!nav) { location.replace('/login?next=/shop'); return; }
  if (!res.ok) {
    document.getElementById('shop-grid').innerHTML =
      '<div class="empty">Nu am putut încărca shop-ul.</div>';
    return;
  }
  data = res.data;
  paint();
}

load();

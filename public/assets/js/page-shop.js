// =====================================================================
// /shop — vitrina de gold. Un singur GET aduce catalogul, gold-ul si
// proprietatile; cumpararea e un POST cu confirmare in doi pasi (click
// pe card → click pe „Confirma"), ca sa nu arunci gold-ul din greseala.
// =====================================================================
import { api, renderNav, toast, clearSession, withBusy , whenActive } from './core.js';
import { initChat } from './chat.js';

let data = null;

function paint() {
  const grid = document.getElementById('shop-grid');
  const goldEl = document.getElementById('shop-gold');
  if (!data) return;

  goldEl.textContent = `🪙 ${data.gold.toLocaleString('ro-RO')}`;
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
      btn.addEventListener('click', () => confirmBuy(card, item, btn));
    }
    foot.appendChild(btn);

    card.append(icon, name, desc, foot);
    grid.appendChild(card);
  }
}

function confirmBuy(card, item, btn) {
  // Al doilea click pe acelasi buton = confirmarea.
  if (btn.dataset.confirm) {
    buy(item, btn);
    return;
  }
  for (const b of card.querySelectorAll('[data-confirm]')) {
    delete b.dataset.confirm;
    b.textContent = 'Cumpără';
  }
  btn.dataset.confirm = '1';
  btn.textContent = `Sigur? −${item.price} 🪙`;
  setTimeout(() => {
    if (btn.dataset.confirm) {
      delete btn.dataset.confirm;
      if (!btn.disabled) btn.textContent = 'Cumpără';
    }
  }, 4000);
}

async function buy(item, btn) {
  await withBusy(btn, async () => {
    const res = await api('/shop/buy', { method: 'POST', body: { item_id: item.id } });
    if (!res.ok) {
      toast(res.data?.error || 'Cumpărarea a eșuat.', 'error');
      return;
    }
    delete btn.dataset.confirm;
    data.gold = res.data.gold;
    for (const it of data.items) {
      if (it.id === item.id) it.qty = res.data.qty;
      it.owned = !it.consumable && it.qty > 0;
    }
    paint();
    clearSession();          // gold-ul din nav se reimprospateaza
    renderNav('');
    toast(item.id === 'chest_key'
      ? '🗝️ Cheie cumpărată! O folosești din profil când cufărul e blocat.'
      : `${item.icon} ${item.name} e al tău!`, 'success');
  });
}

async function load() {
  const [nav, res] = await Promise.all([renderNav('/shop'), api('/shop')]);
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

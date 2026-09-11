// =====================================================================
// Componente de UI pentru sursele video, folosite de panoul de admin.
//
// Extrase intr-un modul separat pentru ca apar in doua locuri (pagina de
// detaliu a seriei si, istoric, tabul de episoade). Fara modul, aceeasi
// logica de randare ar fi fost copiata — si ar fi derivat.
// =====================================================================

export const KIND_HINTS = {
  embed: 'Se deschide într-un iframe sandbox.',
  file: 'Redat cu playerul nativ al browserului (trebuie .mp4/.webm/.m3u8).',
  link: 'Nu e înglobat — utilizatorul primește un buton care deschide pagina.',
};

const DEFAULT_KINDS = [
  { value: 'embed', label: 'Embed (iframe)' },
  { value: 'file', label: 'Fișier video' },
  { value: 'link', label: 'Link extern' },
];

/** Umple un <select> cu tipurile de sursa. */
export function fillKindSelect(select, meta, selected) {
  select.innerHTML = '';
  for (const k of meta?.kinds?.length ? meta.kinds : DEFAULT_KINDS) {
    const opt = document.createElement('option');
    opt.value = k.value;
    opt.textContent = k.label;
    if (k.kind) opt.dataset.defaultKind = k.kind;
    select.appendChild(opt);
  }
  if (selected) select.value = selected;
}

/**
 * Ghiceste tipul din URL, la fel ca serverul: o extensie video inseamna
 * fisier, orice altceva inseamna embed. E doar o sugestie pentru admin —
 * serverul valideaza oricum si corecteaza la nevoie.
 */
const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|m3u8)(\?.*)?$/i;

export function guessKind(url) {
  try {
    const u = new URL(String(url || ''));
    return VIDEO_EXT.test(u.pathname + u.search) ? 'file' : 'embed';
  } catch {
    return 'embed';
  }
}

/** Eticheta sugerata din domeniu, ca sa nu fie nevoie sa o tastezi. */
export function labelFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Un rand de sursa editabila (pentru formularul de creare a episodului).
 * Contine: eticheta, tip, URL, selector de furnizor cunoscut si buton ✕.
 */
export function buildSourceRow(meta, src = {}, { onRemove } = {}) {
  const row = document.createElement('div');
  row.className = 'src-row';

  const label = document.createElement('input');
  label.className = 'input src-row__label';
  label.type = 'text';
  label.maxLength = 40;
  label.placeholder = 'Etichetă (auto din URL)';
  label.value = src.label || '';
  label.name = 'src_label';

  const kind = document.createElement('select');
  kind.className = 'select src-row__kind';
  kind.name = 'src_kind';
  fillKindSelect(kind, meta, src.kind || 'embed');

  const url = document.createElement('input');
  url.className = 'input src-row__url';
  url.type = 'url';
  url.name = 'src_url';
  url.placeholder = src.hint || 'https://doodstream.com/e/abc123';
  url.value = src.url || '';

  // Cand adminul lipeste un URL, deducem tipul si eticheta. Asta rezolva
  // cazul real care a generat plangerea: un link DoodStream pe un domeniu
  // rotit (f7hyg4q.org) ajunsese salvat ca „link extern" si nu rula in
  // player, pentru ca tipul fusese ales manual gresit.
  url.addEventListener('blur', () => {
    if (!url.value.trim()) return;
    if (!label.value.trim()) label.value = labelFromUrl(url.value);
    if (!kind.dataset.touched) kind.value = guessKind(url.value);
  });
  kind.addEventListener('change', () => { kind.dataset.touched = '1'; });

  const quick = document.createElement('select');
  quick.className = 'select src-row__quick';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Furnizor…';
  quick.appendChild(ph);
  for (const prov of meta?.providers || []) {
    const o = document.createElement('option');
    o.value = prov.label;
    o.dataset.hint = prov.hint || '';
    o.dataset.kind = prov.kind || 'embed';
    o.textContent = prov.label;
    quick.appendChild(o);
  }
  quick.addEventListener('change', () => {
    const opt = quick.selectedOptions[0];
    if (!opt || !opt.value) return;
    if (!label.value.trim()) label.value = opt.value;
    if (opt.dataset.hint) url.placeholder = opt.dataset.hint;
    // Tipul vine declarat de furnizor, nu ghicit din eticheta.
    kind.value = opt.dataset.kind || 'embed';
    kind.dataset.touched = '1';
    quick.value = '';
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--danger btn--sm src-row__del';
  del.title = 'Scoate sursa asta';
  del.textContent = '✕';
  del.addEventListener('click', () => { row.remove(); onRemove?.(); });

  row.append(label, kind, url, quick, del);
  return row;
}

/** Aduna sursele dintr-un container de randuri, ignorandu-le pe cele goale. */
export function collectSourceRows(container) {
  const out = [];
  for (const row of container.querySelectorAll('.src-row')) {
    const url = row.querySelector('[name="src_url"]').value.trim();
    if (!url) continue;
    out.push({
      label: row.querySelector('[name="src_label"]').value.trim(),
      kind: row.querySelector('[name="src_kind"]').value,
      url,
    });
  }
  return out;
}

/**
 * Un rand de sursa existenta, cu editare inline, comutare activ/oprit si
 * stergere. Salveaza prin PATCH partial — doar campurile schimbate.
 */
export function existingSourceRow(meta, src, { api, toast, withBusy, onChanged }) {
  const row = document.createElement('div');
  row.className = `src-row src-row--existing${src.is_active ? '' : ' src-row--off'}`;

  const label = document.createElement('input');
  label.className = 'input src-row__label';
  label.type = 'text';
  label.maxLength = 40;
  label.value = src.label;

  const kind = document.createElement('select');
  kind.className = 'select src-row__kind';
  fillKindSelect(kind, meta, src.kind);

  const url = document.createElement('input');
  url.className = 'input src-row__url';
  url.type = 'url';
  url.value = src.url;

  const active = document.createElement('label');
  active.className = 'src-row__active';
  active.title = 'Sursele oprite nu apar pe pagina episodului';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!src.is_active;
  active.append(cb, document.createTextNode('activă'));

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn--accent btn--sm';
  save.textContent = 'Salvează';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--danger btn--sm';
  del.textContent = '✕';
  del.title = 'Șterge sursa';

  save.addEventListener('click', async () => {
    await withBusy(save, async () => {
      const res = await api('/admin/episode-sources', {
        method: 'PATCH',
        body: { id: src.id, label: label.value.trim(), kind: kind.value, url: url.value.trim(), is_active: cb.checked },
      });
      if (!res.ok) { toast(res.data?.error || 'Nu am putut salva sursa', 'err', 5000); return; }
      toast('Sursă salvată', 'ok');
      await onChanged?.();
    });
  });

  // Bifa e o modificare frecventa si ieftina: se salveaza pe loc.
  cb.addEventListener('change', async () => {
    const res = await api('/admin/episode-sources', {
      method: 'PATCH', body: { id: src.id, is_active: cb.checked },
    });
    if (!res.ok) { cb.checked = !cb.checked; toast(res.data?.error || 'Eroare', 'err'); return; }
    row.classList.toggle('src-row--off', !cb.checked);
    toast(cb.checked ? 'Sursă activată' : 'Sursă dezactivată', 'ok');
    await onChanged?.();
  });

  del.addEventListener('click', async () => {
    if (!confirm(`Ștergi sursa „${src.label}"?`)) return;
    const res = await api(`/admin/episode-sources?id=${src.id}`, { method: 'DELETE' });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge', 'err'); return; }
    toast('Sursă ștearsă', 'ok');
    await onChanged?.();
  });

  row.append(label, kind, url, active, save, del);
  return row;
}

/** Etichetele scurte cu sursele unui episod, pentru celula din tabel. */
export function sourceChips(sources, { warnEmpty = true } = {}) {
  const td = document.createElement('td');
  if (!sources?.length) {
    if (!warnEmpty) { td.textContent = '—'; return td; }
    const warn = document.createElement('span');
    warn.className = 'pill pill--warn';
    warn.textContent = 'fără sursă';
    warn.title = 'Episodul nu are nicio sursă video — playerul va fi gol.';
    td.appendChild(warn);
    return td;
  }
  const wrap = document.createElement('div');
  wrap.className = 'src-chips';
  for (const src of sources) {
    const chip = document.createElement('span');
    chip.className = `src-chip${src.is_active ? '' : ' src-chip--off'}`;
    chip.textContent = src.label;
    chip.title = `${src.kind} — ${src.url}${src.is_active ? '' : ' (dezactivată)'}`;
    wrap.appendChild(chip);
  }
  td.appendChild(wrap);
  return td;
}

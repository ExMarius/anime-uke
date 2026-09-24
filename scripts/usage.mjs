#!/usr/bin/env node
// =====================================================================
// usage.mjs — „cât din cota gratuită am consumat azi?"
//
// De ce există: site-ul rulează pe planul gratuit Cloudflare, unde cotele se
// resetează la 00:00 UTC, iar la depășire partea dinamică se oprește până
// a doua zi. Dashboardul arată consumul, dar nimeni nu stă cu el deschis —
// scriptul ăsta scoate un singur tabel, ca să vezi dintr-o privire dacă
// ești la 5% sau la 90% din cote.
//
// Rulează prin relay (vezi AGENTS.md §3), fiindcă sandbox-ul nu are acces la
// api.cloudflare.com:
//     node scripts/usage.mjs
// Are nevoie de CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (aceleași
// variabile ca deploy.sh) și de permisiunea „Account Analytics: Read” pe
// token. Dacă lipsește permisiunea, scriptul spune clar ce trebuie adăugat.
//
// Nu scrie nimic: doar interogări read-only către GraphQL Analytics.
// =====================================================================

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const API = 'https://api.cloudflare.com/client/v4/graphql';

// Cotele planului gratuit care contează pentru arhitectura asta.
const QUOTAS = {
  pages: 100_000,          // invocări Pages Functions (plan Workers free)
  d1RowsRead: 5_000_000,   // D1 rânduri citite
  d1RowsWritten: 100_000,  // D1 rânduri scrise
  doRequests: 100_000,     // Durable Objects requests
  doDurationGbS: 13_000,   // DO durata (GB-s)
};

if (!TOKEN || !ACCOUNT) {
  console.log('✗ Lipsesc CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (aceleași ca la deploy).');
  process.exit(0); // nu strică relay-ul: raportul de consum e informativ
}

/** O interogare GraphQL; întoarce { data } sau { error } (nu aruncă). */
async function gql(query, variables) {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => null);
    if (!json) return { error: `răspuns ne-JSON (HTTP ${res.status})` };
    if (json.errors?.length) return { error: json.errors.map((e) => e.message).join(' | ') };
    return { data: json.data };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

const num = (n) => Number(n || 0).toLocaleString('ro-RO');
const pct = (used, quota) => Math.round((used / quota) * 100);

/** Bara + verdictul, ca să se vadă din prima cât mai e loc. */
function line(label, used, quota) {
  const p = pct(used, quota);
  const icon = p >= 90 ? '🔴' : p >= 60 ? '🟡' : '🟢';
  const bar = '█'.repeat(Math.min(20, Math.round(p / 5))).padEnd(20, '·');
  console.log(`  ${icon} ${label.padEnd(34)} ${num(used).padStart(12)} / ${num(quota).padStart(12)}  ${String(p).padStart(3)}%  ${bar}`);
}

const startOfUtcDay = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};
const utcDate = () => startOfUtcDay().slice(0, 10);

async function main() {
  const since = startOfUtcDay();
  const today = utcDate();
  console.log(`CONSUM COTE GRATUITE — ziua UTC ${today} (se resetează la 00:00 UTC)\n`);
  let anyError = null;

  // --- 1. invocări Pages Functions (cota de 100k/zi) -------------------
  {
    const q = `query($acc: String!, $since: Time!) {
      viewer { accounts(filter: { accountTag: $acc }) {
        pagesFunctionsInvocationsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since }) { sum { requests } }
      } }
    }`;
    let r = await gql(q, { acc: ACCOUNT, since });
    let rows = r.data?.viewer?.accounts?.[0]?.pagesFunctionsInvocationsAdaptiveGroups;
    if (!rows) {
      // Unele conturi expun doar datasetul general de Workers.
      const q2 = `query($acc: String!, $since: Time!) {
        viewer { accounts(filter: { accountTag: $acc }) {
          workersInvocationsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since }) { sum { requests } }
        } }
      }`;
      r = await gql(q2, { acc: ACCOUNT, since });
      rows = r.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptiveGroups;
      if (rows) console.log('  (dataset: workersInvocationsAdaptive — Pages Functions nu a răspuns)');
    }
    if (rows) line('Invocări Functions (Pages)', rows[0]?.sum?.requests || 0, QUOTAS.pages);
    else { console.log('  ? invocări Functions: nu am putut citi (vezi mai jos)'); anyError = anyError || r.error; }
  }

  // --- 2. D1: rânduri citite / scrise ----------------------------------
  {
    const mk = (measures) => `query($acc: String!, $day: Date) {
      viewer { accounts(filter: { accountTag: $acc }) {
        d1AnalyticsAdaptiveGroups(limit: 1, filter: { date_geq: $day }) { sum { ${measures} } }
      } }
    }`;
    let r = await gql(mk('readQueries writeQueries rowsRead rowsWritten'), { acc: ACCOUNT, day: today });
    let sum = r.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups?.[0]?.sum;
    if (!sum) {
      r = await gql(mk('readQueries writeQueries'), { acc: ACCOUNT, day: today });
      sum = r.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups?.[0]?.sum;
    }
    if (sum) {
      // Dacă datasetul nu are rowsRead/rowsWritten, cădem pe numărul de
      // interogări (raportat separat) — nu mințim cu cifre inventate.
      if (sum.rowsRead !== undefined) line('D1 rânduri citite', sum.rowsRead || 0, QUOTAS.d1RowsRead);
      else console.log(`  ℹ️  D1 citiri: ${num(sum.readQueries)} interogări (cota se măsoară în rânduri citite)`);
      if (sum.rowsWritten !== undefined) line('D1 rânduri scrise', sum.rowsWritten || 0, QUOTAS.d1RowsWritten);
      else console.log(`  ℹ️  D1 scrieri: ${num(sum.writeQueries)} interogări (cota se măsoară în rânduri scrise)`);
    } else { console.log('  ? D1: nu am putut citi'); anyError = anyError || r.error; }
  }

  // --- 3. Durable Objects: requests + durată ---------------------------
  {
    const q = `query($acc: String!, $since: Time!) {
      viewer { accounts(filter: { accountTag: $acc }) {
        r: durableObjectsInvocationsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since }) { sum { requests } }
        d: durableObjectsPeriodicGroups(limit: 1, filter: { datetime_geq: $since }) { sum { duration } }
      } }
    }`;
    const r = await gql(q, { acc: ACCOUNT, since });
    const acc0 = r.data?.viewer?.accounts?.[0];
    if (acc0?.r) line('Durable Objects requests', acc0.r[0]?.sum?.requests || 0, QUOTAS.doRequests);
    else { console.log('  ? Durable Objects requests: nu am putut citi'); anyError = anyError || r.error; }
    const gbS = acc0?.d?.[0]?.sum?.duration;
    if (gbS !== undefined && gbS !== null) line('DO durată (GB-s)', Math.round(gbS), QUOTAS.doDurationGbS);
  }

  if (anyError) {
    console.log(`\n  Motivul cel mai probabil: tokenul nu are permisiunea „Account Analytics: Read”.`);
    console.log(`  Eroare API: ${String(anyError).slice(0, 200)}`);
  }
  console.log(`\n  Reper sănătos: sub 50% în orice moment al zilei. Peste 60% și încă crește → vezi`);
  console.log(`  „Cât duce planul gratuit" din README (pârghii: poll de notificări, heartbeat de vizionare,`);
  console.log(`  Fail open în dashboard, Bot Fight Mode).`);
}

main();

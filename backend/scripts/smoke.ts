/**
 * Vérification des VRAIES sources de données (à lancer sur ton serveur ou ton Mac) :
 *   npm run smoke
 * Chaque fournisseur est appelé une fois ; rien n'est écrit dans ta base principale.
 */
import { loadConfig } from '../src/config.ts';
import { Db, setDb } from '../src/db/db.ts';
import * as cg from '../src/providers/coingecko.ts';
import * as dex from '../src/providers/dexscreener.ts';
import * as gt from '../src/providers/geckoterminal.ts';
import { goplus, rugcheck } from '../src/providers/security.ts';
import { coinmarketcalEvents } from '../src/providers/catalysts.ts';

loadConfig();
setDb(new Db(':memory:'));

const checks: [string, () => Promise<string>][] = [
  ['CoinGecko /coins/markets', async () => { const r = await cg.markets(1); return `${r.length} coins, ex. ${r[0]?.key.symbol} ${r[0]?.priceUsd} $`; }],
  ['CoinGecko /coins/categories', async () => `${(await cg.categories()).length} catégories`],
  ['DexScreener profils récents', async () => { const r = await dex.latestProfiles(); return `${r.length} profils, ex. ${r[0]?.chain}:${r[0]?.address}`; }],
  ['DexScreener paires (USDC Solana)', async () => { const r = await dex.tokensOnChain('solana', ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']); return `liquidité ${Math.round(r[0]?.liquidityUsd ?? 0)} $`; }],
  ['GeckoTerminal nouveaux pools Solana', async () => `${(await gt.newPools('solana')).length} pools`],
  ['GoPlus (USDC Ethereum)', async () => { const r = await goplus('ethereum', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'); return r ? `${r.flags.length} drapeaux, détenteurs ${r.holderCount}` : 'pas de résultat'; }],
  ['RugCheck (BONK)', async () => { const r = await rugcheck('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'); return r ? `${r.flags.length} risques signalés` : 'pas de résultat'; }],
  ['CoinMarketCal', async () => { const r = await coinmarketcalEvents(30); return r === null ? 'désactivé (pas de clé)' : `${r.length} événements`; }],
];

let failed = 0;
for (const [name, fn] of checks) {
  try { console.log(`✅ ${name} — ${await fn()}`); } catch (e) { failed++; console.log(`❌ ${name} — ${(e as Error).message}`); }
}
process.exit(failed ? 1 : 0);

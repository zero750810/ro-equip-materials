// 爬 chuxin.romel.wiki 資料（繁中 language=tw）。
// 注意：equip/list 的 isCompose / isUpgrade 旗標「不可靠」（會漏報），
//   因此對「所有裝備」直接打 item/compose 與 equip/upgrade，以實際回傳為準。
//   帽子的 isCompose 旗標經抽樣驗證可靠，沿用旗標只抓標記者。
// 產出 raw.json 快取（可續跑）；語言變更會自動重置。
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';

const APPID = 'chuxin';
const SECRET = '5fa7483a086ee0ad';
const VERSION = '1.0.0';
const LANG = 'tw';
const BASE = 'https://romel.wiki/api-chuxin';
const RAW = fileURLToPath(new URL('./raw.json', import.meta.url));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 只在「網路/解析例外」時重試；API 回應（含 code!=0）一律回傳，由呼叫端判斷。
async function call(path, data, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const time = Math.round(Date.now() / 1000);
      const ds = data ? JSON.stringify(data) : '';
      const sign = crypto.createHash('md5')
        .update(`appid=${APPID}data=${ds}secret=${SECRET}time=${time}`).digest('hex');
      const q = new URLSearchParams({ appid: APPID, version: VERSION, language: LANG, sign, time: String(time) });
      if (data) q.set('data', ds);
      const r = await fetch(`${BASE}${path}?${q}`, { headers: { Referer: 'https://chuxin.romel.wiki/' } });
      return JSON.parse(await r.text());
    } catch (e) {
      if (i === tries - 1) return { code: -1, message: String(e), __neterr: true };
      await sleep(1500 * (i + 1));
    }
  }
}

async function fetchAllPages(path, label) {
  const first = await call(path, { page: 1 });
  const pc = first.data.pagination.pageCount;
  const list = [...first.data.list];
  console.log(`${label} 共 ${first.data.pagination.total} 件 / ${pc} 頁`);
  for (let p = 2; p <= pc; p++) {
    const d = await call(path, { page: p });
    list.push(...d.data.list);
    process.stdout.write(`\r抓${label} ${p}/${pc}`);
    await sleep(220);
  }
  process.stdout.write('\n');
  return list;
}

async function pool(items, n, fn, onTick) {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
    if (onTick) onTick(Math.min(i + n, items.length), items.length);
    await sleep(300);
  }
}

// 對 ids 抓 endpoint；有資料存 data，無資料(code!=0)存 {__none}，網路錯存 {__error} 以便下次重抓。
async function fetchDetails(cache, key, endpoint, ids, label) {
  const todo = ids.filter(id => !cache[key][id] || cache[key][id].__error);
  console.log(`待抓${label} ${todo.length} 件（共 ${ids.length}）`);
  let saveTick = 0;
  await pool(todo, 6, async id => {
    const j = await call(endpoint, { id });
    if (j.code === 0) cache[key][id] = j.data;
    else if (j.__neterr) cache[key][id] = { __error: j.message };
    else cache[key][id] = { __none: j.message || j.code };
  }, (d, t) => {
    process.stdout.write(`\r${label} ${d}/${t}`);
    if (++saveTick % 4 === 0) fs.writeFileSync(RAW, JSON.stringify(cache));
  });
  process.stdout.write('\n');
  fs.writeFileSync(RAW, JSON.stringify(cache));
}

async function main() {
  let cache = fs.existsSync(RAW) ? JSON.parse(fs.readFileSync(RAW, 'utf8')) : null;
  if (!cache || cache.lang !== LANG) {
    if (cache) console.log(`語言由 ${cache.lang} 改為 ${LANG}，重新抓取`);
    cache = { lang: LANG, list: null, compose: {}, upgrade: {}, hatList: null, hatCompose: {} };
  }

  // 1) 裝備清單
  if (!cache.list) { cache.list = await fetchAllPages('/equip/list', '裝備清單'); fs.writeFileSync(RAW, JSON.stringify(cache)); }
  const equipIds = cache.list.map(it => it.id);

  // 2) 裝備製作材料（所有裝備，不信旗標）
  await fetchDetails(cache, 'compose', '/item/compose', equipIds, '裝備製作');
  // 3) 裝備升級階段（所有裝備，不信旗標）
  await fetchDetails(cache, 'upgrade', '/equip/upgrade', equipIds, '裝備升級');

  // 4) 帽子清單
  if (!cache.hatList) { cache.hatList = await fetchAllPages('/item/hat', '帽子清單'); fs.writeFileSync(RAW, JSON.stringify(cache)); }
  // 5) 帽子製作材料（帽子 isCompose 旗標可靠，只抓標記者）
  await fetchDetails(cache, 'hatCompose', '/item/compose', cache.hatList.filter(it => it.isCompose == 1).map(it => it.id), '帽子製作');

  fs.writeFileSync(RAW, JSON.stringify(cache));
  const has = (o, fn) => Object.values(o).filter(fn).length;
  const realCompose = has(cache.compose, v => v && !v.__error && !v.__none && (v.cost || []).length > 0);
  const realUpgrade = has(cache.upgrade, v => v && !v.__error && !v.__none && (v.upgradeMaterial || []).length > 0);
  const realHat = has(cache.hatCompose, v => v && !v.__error && !v.__none && (v.cost || []).length > 0);
  console.log(`完成（${LANG}）。裝備實際可製作 ${realCompose}、可升級 ${realUpgrade}、帽子可製作 ${realHat}`);
  console.log(`網路錯誤待重抓：compose ${has(cache.compose, v => v.__error)}、upgrade ${has(cache.upgrade, v => v.__error)}、hat ${has(cache.hatCompose, v => v.__error)}`);
  console.log(`raw 已存：${RAW}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

// 爬 chuxin.romel.wiki 資料（繁中 language=tw）：
//   裝備清單 + 製作材料(item/compose) + 升級階段材料(equip/upgrade，逐階)
//   帽子清單(item/hat) + 帽子製作材料(item/compose)
// 產出 raw.json 快取（可續跑）；語言變更會自動重置。
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';

const APPID = 'chuxin';
const SECRET = '5fa7483a086ee0ad';       // atob(ServerConfig.api.secret)
const VERSION = '1.0.0';
const LANG = 'tw';                        // 繁體中文
const BASE = 'https://romel.wiki/api-chuxin';
const RAW = fileURLToPath(new URL('./raw.json', import.meta.url));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// sign = md5("appid=Xdata=<json>secret=Ytime=Z")；language 不參與簽名
async function call(path, data, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const time = Math.round(Date.now() / 1000);
      const ds = data ? JSON.stringify(data) : '';
      const sign = crypto.createHash('md5')
        .update(`appid=${APPID}data=${ds}secret=${SECRET}time=${time}`).digest('hex');
      const q = new URLSearchParams({ appid: APPID, version: VERSION, language: LANG, sign, time: String(time) });
      if (data) q.set('data', ds);
      const r = await fetch(`${BASE}${path}?${q}`, { headers: { Referer: 'https://chuxin.romel.wiki/' } });
      const j = JSON.parse(await r.text());
      if (j.code !== 0) throw new Error(`api code ${j.code} ${j.status || j.message || ''}`);
      return j.data;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function fetchAllPages(path, label) {
  const first = await call(path, { page: 1 });
  const pc = first.pagination.pageCount;
  const list = [...first.list];
  console.log(`${label} 共 ${first.pagination.total} 件 / ${pc} 頁`);
  for (let p = 2; p <= pc; p++) {
    const d = await call(path, { page: p });
    list.push(...d.list);
    process.stdout.write(`\r抓${label} ${p}/${pc}`);
    await sleep(250);
  }
  process.stdout.write('\n');
  return list;
}

// 限流並行
async function pool(items, n, fn, onTick) {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
    if (onTick) onTick(Math.min(i + n, items.length), items.length);
    await sleep(350);
  }
}

async function composeBatch(cache, key, ids, label) {
  const todo = ids.filter(id => !cache[key][id]);
  console.log(`待抓${label} ${todo.length} 件`);
  await pool(todo, 4, async id => {
    try { cache[key][id] = await call('/item/compose', { id }); }
    catch (e) { cache[key][id] = { __error: String(e) }; }
  }, (d, t) => { process.stdout.write(`\r${label} ${d}/${t}`); fs.writeFileSync(RAW, JSON.stringify(cache)); });
  process.stdout.write('\n');
}

async function main() {
  let cache = fs.existsSync(RAW) ? JSON.parse(fs.readFileSync(RAW, 'utf8')) : null;
  if (!cache || cache.lang !== LANG) {
    if (cache) console.log(`語言由 ${cache.lang} 改為 ${LANG}，重新抓取`);
    cache = { lang: LANG, list: null, compose: {}, upgrade: {}, hatList: null, hatCompose: {} };
  }

  // 1) 裝備清單
  if (!cache.list) { cache.list = await fetchAllPages('/equip/list', '裝備清單'); fs.writeFileSync(RAW, JSON.stringify(cache)); }
  // 2) 裝備製作材料
  await composeBatch(cache, 'compose', cache.list.filter(it => it.isCompose == 1).map(it => it.id), '裝備製作');
  // 3) 升級階段材料（逐階；equip/upgrade）
  const upIds = cache.list.filter(it => it.isUpgrade == 1 && !cache.upgrade[it.id]).map(it => it.id);
  console.log(`待抓升級階段 ${upIds.length} 件`);
  await pool(upIds, 4, async id => {
    try { cache.upgrade[id] = await call('/equip/upgrade', { id }); }
    catch (e) { cache.upgrade[id] = { __error: String(e) }; }
  }, (d, t) => { process.stdout.write(`\r升級 ${d}/${t}`); fs.writeFileSync(RAW, JSON.stringify(cache)); });
  process.stdout.write('\n');

  // 4) 帽子清單
  if (!cache.hatList) { cache.hatList = await fetchAllPages('/item/hat', '帽子清單'); fs.writeFileSync(RAW, JSON.stringify(cache)); }
  // 5) 帽子製作材料
  await composeBatch(cache, 'hatCompose', cache.hatList.filter(it => it.isCompose == 1).map(it => it.id), '帽子製作');

  fs.writeFileSync(RAW, JSON.stringify(cache));
  const errs = o => Object.values(o).filter(v => v && v.__error).length;
  console.log(`完成（${LANG}）。裝備製作 ${Object.keys(cache.compose).length}(失敗 ${errs(cache.compose)})、` +
    `升級 ${Object.keys(cache.upgrade).length}(失敗 ${errs(cache.upgrade)})、` +
    `帽子製作 ${Object.keys(cache.hatCompose).length}(失敗 ${errs(cache.hatCompose)})`);
  console.log(`raw 已存：${RAW}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

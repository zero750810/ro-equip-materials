// 讀 raw.json（繁中），產出單一自帶資料的 HTML。
// A) 材料找裝備（反查，依顏色分組；卡片顯示該裝備完整材料與加總成本）
// B) 裝備估價（依顏色單價推算製作/升級總成本；升級逐階列出；可依價格排序與篩選）
// 含帽子（只有製作材料）；排除「神器」部位。
import fs from 'fs';
import { fileURLToPath } from 'url';

const RAW = fileURLToPath(new URL('./raw.json', import.meta.url));
const OUT = fileURLToPath(new URL('./裝備材料反查.html', import.meta.url));

// 官方站台材料稀有度色碼（--item-rank-color-N）
const RANKS = [
  { r: 1, name: '普通', color: '#aaaaaa' },
  { r: 2, name: '進階', color: '#63cd4e' },
  { r: 3, name: '稀有', color: '#68b6ff' },
  { r: 4, name: '史詩', color: '#c85fd6' },
];
const DEFAULT_PRICES = { 1: 120, 2: 480, 3: 26000, 4: 200000 };
const POS = { 1: '武器', 2: '副手', 3: '盔甲', 4: '披風', 5: '鞋子', 6: '飾品', 7: '帽子', 14: '神器' };
const EXCLUDE_POS = new Set(['14']);   // 移除：神器
const ZENY_ID = 100;

const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const equipById = {};
for (const it of raw.list) equipById[it.id] = it;
const allowed = id => equipById[id] && !EXCLUDE_POS.has(String(equipById[id].position));

const equips = [];

// ---- 裝備（製作 + 升級階段）----
const ids = new Set([...Object.keys(raw.compose), ...Object.keys(raw.upgrade)]);
for (const eid of ids) {
  if (!allowed(eid)) continue;
  const cd = raw.compose[eid], ud = raw.upgrade[eid];
  const eq = equipById[eid] || {};
  const o = { id: +eid, name: cd?.name || ud?.name || eq.name || eid, pos: POS[eq.position] || '其他' };
  if (cd && !cd.__error && !cd.__none && (cd.cost || []).length) {
    o.compose = { zeny: cd.zeny || 0, mats: cd.cost.map(c => ({ id: +c.id, name: c.name, rank: +c.rank || 1, num: c.num })) };
  }
  if (ud && !ud.__error && !ud.__none && (ud.upgradeMaterial || []).length) {
    o.upgrade = {
      stages: ud.upgradeMaterial.map(lvl => lvl.map(m => ({ id: +m.id, name: m.name, rank: +m.rank || 1, num: m.num }))),
    };
  }
  if (o.compose || o.upgrade) equips.push(o);
}

// ---- 帽子（只有製作材料）----
for (const it of (raw.hatList || [])) {
  const cd = raw.hatCompose[it.id];
  if (!cd || cd.__error || cd.__none || !(cd.cost || []).length) continue;
  equips.push({
    id: +it.id, name: cd.name || it.name, pos: '帽子',
    compose: { zeny: cd.zeny || 0, mats: cd.cost.map(c => ({ id: +c.id, name: c.name, rank: +c.rank || 1, num: c.num })) },
  });
}
equips.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
// 分類：頭飾 / ★裝 / 一般裝備
for (const e of equips) e.cat = e.pos === '帽子' ? 'hat' : (e.name.includes('★') ? 'star' : 'gear');

// 升級逐階 → 加總成不重複材料（供反查與成本）
function aggUpgrade(e) {
  const sum = {};
  for (const lvl of e.upgrade.stages) for (const m of lvl) {
    (sum[m.id] ||= { id: m.id, name: m.name, rank: m.rank, num: 0 }).num += m.num;
  }
  return Object.values(sum);
}

// ---- 材料反查表（材料 → 裝備）----
const mats = {};
const matRef = m => (mats[m.id] ||= { id: +m.id, name: m.name, rank: +m.rank || 1, compose: [], upgrade: [] });
for (const e of equips) {
  if (e.compose) for (const m of e.compose.mats) matRef(m).compose.push(e.id);
  if (e.upgrade) for (const m of aggUpgrade(e)) matRef(m).upgrade.push(e.id);
}
const materials = Object.values(mats)
  .map(m => ({ ...m, total: m.compose.length + m.upgrade.length }))
  .sort((a, b) => a.rank - b.rank || b.total - a.total);

const hatCount = equips.filter(e => e.pos === '帽子').length;
const data = {
  ranks: RANKS, zenyId: ZENY_ID, defaultPrices: DEFAULT_PRICES,
  materials, equips,
  stats: {
    materials: materials.length,
    composeEquip: equips.filter(e => e.compose).length,
    upgradeEquip: equips.filter(e => e.upgrade).length,
    hats: hatCount,
    totalEquip: equips.length,
  },
};

const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>裝備材料反查 · 估價 — 仙境初心</title>
<style>
  :root{--bg:#0f1320;--panel:#1a2030;--panel2:#222a3d;--line:#2e3850;--txt:#e8ecf5;--muted:#8d97ad;--accent:#4a89dc;--gold:#f0b429;--compose:#3dba7e;--upgrade:#c77dff}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"PingFang TC","Microsoft JhengHei",system-ui,sans-serif;background:var(--bg);color:var(--txt)}
  header{position:sticky;top:0;z-index:20;background:linear-gradient(180deg,#141a2b,#0f1320);border-bottom:1px solid var(--line);padding:12px 18px}
  h1{margin:0;font-size:17px}h1 span{color:var(--gold)}
  .sub{color:var(--muted);font-size:12px;margin-top:3px}
  .tabs{display:flex;gap:8px;margin-top:10px}
  .tab{padding:7px 16px;border-radius:9px 9px 0 0;border:1px solid var(--line);border-bottom:none;background:var(--panel);color:var(--muted);cursor:pointer;font-size:14px}
  .tab.on{background:var(--panel2);color:var(--txt);font-weight:600}
  .prices{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 18px;background:#11161f;border-bottom:1px solid var(--line)}
  .prices .lbl{font-size:12px;color:var(--muted)}
  .pc{display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:5px 9px}
  .pc .sw{width:12px;height:12px;border-radius:50%}
  .pc span{font-size:13px;white-space:nowrap}
  .pc input{width:88px;background:#0c0f18;border:1px solid var(--line);color:var(--txt);border-radius:6px;padding:5px 7px;font-size:13px;text-align:right;outline:none}
  .pc input:focus{border-color:var(--accent)}
  .wrap{display:grid;grid-template-columns:minmax(290px,420px) 1fr;min-height:calc(100vh - 160px)}
  .left{border-right:1px solid var(--line);min-width:0}
  .searchbar{position:sticky;top:0;background:var(--bg);padding:12px;border-bottom:1px solid var(--line);z-index:5}
  input[type=search]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--txt);font-size:15px;outline:none}
  input[type=search]:focus{border-color:var(--accent)}
  .chips{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center}
  .chip{font-size:12px;padding:4px 11px;border-radius:20px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  select{font-size:12px;background:var(--panel);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:4px 8px;outline:none}
  .list{max-height:calc(100vh - 330px);overflow:auto;padding:6px}
  .ghead{font-size:12px;color:var(--muted);padding:10px 10px 4px;display:flex;align-items:center;gap:7px;position:sticky;top:0;background:var(--bg)}
  .ghead .sw{width:10px;height:10px;border-radius:50%}
  .row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent}
  .row:hover{background:var(--panel)}
  .row.sel{background:var(--panel2);border-color:var(--accent)}
  .row .nm{flex:1;min-width:0}
  .row .nm b{font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row .nm small{color:var(--muted);font-size:11px}
  .dotc{width:9px;height:9px;border-radius:50%;flex:0 0 9px;display:inline-block}
  .badge{font-size:11px;border-radius:5px;padding:1px 6px;border:1px solid var(--line)}
  .badge.c{color:var(--compose);border-color:#27543f}
  .badge.u{color:var(--upgrade);border-color:#4a3560}
  .cnt{font-size:12px;color:var(--muted);background:#0c0f18;border-radius:20px;padding:2px 9px;white-space:nowrap}
  .rowcost{font-size:12px;color:var(--gold);font-weight:600;white-space:nowrap}
  .right{padding:18px;min-width:0}
  .empty{color:var(--muted);text-align:center;margin-top:70px;font-size:15px;line-height:1.7}
  .dhead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:6px}
  .dhead h2{margin:0;font-size:21px}
  .dhead .meta{color:var(--muted);font-size:13px}
  .grp{margin-top:18px}
  .grp h3{font-size:14px;margin:0 0 4px;display:flex;align-items:center;gap:8px}
  .grp .gt{margin-left:auto;font-size:14px;color:var(--gold);font-weight:600}
  .dot{width:9px;height:9px;border-radius:50%}.dot.c{background:var(--compose)}.dot.u{background:var(--upgrade)}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  td{padding:7px 6px;border-bottom:1px solid #232c40}
  td.n{text-align:right;white-space:nowrap;color:var(--muted)}
  td.cost{text-align:right;white-space:nowrap;color:var(--gold)}
  .matname{display:flex;align-items:center;gap:8px}
  .stage{margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .stage .sh{display:flex;align-items:center;gap:8px;background:#161d2c;padding:7px 11px;font-size:13px}
  .stage .sh .st{color:var(--upgrade);font-weight:600}
  .stage .sh .sc{margin-left:auto;color:var(--gold);font-weight:600}
  .stage table{margin:0}.stage td{padding:6px 11px}
  .note{color:var(--muted);font-size:12px;margin-top:4px}
  .eqcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px;margin-top:8px}
  .eqcard{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:11px 13px}
  .eqcard .top{display:flex;align-items:baseline;gap:8px;margin-bottom:7px}
  .eqcard .top b{font-size:14px;flex:1;min-width:0}
  .eqcard .top .tot{font-size:14px;color:var(--gold);font-weight:700;white-space:nowrap}
  .eqcard .mats{display:flex;flex-wrap:wrap;gap:4px 12px}
  .eqcard .mi{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px}
  .eqcard .mi.hl{color:var(--txt);font-weight:600}
  .eqcard .mi b{color:var(--txt);font-weight:500}
  .eqcard .warn{color:#e0a84e;font-size:11px;margin-top:5px}
  .back{display:none;margin-bottom:12px;background:var(--panel);border:1px solid var(--line);color:var(--txt);padding:8px 14px;border-radius:8px;cursor:pointer}
  @media(max-width:820px){.wrap{grid-template-columns:1fr}.left{border-right:none}.right{display:none}.right.show{display:block}.list{max-height:none}.back{display:inline-block}}
</style>
</head>
<body>
<header>
  <h1>裝備材料反查 · 估價 · <span>仙境初心</span></h1>
  <div class="sub" id="stats"></div>
  <div class="tabs">
    <div class="tab on" data-tab="mat">材料找裝備</div>
    <div class="tab" data-tab="gear">裝備估價</div>
    <div class="tab" data-tab="star">★裝估價</div>
    <div class="tab" data-tab="hat">頭飾估價</div>
  </div>
</header>
<div class="prices" id="prices"><span class="lbl">每種顏色材料單價 (z)：</span></div>
<div class="wrap">
  <div class="left">
    <div class="searchbar">
      <input type="search" id="q">
      <div class="chips" id="chips"></div>
      <div class="chips" id="chips2"></div>
    </div>
    <div class="list" id="list"></div>
  </div>
  <div class="right" id="right"></div>
</div>
<script id="data" type="application/json">${JSON.stringify(data)}</script>
<script>
const DB = JSON.parse(document.getElementById('data').textContent);
const RANKS = DB.ranks, RMAP={}; RANKS.forEach(r=>RMAP[r.r]=r);
const EQMAP={}; DB.equips.forEach(e=>EQMAP[e.id]=e);
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('en-US');
const fmtNum=n=>n>=10000?(n/10000).toFixed(n%10000?1:0)+'萬':n.toLocaleString('en-US');
const _gN=DB.equips.filter(e=>e.cat==='gear').length,_sN=DB.equips.filter(e=>e.cat==='star').length,_hN=DB.equips.filter(e=>e.cat==='hat').length;
$('stats').textContent='裝備 '+_gN+' · ★裝 '+_sN+' · 頭飾 '+_hN+' · 材料 '+DB.stats.materials+' 種（繁中，已排除神器）';

// ---- 顏色單價（預設值 + localStorage 記憶）----
const PKEY='ro_color_prices_v2';
let prices;
try{ prices=JSON.parse(localStorage.getItem(PKEY)); }catch(e){}
if(!prices) prices={...DB.defaultPrices};
function buildPriceInputs(){
  const box=$('prices');
  RANKS.forEach(r=>{
    const w=document.createElement('label'); w.className='pc';
    w.innerHTML='<span class="sw" style="background:'+r.color+'"></span><span>'+r.name+'</span>'+
      '<input type="number" min="0" step="1" data-r="'+r.r+'" placeholder="0" value="'+(prices[r.r]??'')+'">';
    box.appendChild(w);
  });
  const z=document.createElement('span'); z.className='lbl'; z.style.marginLeft='6px';
  z.textContent='（Zeny 直接以面額計）'; box.appendChild(z);
  box.addEventListener('input',e=>{
    if(e.target.tagName!=='INPUT')return;
    const r=e.target.dataset.r,v=e.target.value;
    if(v==='')delete prices[r]; else prices[r]=+v;
    localStorage.setItem(PKEY,JSON.stringify(prices));
    renderList(); rerenderRight();
  });
}
const priceOf=rank=>(prices[rank]!=null?+prices[rank]:null);

// 計算一組材料成本 {matCost, zeny, total, unpriced}
function calcMats(matArr, extraZeny){
  let matCost=0, zeny=extraZeny||0, unpriced=false;
  for(const m of matArr){
    if(m.id===DB.zenyId){ zeny+=m.num; continue; }
    const p=priceOf(m.rank);
    if(p==null)unpriced=true; else matCost+=m.num*p;
  }
  return {matCost,zeny,total:matCost+zeny,unpriced};
}
// 升級逐階 → 加總不重複材料
function aggStages(e){
  const sum={};
  for(const lvl of e.upgrade.stages) for(const m of lvl){ (sum[m.id]||={id:m.id,name:m.name,rank:m.rank,num:0}).num+=m.num; }
  return Object.values(sum);
}
// 取裝備某類別的「完整材料 + zeny」
function recipe(e, kind){
  if(kind==='compose'&&e.compose)return {mats:e.compose.mats, zeny:e.compose.zeny};
  if(kind==='upgrade'&&e.upgrade)return {mats:aggStages(e), zeny:0};
  return null;
}

// ---- 分頁狀態 ----
let TAB='mat', kw='', mFilter='all', eMethod='all', ePos='all', eSort='cost-desc', sel=null;

const TABNAME={gear:'裝備',star:'★裝',hat:'頭飾'};
function setTab(t){
  TAB=t; sel=null; kw=''; eMethod='all'; ePos='all';
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.dataset.tab===t));
  $('q').value='';
  $('q').placeholder=t==='mat'?'輸入材料名稱… 例：神之金屬、深淵花':('輸入'+TABNAME[t]+'名稱…');
  buildControls(); renderList();
  $('right').innerHTML='<div class="empty">'+(t==='mat'
    ?'← 從左側點一個材料，看看哪些裝備會用到它（卡片內含該裝備的完整材料與加總成本）'
    :'← 從左側點一件'+TABNAME[t]+'，依你填的顏色單價估算製作／升級總花費（升級逐階列出）')+'</div>';
  $('right').classList.remove('show');
}
function buildControls(){
  const c1=$('chips'), c2=$('chips2');
  const sortSel='<select id="sortsel">'+
    [['cost-desc','估價：高→低'],['cost-asc','估價：低→高'],['name','名稱']]
    .map(o=>'<option value="'+o[0]+'"'+(eSort===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>';
  if(TAB==='mat'){
    c1.innerHTML=['all:全部','compose:製作材料','upgrade:升級材料']
      .map(s=>{const[v,l]=s.split(':');return '<span class="chip'+(mFilter===v?' on':'')+'" data-f="'+v+'">'+l+'</span>';}).join('');
    c2.innerHTML='';
  }else if(TAB==='hat'){
    c1.innerHTML='';                       // 頭飾只有製作，不需製作/升級切換、不需部位
    c2.innerHTML=sortSel;
    $('sortsel').onchange=e=>{eSort=e.target.value;renderList();};
  }else{                                    // gear / star
    c1.innerHTML=['all:全部','compose:製作','upgrade:升級']
      .map(s=>{const[v,l]=s.split(':');return '<span class="chip'+(eMethod===v?' on':'')+'" data-m="'+v+'">'+l+'</span>';}).join('');
    const poss=[...new Set(DB.equips.filter(e=>e.cat===TAB).map(e=>e.pos))];
    c2.innerHTML='<select id="possel"><option value="all">全部部位</option>'+
      poss.map(p=>'<option value="'+p+'"'+(ePos===p?' selected':'')+'>'+p+'</option>').join('')+'</select>'+sortSel;
    $('possel').onchange=e=>{ePos=e.target.value;renderList();};
    $('sortsel').onchange=e=>{eSort=e.target.value;renderList();};
  }
}

// ---------- 材料分頁 ----------
function visMats(){
  return DB.materials.filter(m=>{
    if(mFilter==='compose'&&!m.compose.length)return false;
    if(mFilter==='upgrade'&&!m.upgrade.length)return false;
    if(kw&&!m.name.toLowerCase().includes(kw))return false;
    return true;
  });
}
function renderMatList(){
  const ms=visMats();
  if(!ms.length){$('list').innerHTML='<div class="empty" style="margin-top:30px">找不到符合的材料</div>';return;}
  let html='';
  for(const rk of RANKS){
    const g=ms.filter(m=>m.rank===rk.r); if(!g.length)continue;
    html+='<div class="ghead"><span class="sw" style="background:'+rk.color+'"></span>'+rk.name+'（'+g.length+'）</div>';
    html+=g.map(m=>{
      const c=mFilter==='compose'?m.compose.length:mFilter==='upgrade'?m.upgrade.length:m.total;
      return '<div class="row'+(m.id===sel?' sel':'')+'" data-id="'+m.id+'">'+
        '<span class="dotc" style="background:'+rk.color+'"></span>'+
        '<div class="nm"><b>'+esc(m.name)+'</b><small>'+m.compose.length+' 製作 · '+m.upgrade.length+' 升級</small></div>'+
        '<span class="cnt">'+c+'</span></div>';
    }).join('');
  }
  $('list').innerHTML=html;
}
function eqCardHtml(eid, kind, hlMatId){
  const e=EQMAP[eid]; if(!e)return '';
  const rc=recipe(e,kind); if(!rc)return '';
  const t=calcMats(rc.mats, rc.zeny);
  const mline=rc.mats.slice().sort((a,b)=>(b.rank-a.rank)||(b.num-a.num)).map(m=>{
    const isZ=m.id===DB.zenyId; const rk=RMAP[m.rank]||RANKS[0];
    return '<span class="mi'+(m.id===hlMatId?' hl':'')+'"><span class="dotc" style="background:'+(isZ?'var(--gold)':rk.color)+'"></span>'+
      esc(m.name)+' <b>×'+fmtNum(m.num)+'</b></span>';
  }).join('');
  const zline=rc.zeny?'<span class="mi"><span class="dotc" style="background:var(--gold)"></span>Zeny <b>×'+fmtNum(rc.zeny)+'</b></span>':'';
  return '<div class="eqcard"><div class="top"><b>'+esc(e.name)+'</b><span class="tot">'+fmt(t.total)+'z</span></div>'+
    '<div class="mats">'+mline+zline+'</div>'+
    (t.unpriced?'<div class="warn">⚠ 含未定價顏色，實際更高</div>':'')+'</div>';
}
function renderMatDetail(m){
  const rk=RMAP[m.rank];
  const sec=(title,cls,kind,arr)=>{
    if(!arr.length)return '';
    const sorted=arr.slice().sort((a,b)=>{
      const ra=recipe(EQMAP[a],kind), rb=recipe(EQMAP[b],kind);
      return calcMats(rb.mats,rb.zeny).total-calcMats(ra.mats,ra.zeny).total;
    });
    return '<div class="grp"><h3><span class="dot '+cls+'"></span>'+title+' · '+arr.length+' 件</h3>'+
      '<div class="eqcards">'+sorted.map(eid=>eqCardHtml(eid,kind,m.id)).join('')+'</div></div>';
  };
  $('right').innerHTML='<button class="back" id="back">← 返回</button>'+
    '<div class="dhead"><h2>'+esc(m.name)+'</h2>'+
    '<span class="meta"><span class="dotc" style="background:'+rk.color+'"></span> '+rk.name+' · 被 '+m.total+' 件使用</span></div>'+
    '<div class="note">卡片顯示「該裝備的完整材料與加總成本」，目前材料以白字標示（升級為各階加總）</div>'+
    sec('製作材料','c','compose',m.compose)+sec('升級材料','u','upgrade',m.upgrade);
  $('right').classList.add('show');
  const b=$('back'); if(b)b.onclick=()=>$('right').classList.remove('show');
}

// ---------- 裝備分頁 ----------
function eqTotalFor(e){
  if(eMethod==='compose')return e.compose?calcMats(e.compose.mats,e.compose.zeny).total:-1;
  if(eMethod==='upgrade')return e.upgrade?calcMats(aggStages(e),0).total:-1;
  let t=0; if(e.compose)t+=calcMats(e.compose.mats,e.compose.zeny).total; if(e.upgrade)t+=calcMats(aggStages(e),0).total; return t;
}
function visEquips(){
  let es=DB.equips.filter(e=>{
    if(e.cat!==TAB)return false;
    if(eMethod==='compose'&&!e.compose)return false;
    if(eMethod==='upgrade'&&!e.upgrade)return false;
    if(ePos!=='all'&&e.pos!==ePos)return false;
    if(kw&&!e.name.toLowerCase().includes(kw))return false;
    return true;
  });
  if(eSort==='name')es.sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  else{const dir=eSort==='cost-asc'?1:-1; es=es.map(e=>[e,eqTotalFor(e)]).sort((a,b)=>(a[1]-b[1])*dir).map(x=>x[0]);}
  return es;
}
function renderEqList(){
  const es=visEquips();
  if(!es.length){$('list').innerHTML='<div class="empty" style="margin-top:30px">找不到符合的裝備</div>';return;}
  $('list').innerHTML=es.map(e=>{
    const tot=eqTotalFor(e);
    return '<div class="row'+(e.id===sel?' sel':'')+'" data-id="'+e.id+'">'+
      '<div class="nm"><b>'+esc(e.name)+'</b><small>'+e.pos+'</small></div>'+
      (e.compose?'<span class="badge c">製作</span>':'')+(e.upgrade?'<span class="badge u">升級</span>':'')+
      '<span class="rowcost">'+(tot>=0?fmt(tot)+'z':'')+'</span></div>';
  }).join('');
}
function matTable(matArr,extraZeny){
  const t=calcMats(matArr,extraZeny);
  const rows=matArr.slice().sort((a,b)=>(b.rank-a.rank)||(b.num-a.num)).map(m=>{
    const isZ=m.id===DB.zenyId; const rk=RMAP[m.rank]||RANKS[0]; const p=isZ?1:priceOf(m.rank);
    const line=isZ?m.num:(p!=null?m.num*p:null);
    return '<tr><td><div class="matname"><span class="dotc" style="background:'+(isZ?'var(--gold)':rk.color)+'"></span>'+
      esc(m.name)+(isZ?'':' <small style="color:var(--muted)">'+rk.name+'</small>')+'</div></td>'+
      '<td class="n">×'+fmtNum(m.num)+'</td>'+
      '<td class="cost">'+(line!=null?fmt(line)+'z':'<span style="color:var(--muted)">未定價</span>')+'</td></tr>';
  }).join('');
  return {html:'<table>'+rows+'</table>',...t};
}
function renderEqDetail(e){
  let html='<button class="back" id="back">← 返回</button>'+
    '<div class="dhead"><h2>'+esc(e.name)+'</h2><span class="meta">'+e.pos+'</span></div>';
  if(e.compose){
    const t=matTable(e.compose.mats,e.compose.zeny);
    html+='<div class="grp"><h3><span class="dot c"></span>製作材料<span class="gt">'+fmt(t.total)+'z</span></h3>'+t.html+
      '<div class="note">材料 '+fmt(t.matCost)+'z'+(t.zeny?' ＋ Zeny '+fmt(t.zeny)+'z':'')+(t.unpriced?'　⚠ 含未定價顏色':'')+'</div></div>';
  }
  if(e.upgrade){
    const agg=calcMats(aggStages(e),0);
    let stagesHtml='';
    e.upgrade.stages.forEach((lvl,i)=>{
      const st=matTable(lvl,0);
      stagesHtml+='<div class="stage"><div class="sh"><span class="st">第 '+(i+1)+' 階</span><span class="sc">'+fmt(st.total)+'z</span></div>'+st.html+'</div>';
    });
    html+='<div class="grp"><h3><span class="dot u"></span>升級階段材料（逐階）<span class="gt">總 '+fmt(agg.total)+'z</span></h3>'+
      '<div class="note">下面逐階列出每一階需要的材料；最右為各階小計。共 '+e.upgrade.stages.length+' 階'+(agg.unpriced?'　⚠ 含未定價顏色':'')+'</div>'+
      stagesHtml+'</div>';
  }
  $('right').innerHTML=html; $('right').classList.add('show');
  const b=$('back'); if(b)b.onclick=()=>$('right').classList.remove('show');
}

// ---- 共用 ----
function renderList(){ TAB==='mat'?renderMatList():renderEqList(); }
function rerenderRight(){
  if(sel==null)return;
  if(TAB==='mat'){const m=DB.materials.find(x=>x.id===sel); if(m)renderMatDetail(m);}
  else{const e=EQMAP[sel]; if(e)renderEqDetail(e);}
}
$('list').addEventListener('click',ev=>{
  const el=ev.target.closest('.row'); if(!el)return; sel=+el.dataset.id;
  if(TAB==='mat'){const m=DB.materials.find(x=>x.id===sel);renderMatList();renderMatDetail(m);}
  else{const e=EQMAP[sel];renderEqList();renderEqDetail(e);}
});
$('q').addEventListener('input',e=>{kw=e.target.value.trim().toLowerCase();renderList();});
function chipClick(e){
  const c=e.target.closest('.chip'); if(!c)return;
  if(TAB==='mat'){mFilter=c.dataset.f;} else {eMethod=c.dataset.m;}
  buildControls(); renderList();
}
$('chips').addEventListener('click',chipClick);
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>setTab(t.dataset.tab)));

buildPriceInputs();
setTab('mat');
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html);
// 另存 index.html 供 GitHub Pages 當首頁（網址即根目錄）
fs.writeFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), html);
console.log('已產出', OUT, '與 index.html (' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB)');
console.log('材料', materials.length, '| 估價項目', equips.length, '(製作', data.stats.composeEquip, '/ 升級', data.stats.upgradeEquip, '/ 帽子', hatCount, ')');

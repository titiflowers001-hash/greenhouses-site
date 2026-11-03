// ============================================================
//  Админка Green MAMA. Остатки меняются ТОЛЬКО операциями:
//  приход, пересадка, списание, продажа. Любую операцию можно
//  отредактировать или удалить — склад пересчитается.
// ============================================================
let PRODUCTS = [], ORDERS = [], CUSTOMERS = [], EXPENSES = [], MOVES = [], MATERIALS = [];
let curTab = 'stock', grpFilter = 'all', cassFilter = 'all', opsFilter = 'all', editId = null;
const VIDS = ['Ампельные','Каскадные','Кустовые','Межвидовые','Многолетние'];

const MAT_KINDS = [
  {k:'soil',       name:'Земля',     unit:'л',    cat:'Земля'},
  {k:'fertilizer', name:'Удобрение', unit:'кг',   cat:'Удобрения'},
  {k:'pot',        name:'Горшок',    unit:'шт',   cat:'Горшки'},
  {k:'cassette',   name:'Кассета',   unit:'шт',   cat:'Кассеты'},
  {k:'cutting',    name:'Черенок',   unit:'шт',   cat:'Покупной черенок'},
  {k:'seed',       name:'Семена',    unit:'упак', cat:'Покупные семена'}
];
const MK = k => MAT_KINDS.find(x => x.k === k) || {k, name:k, unit:'', cat:'Закуп сырья'};
const WRITEOFF_REASONS = ['Погибло','Брак','Болезнь / вредители','Подарок','Для себя','Пересорт','Другое'];
const PAY = ['Наличные','Kaspi','Перевод','Карта'];
const TYPE_NAME = {income:'Приход', transplant:'Пересадка', writeoff:'Списание', sale:'Продажа', start:'Старт'};
const TYPE_BADGE = {income:'b-done', transplant:'b-tr', writeoff:'b-new', sale:'b-sale', start:'b-cancel'};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rnd = x => Math.round((Number(x) || 0) * 100) / 100;
const fmt = n => Math.round(n || 0).toLocaleString('ru-RU') + ' тг';
const dt  = ts => ts && ts.toDate ? ts.toDate().toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-';
const dtt = ts => ts && ts.toDate ? ts.toDate().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
const who = e => e ? String(e).split('@')[0] : '-';
const P = id => PRODUCTS.find(p => String(p.id) === String(id));
const M = id => MATERIALS.find(m => m._docId === id);
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru');
const pName = p => p ? p.name : '(удалён)';
const matLabel = m => m ? m.name + (m.kind === 'pot' && m.size ? ' · ' + SIZE(m.size).name : '') : '(удалено)';

/* ================= ВХОД ================= */
const AUTH = firebase.auth();
let _booted = false;
function tryLogin(){
  const email = document.getElementById('email').value.trim();
  const pw = document.getElementById('pw').value;
  document.getElementById('pwErr').style.display = 'none';
  AUTH.signInWithEmailAndPassword(email, pw).catch(() => { document.getElementById('pwErr').style.display = 'block'; });
}
function logout(){ AUTH.signOut(); }
AUTH.onAuthStateChanged(user => {
  if (user) { document.getElementById('gate').style.display = 'none'; if (!_booted) { _booted = true; boot(); } }
  else document.getElementById('gate').style.display = 'flex';
});

function setStatus(m, warn){ const s = document.getElementById('statusBar'); s.innerHTML = m; s.style.color = warn ? 'var(--red)' : ''; }

function boot(){
  try{
    DB.watchProducts(list => {
      PRODUCTS = list.sort((a,b) => String(a.group||'').localeCompare(String(b.group||'')) || byName(a,b));
      if (['stock','finance'].includes(curTab)) renderTab();
    });
    DB.watchMaterials(list => { MATERIALS = list.sort(byName); if (curTab === 'materials') renderTab(); });
    reloadAll();
    setStatus('База подключена');
  }catch(e){ setStatus('Ошибка подключения: ' + e.message, true); }
}
async function reloadAll(){
  try{
    const res = await Promise.all([DB.getOrders(), DB.getCustomers(), DB.getExpenses(), DB.getMoves()]);
    ORDERS = res[0]; CUSTOMERS = res[1]; EXPENSES = res[2]; MOVES = res[3];
    renderTab();
  }catch(e){ setStatus('Ошибка базы: ' + e.message, true); }
}
const TABS = ['stock','ops','orders','materials','customers','expenses','finance'];
function showTab(t){
  curTab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  TABS.forEach(x => document.getElementById('pane-' + x).style.display = x === t ? 'block' : 'none');
  renderTab();
}
function renderTab(){
  ({stock:renderStock, ops:renderOps, orders:renderOrders, materials:renderMaterials,
    customers:renderCustomers, expenses:renderExpenses, finance:renderFinance})[curTab]();
}
function closeOv(id){ document.getElementById(id).classList.remove('open'); }

/* ================= СКЛАД ================= */
function stockPills(p){
  const s = p.stock || {};
  const html = sizesOf(p).map(z => { const v = rnd(s[z.k]); return v ? '<span class="pill' + (v < 0 ? ' neg' : '') + '">' + z.short + ': <b>' + v + '</b></span>' : ''; }).join('');
  return html || '<span class="pill gray">нет</span>';
}
function pricePills(p){
  const pr = p.price || {};
  const html = sizesOf(p).map(z => pr[z.k] ? '<span class="pill gray">' + z.short + ': ' + pr[z.k] + '</span>' : '').join('');
  return html || '<span class="sub" style="color:var(--red)">цены не заданы</span>';
}
const hasStock = p => sizesOf(p).some(z => ((p.stock || {})[z.k] || 0) > 0);
const stockValue = () => PRODUCTS.reduce((n,p) => n + sizesOf(p).reduce((m,z) => m + Math.max(0, (p.stock||{})[z.k] || 0) * ((p.price||{})[z.k] || 0), 0), 0);

function renderStock(){
  const groups = [...new Set(PRODUCTS.map(p => p.group))].filter(Boolean).sort();
  const out = PRODUCTS.filter(p => !hasStock(p)).length;
  const neg = PRODUCTS.filter(p => sizesOf(p).some(z => ((p.stock||{})[z.k]||0) < 0)).length;
  const sEl = document.getElementById('sSearch');
  const q = (sEl ? sEl.value : '').toLowerCase();
  const focused = sEl && document.activeElement === sEl, caret = focused ? sEl.selectionStart : null;
  let list = PRODUCTS.filter(p => (grpFilter === 'all' || p.group === grpFilter) &&
    (cassFilter === 'all' || (cassFilter === 'cass' ? p.cassette : !p.cassette)) &&
    (!q || String(p.name).toLowerCase().includes(q)));

  document.getElementById('pane-stock').innerHTML =
    '<div class="stats">' +
      '<div class="stat"><div class="num">' + PRODUCTS.length + '</div><div class="lbl">Карточек</div></div>' +
      '<div class="stat warn"><div class="num">' + out + '</div><div class="lbl">Нет в наличии</div></div>' +
      (neg ? '<div class="stat warn"><div class="num">' + neg + '</div><div class="lbl">С минусом — проверь</div></div>' : '') +
      '<div class="stat"><div class="num">' + fmt(stockValue()) + '</div><div class="lbl">Склад в ценах продажи</div></div>' +
    '</div>' +
    '<div class="bar">' +
      '<input type="text" id="sSearch" placeholder="Поиск по названию..." value="' + esc(q) + '" oninput="renderStock()">' +
      '<select onchange="grpFilter=this.value;renderStock()"><option value="all">Все группы</option>' +
        groups.map(g => '<option ' + (grpFilter === g ? 'selected' : '') + '>' + esc(g) + '</option>').join('') + '</select>' +
      '<select onchange="cassFilter=this.value;renderStock()">' +
        [['all','Все карточки'],['pots','Только в горшках'],['cass','Только кассеты']].map(o => '<option value="' + o[0] + '"' + (cassFilter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
    '</div>' +
    '<div class="tbl-wrap"><table><thead><tr><th></th><th>Название</th><th>Группа / серия</th><th>Остатки, шт</th><th>Цены, тг</th><th>На сайте</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map(p => {
      const on = p.active !== false;
      const img = p.image_card ? '<img class="thumb" src="' + esc(p.image_card) + '" onerror="this.outerHTML=\'<div class=&quot;thumb-ph&quot;>*</div>\'">' : '<div class="thumb-ph">*</div>';
      return '<tr class="' + (on ? '' : 'off') + '"><td>' + img + '</td>' +
        '<td><b>' + esc(p.name) + '</b>' + (p.cassette ? ' <span class="badge b-tr">кассета</span>' : '') + (p.desc ? '<div class="sub">' + esc(p.desc) + '</div>' : '') + '</td>' +
        '<td>' + esc(p.group) + '<div class="sub">' + esc(p.type || '') + '</div></td>' +
        '<td>' + stockPills(p) + '</td><td>' + pricePills(p) + '</td>' +
        '<td><label class="sw"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="chActive(\'' + p.id + '\',this.checked)"><span class="sl"></span></label></td>' +
        '<td><div class="row-flex"><button class="icon-btn" title="Карточка и история" onclick="openProd(\'' + p.id + '\')">e</button>' +
        '<button class="icon-btn" title="Удалить карточку" onclick="delProd(\'' + p.id + '\')">x</button></div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">Ничего не найдено</td></tr>') +
    '</tbody></table></div>';
  if (focused) { const el = document.getElementById('sSearch'); el.focus(); try{ el.setSelectionRange(caret, caret); }catch(e){} }
}
async function chActive(id, on){ await DB.setActive(id, on); setStatus(on ? 'Позиция снова на сайте' : 'Позиция скрыта с сайта'); }
async function delProd(id){
  const p = P(id);
  if (!confirm('Удалить карточку «' + p.name + '» навсегда?\n\nЕсли товар просто закончился — лучше выключить «На сайте».')) return;
  await DB.deleteProduct(p.id); setStatus('Карточка удалена');
}

/* ================= КАРТОЧКА РАСТЕНИЯ ================= */
function grpList(){ return [...new Set(PRODUCTS.map(p => p.group))].filter(Boolean).sort(); }
function typList(g){ return [...new Set(PRODUCTS.filter(p => p.group === g).map(p => p.type))].filter(Boolean).sort(); }
function fillGrp(sel){
  const el = document.getElementById('pGroup'), gs = grpList();
  el.innerHTML = gs.map(g => '<option>' + esc(g) + '</option>').join('') + '<option value="__new__">+ Новая группа...</option>';
  el.value = gs.indexOf(sel) > -1 ? sel : (gs[0] || '__new__'); onGrp();
}
function onGrp(){
  const v = document.getElementById('pGroup').value;
  document.getElementById('rowNewGrp').style.display = v === '__new__' ? 'flex' : 'none';
  fillTyp(v === '__new__' ? null : v);
}
function addGrp(){
  const n = document.getElementById('pNewGroup').value.trim(); if (!n) { alert('Введите название'); return; }
  const el = document.getElementById('pGroup'), o = document.createElement('option'); o.value = n; o.textContent = n;
  el.insertBefore(o, el.lastElementChild); el.value = n;
  document.getElementById('rowNewGrp').style.display = 'none'; fillTyp(n);
}
function fillTyp(g, sel){
  const el = document.getElementById('pType'), ts = g ? typList(g) : [];
  el.innerHTML = ts.map(t => '<option>' + esc(t) + '</option>').join('') + '<option value="__new__">+ Новая серия...</option>';
  el.value = ts.indexOf(sel) > -1 ? sel : (ts[0] || '__new__'); onTyp();
}
function onTyp(){ document.getElementById('rowNewTyp').style.display = document.getElementById('pType').value === '__new__' ? 'flex' : 'none'; }
function addTyp(){
  const n = document.getElementById('pNewType').value.trim(); if (!n) { alert('Введите название'); return; }
  const el = document.getElementById('pType'), o = document.createElement('option'); o.value = n; o.textContent = n;
  el.insertBefore(o, el.lastElementChild); el.value = n;
  document.getElementById('rowNewTyp').style.display = 'none';
}
function drawVids(sel){
  sel = sel || [];
  document.getElementById('pVids').innerHTML = VIDS.map(v =>
    '<div class="chip ' + (sel.indexOf(v) > -1 ? 'on' : '') + '" data-v="' + v + '" onclick="this.classList.toggle(\'on\')">' + v + '</div>').join('');
}
let _prodPrice = {};
function drawPrices(){
  document.querySelectorAll('#pPrices input').forEach(i => _prodPrice[i.dataset.k] = num(i.value));
  const cass = document.getElementById('pCass').checked;
  document.getElementById('pPrices').innerHTML = sizesOf({cassette:cass}).map(z =>
    '<div><label>' + z.name + '</label><input type="number" min="0" data-k="' + z.k + '" value="' + (_prodPrice[z.k] || '') + '"></div>').join('');
}
function effectsFor(m, pid){ return (m.effects || []).filter(e => e.c === 'p' && e.id === String(pid)); }
function openProd(id){
  editId = id == null ? null : id;
  const p = editId != null ? P(editId) : null;
  document.getElementById('prodTitle').textContent = p ? 'Карточка: ' + p.name : 'Новая позиция';
  document.getElementById('pName').value = p ? p.name : '';
  document.getElementById('pDesc').value = (p && p.desc) || '';
  document.getElementById('pCass').checked = !!(p && p.cassette);
  _prodPrice = Object.assign({}, (p && p.price) || {});
  document.getElementById('pPrices').innerHTML = '';
  drawPrices();
  document.getElementById('pImg').value = ((p && p.image_card) || '').replace('images/','').replace('_card.webp','');
  document.getElementById('pActive').checked = p ? p.active !== false : true;
  fillGrp(p ? p.group : (grpFilter !== 'all' ? grpFilter : null));
  if (p) { document.getElementById('pGroup').value = p.group; onGrp(); fillTyp(p.group, p.type); }
  drawVids(p ? p.vid : []);
  document.getElementById('pStockBox').style.display = p ? 'block' : 'none';
  document.getElementById('pHistBox').style.display = p ? 'block' : 'none';
  if (p) {
    document.getElementById('pStockView').innerHTML = stockPills(p);
    const hist = MOVES.filter(m => effectsFor(m, p.id).length);
    document.getElementById('pHist').innerHTML = hist.length ? hist.map(m =>
      '<div><span class="badge ' + TYPE_BADGE[m.type] + '">' + TYPE_NAME[m.type] + '</span> ' + dtt(m.createdAt) + ' · ' +
      effectsFor(m, p.id).map(e => SIZE(e.size).name + ': <b class="' + (e.d > 0 ? 'money-pos' : 'money-neg') + '">' + (e.d > 0 ? '+' : '') + rnd(e.d) + '</b>').join(', ') +
      ' · <span class="sub">' + esc(who(m.author)) + (m.note ? ' · ' + esc(m.note) : '') + '</span></div>').join('')
      : '<div class="sub">Операций по этому товару пока нет (стартовый остаток загружается из файла)</div>';
  }
  document.getElementById('ovProd').classList.add('open');
}
async function saveProd(){
  const name = document.getElementById('pName').value.trim(); if (!name) { alert('Введите название'); return; }
  let g = document.getElementById('pGroup').value; if (g === '__new__') g = document.getElementById('pNewGroup').value.trim();
  let t = document.getElementById('pType').value; if (t === '__new__') t = document.getElementById('pNewType').value.trim();
  if (!g) { alert('Укажите группу'); return; } if (!t) { alert('Укажите серию'); return; }
  const key = document.getElementById('pImg').value.trim();
  const cass = document.getElementById('pCass').checked;
  const price = {};
  document.querySelectorAll('#pPrices input').forEach(i => { const v = num(i.value); if (v > 0) price[i.dataset.k] = v; });
  const old = editId != null ? P(editId) : null;
  const data = {
    id: old ? old.id : (PRODUCTS.length ? Math.max.apply(null, PRODUCTS.map(p => Number(p.id) || 0)) + 1 : 1),
    name, desc: document.getElementById('pDesc').value.trim(), group: g, type: t,
    vid: [].slice.call(document.querySelectorAll('#pVids .chip.on')).map(e => e.dataset.v),
    image_card: key ? 'images/' + key + '_card.webp' : '',
    cassette: cass, active: document.getElementById('pActive').checked
  };
  try{
    await DB.saveProduct(data);
    await DB.setPrices(data.id, price);
    closeOv('ovProd'); setStatus('Сохранено — изменения уже на сайте');
  }catch(e){ alert('Ошибка: ' + e.message); }
}

/* ================= ЭЛЕМЕНТЫ ФОРМ ================= */
const PICK = {};
const normName = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
function pickOptions(id, q, sel){
  const f = PICK[id] || (() => true);
  let list = PRODUCTS.filter(f).filter(p => !q || normName(p.name).includes(q)).sort(byName);
  if (sel != null && sel !== '' && !list.some(p => String(p.id) === String(sel))) { const s = P(sel); if (s && !q) list.unshift(s); }
  return list.map(p => '<option value="' + p.id + '"' + (String(p.id) === String(sel) ? ' selected' : '') + '>' +
    esc(p.name) + (p.cassette ? ' · кассета' : '') + ' — ' + esc(p.group || '') + '</option>').join('');
}
function pickHtml(id, sel, filter, onch){
  PICK[id] = filter || null;
  return '<input type="text" class="pick-q" placeholder="Поиск товара..." oninput="pickFilter(\'' + id + '\',this.value)">' +
    '<select id="' + id + '" onchange="' + onch + '">' + pickOptions(id, '', sel) + '</select>';
}
function pickFilter(id, q){
  const el = document.getElementById(id), cur = el.value;
  el.innerHTML = pickOptions(id, normName(q), cur);
  if (el.value !== cur) el.dispatchEvent(new Event('change'));
}
function setPick(id, sel){ const el = document.getElementById(id); el.innerHTML = pickOptions(id, '', sel); el.value = String(sel); }
function sizeOptions(p, sel){
  if (!p) return '<option value="">—</option>';
  const s = p.stock || {};
  return sizesOf(p).map(z => '<option value="' + z.k + '"' + (z.k === sel ? ' selected' : '') + '>' + z.name + ' · ост. ' + rnd(s[z.k]) + '</option>').join('');
}
function sizeSel(id, p, sel, onch){ return '<select id="' + id + '"' + (onch ? ' onchange="' + onch + '"' : '') + '>' + sizeOptions(p, sel) + '</select>'; }
function refreshSizes(pickId, sizeId){
  const el = document.getElementById(sizeId), cur = el.value;
  el.innerHTML = sizeOptions(P(document.getElementById(pickId).value), cur);
}
function matOptions(kinds, sel, empty){
  const list = MATERIALS.filter(m => !kinds || kinds.includes(m.kind));
  return (empty ? '<option value="">' + empty + '</option>' : '') + list.map(m =>
    '<option value="' + m._docId + '"' + (m._docId === sel ? ' selected' : '') + '>' + esc(matLabel(m)) + ' · ост. ' + rnd(m.stock) + ' ' + MK(m.kind).unit + '</option>').join('');
}
function matSel(id, kinds, sel, empty, onch){ return '<select id="' + id + '"' + (onch ? ' onchange="' + onch + '"' : '') + '>' + matOptions(kinds, sel, empty) + '</select>'; }
const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
function fld(label, html, cls){ return '<div class="f' + (cls ? ' ' + cls : '') + '"><label>' + label + '</label>' + html + '</div>'; }
function inp(id, v, attrs){ return '<input id="' + id + '" value="' + esc(v == null ? '' : v) + '" ' + (attrs || 'type="text"') + '>'; }

/* ================= ОКНО ОПЕРАЦИИ ================= */
let OP = { type: null, moveId: null, form: {} };
function openOp(type, moveId){
  if (!PRODUCTS.length && type !== 'income') { alert('В базе нет карточек растений'); return; }
  const m = moveId ? MOVES.find(x => x._docId === moveId) : null;
  OP = { type, moveId: moveId || null, form: m ? JSON.parse(JSON.stringify(m.form || {})) : {} };
  const t = { income:'Приход', transplant:'Пересадка', writeoff:'Списание', sale: (OP.form.source === 'site' ? 'Заказ с сайта' : 'Продажа в магазине') }[type];
  document.getElementById('opTitle').textContent = (m ? 'Изменить: ' : '') + t;
  renderOpBody(!m);
  document.getElementById('ovOp').classList.add('open');
}
function kindSeg(){
  const k = OP.form.kind || 'plant';
  return '<div class="seg">' + [['plant','Растение'],['mat','Сырьё (земля, горшки, удобрения, кассеты)']].map(o =>
    '<div class="chip' + (k === o[0] ? ' on' : '') + '" onclick="OP.form=collectOp();OP.form.kind=\'' + o[0] + '\';renderOpBody(true)">' + o[1] + '</div>').join('') + '</div>';
}
function renderOpBody(isNew){
  const f = OP.form, t = OP.type, body = document.getElementById('opBody');
  let h = '';
  if (t === 'income' || t === 'writeoff') {
    if (OP.moveId) h += ''; else h += kindSeg();
    if ((f.kind || 'plant') === 'plant') {
      const pid = f.pid || (PRODUCTS[0] && PRODUCTS[0].id);
      h += fld('Товар', pickHtml('opPid', pid, null, "refreshSizes('opPid','opSize')"));
      h += '<div class="f2">' + fld('Размер', sizeSel('opSize', P(pid), f.size)) + fld('Количество, шт', inp('opQty', f.qty || '', 'type="number" min="0"')) + '</div>';
    } else {
      if (!MATERIALS.length) h += '<div class="note">Сырья пока нет — добавь его во вкладке «Сырьё» кнопкой «+ Новое сырьё».</div>';
      h += fld('Сырьё', matSel('opMid', null, f.mid, '', ''));
      h += fld('Количество (л / кг / шт — как у сырья)', inp('opQty', f.qty || '', 'type="number" min="0" step="any"'));
    }
    if (t === 'income') h += fld('Сумма закупа, тг (необязательно — пойдёт в «Расходы»)', inp('opSum', f.sum || '', 'type="number" min="0"'));
    if (t === 'writeoff') h += fld('Причина', '<select id="opReason">' + WRITEOFF_REASONS.map(r => '<option' + (r === f.reason ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>');
    h += fld('Комментарий', inp('opNote', f.note || ''));
  }
  if (t === 'transplant') {
    const from = f.from || (PRODUCTS[0] && PRODUCTS[0].id);
    h += fld('Что пересаживаешь', pickHtml('opFrom', from, null, 'trFromChanged()'));
    h += '<div class="f2">' + fld('Размер сейчас', sizeSel('opFromSize', P(from), f.fromSize, 'trFromSizeChanged()')) +
         fld('Количество, шт', inp('opQty', f.qty || '', 'type="number" min="0" oninput="trCalc()"')) + '</div>';
    h += fld('Куда (карточка после пересадки)', pickHtml('opTo', f.to || from, p => !p.cassette, 'trToChanged()'));
    h += fld('Новый размер', sizeSel('opToSize', P(f.to || from), f.toSize, 'trToSizeChanged()'));
    h += '<div class="f2">' + fld('Земля', matSel('opSoil', ['soil'], f.soil, '— не списывать —', 'trCalc()')) +
         fld('Горшок', matSel('opPot', ['pot'], f.pot, '— без горшка —', 'trCalc()')) + '</div>';
    h += '<div class="calc" id="opCalc"></div>';
    h += fld('Комментарий', inp('opNote', f.note || ''));
  }
  if (t === 'sale') {
    h += '<div id="opLines"></div><button class="btn small" style="margin-bottom:.9rem" onclick="addLine()">+ Добавить позицию</button>';
    h += '<div class="f2">' + fld('Скидка', '<div class="row-flex">' + inp('opDisc', f.disc || '', 'type="number" min="0" oninput="saleTotal()" style="flex:1"') +
         '<select id="opDiscT" onchange="saleTotal()" style="width:70px">' + [['tg','тг'],['pct','%']].map(o => '<option value="' + o[0] + '"' + (f.discT === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>') +
         fld('Оплата', '<select id="opPay">' + ['', ...PAY].map(x => '<option' + (x === (f.pay || (OP.moveId ? '' : 'Наличные')) ? ' selected' : '') + ' value="' + x + '">' + (x || '—') + '</option>').join('') + '</select>') + '</div>';
    h += '<div class="f2">' + fld('Имя клиента (необязательно)', inp('opCName', f.name || '')) + fld('Телефон (необязательно)', inp('opCPhone', f.phone || '', 'type="tel"')) + '</div>';
    h += fld('Комментарий', inp('opNote', f.note || ''));
    h += '<div class="calc" id="opTotal"></div>';
  }
  body.innerHTML = h;
  if (t === 'transplant') { if (isNew && !f.from) trFromChanged(); else trCalc(); }
  if (t === 'sale') {
    LINE_N = 0;
    const lines = (f.lines && f.lines.length) ? f.lines : [null];
    lines.forEach(l => addLine(l));
    saleTotal();
  }
}

/* ---- пересадка ---- */
function baseOf(c){
  if (!c || !c.cassette) return c;
  return P(c.baseId) || PRODUCTS.find(x => !x.cassette && normName(x.name) === normName(String(c.name).replace(/\s*\(кассета\)\s*$/i, ''))) || null;
}
function nextSize(k){ const reg = SIZES.filter(s => s.k !== 'k'); const i = reg.findIndex(s => s.k === k); return (reg[i + 1] || reg[reg.length - 1]).k; }
function trFromChanged(){
  refreshSizes('opFrom', 'opFromSize');
  const p = P(val('opFrom'));
  const to = baseOf(p) || p;
  if (to && !to.cassette) setPick('opTo', to.id);
  refreshSizes('opTo', 'opToSize');
  trFromSizeChanged();
}
function trFromSizeChanged(){
  const fs = val('opFromSize');
  document.getElementById('opToSize').value = fs === 'k' ? 's02' : nextSize(fs);
  trToSizeChanged();
}
function trToChanged(){ refreshSizes('opTo', 'opToSize'); trToSizeChanged(); }
function trToSizeChanged(){
  const ts = val('opToSize');
  const pot = MATERIALS.find(m => m.kind === 'pot' && m.size === ts);
  document.getElementById('opPot').value = pot ? pot._docId : '';
  const soilEl = document.getElementById('opSoil');
  if (!soilEl.value && soilEl.options.length > 1 && !OP.moveId) soilEl.selectedIndex = 1;
  trCalc();
}
function trCalc(){
  const qty = num(val('opQty')), fs = val('opFromSize'), ts = val('opToSize');
  const from = P(val('opFrom')), to = P(val('opTo'));
  const liters = rnd(Math.max(0, SIZE(ts).l - SIZE(fs).l) * qty);
  const soil = M(val('opSoil')), pot = M(val('opPot'));
  let h = '<b>Спишется:</b> ' + esc(pName(from)) + ' (' + SIZE(fs).name + ') −' + qty + ' шт';
  if (soil && liters > 0) h += '; ' + esc(soil.name) + ' −' + liters + ' л';
  if (pot) h += '; ' + esc(matLabel(pot)) + ' −' + qty + ' шт';
  h += '<br><b>Придёт:</b> ' + esc(pName(to)) + ' (' + SIZE(ts).name + ') +' + qty + ' шт';
  h += '<div class="hint">Земля = (' + SIZE(ts).l + ' − ' + SIZE(fs).l + ') л × ' + qty + ' шт = ' + liters + ' л</div>';
  if (SIZE(ts).l <= SIZE(fs).l && fs !== 'k') h += '<div style="color:var(--red)">Новый размер не больше старого — проверь.</div>';
  if (!pot) h += '<div class="hint">Горшок не выбран — горшки не спишутся' + (MATERIALS.some(m => m.kind === 'pot') ? '' : ' (горшков в «Сырьё» нет)') + '.</div>';
  document.getElementById('opCalc').innerHTML = h;
}

/* ---- продажа: строки ---- */
let LINE_N = 0;
function addLine(l){
  const i = LINE_N++;
  const pid = l ? l.pid : (PRODUCTS.find(p => hasStock(p)) || PRODUCTS[0] || {}).id;
  const html = '<div class="line" data-i="' + i + '">' +
    '<div><label class="sub">Товар</label>' + pickHtml('lp_' + i, pid, null, 'lineProd(' + i + ')') + '</div>' +
    '<div><label class="sub">Размер</label>' + sizeSel('ls_' + i, P(pid), l ? l.size : firstSize(P(pid)), 'linePrice(' + i + ')') + '</div>' +
    '<div><label class="sub">Кол-во</label>' + inp('lq_' + i, l ? l.qty : 1, 'type="number" min="0" oninput="saleTotal()"') + '</div>' +
    '<div><label class="sub">Цена, тг</label>' + inp('lpr_' + i, l ? l.price : '', 'type="number" min="0" oninput="saleTotal()"') + '</div>' +
    '<button class="icon-btn" title="Убрать" onclick="this.parentElement.remove();saleTotal()">x</button></div>';
  document.getElementById('opLines').insertAdjacentHTML('beforeend', html);
  if (!l) linePrice(i);
}
function firstSize(p){ if (!p) return ''; const s = sizesOf(p).find(z => ((p.stock || {})[z.k] || 0) > 0); return (s || sizesOf(p)[0]).k; }
function lineProd(i){
  const p = P(val('lp_' + i));
  document.getElementById('ls_' + i).innerHTML = sizeOptions(p, firstSize(p));
  linePrice(i);
}
function linePrice(i){
  const p = P(val('lp_' + i)), k = val('ls_' + i);
  document.getElementById('lpr_' + i).value = (p && p.price && p.price[k]) || 0;
  saleTotal();
}
function saleLines(){
  return [].slice.call(document.querySelectorAll('#opLines .line')).map(el => {
    const i = el.dataset.i;
    return { pid: val('lp_' + i), size: val('ls_' + i), qty: num(val('lq_' + i)), price: num(val('lpr_' + i)) };
  }).filter(l => l.pid && l.qty > 0);
}
function saleCalc(lines, disc, discT){
  const subtotal = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const discount = Math.min(subtotal, Math.round(discT === 'pct' ? subtotal * disc / 100 : disc));
  return { subtotal, discount, total: subtotal - discount };
}
function saleTotal(){
  const el = document.getElementById('opTotal'); if (!el) return;
  const c = saleCalc(saleLines(), num(val('opDisc')), val('opDiscT'));
  el.innerHTML = 'Сумма: ' + fmt(c.subtotal) + (c.discount ? ' · Скидка: −' + fmt(c.discount) : '') + '<br><b style="font-size:1.05rem">Итого: ' + fmt(c.total) + '</b>';
}

/* ================= СБОР И ПРОВЕРКА ОПЕРАЦИИ ================= */
function collectOp(){
  const t = OP.type, f = Object.assign({}, OP.form);
  if (t === 'income' || t === 'writeoff') {
    f.kind = f.kind || 'plant';
    if (f.kind === 'plant') { f.pid = val('opPid'); f.size = val('opSize'); delete f.mid; }
    else { f.mid = val('opMid'); delete f.pid; delete f.size; }
    f.qty = num(val('opQty'));
    if (t === 'income') f.sum = num(val('opSum'));
    if (t === 'writeoff') f.reason = val('opReason');
    f.note = val('opNote').trim();
  }
  if (t === 'transplant') {
    Object.assign(f, { from: val('opFrom'), fromSize: val('opFromSize'), to: val('opTo'), toSize: val('opToSize'),
      qty: num(val('opQty')), soil: val('opSoil'), pot: val('opPot'), note: val('opNote').trim() });
  }
  if (t === 'sale') {
    Object.assign(f, { lines: saleLines(), disc: num(val('opDisc')), discT: val('opDiscT') || 'tg', pay: val('opPay'),
      name: val('opCName').trim(), phone: val('opCPhone').trim(), note: val('opNote').trim(), source: f.source || 'manual' });
  }
  return f;
}
function buildOp(t, f){
  const need = (c, msg) => { if (!c) throw new Error(msg); };
  if (t === 'income' || t === 'writeoff') {
    const sign = t === 'income' ? 1 : -1;
    need(f.qty > 0, 'Укажи количество');
    let effects, summary, cat;
    if (f.kind === 'plant') {
      const p = P(f.pid); need(p, 'Выбери товар'); need(f.size, 'Выбери размер');
      effects = [{ c:'p', id:String(p.id), size:f.size, d: sign * f.qty }];
      summary = p.name + ' · ' + SIZE(f.size).name + ' ' + (sign > 0 ? '+' : '−') + f.qty + ' шт';
      cat = 'Закуп товара';
    } else {
      const m = M(f.mid); need(m, 'Выбери сырьё');
      effects = [{ c:'m', id:m._docId, d: sign * f.qty }];
      summary = matLabel(m) + ' ' + (sign > 0 ? '+' : '−') + f.qty + ' ' + MK(m.kind).unit;
      cat = MK(m.kind).cat;
    }
    if (t === 'writeoff') summary += ' · ' + f.reason;
    const extra = t === 'income' ? { expense: { cat, sum: f.sum || 0, note: summary } } : {};
    return { op: { type:t, form:f, effects, summary, note:f.note }, extra };
  }
  if (t === 'transplant') {
    const from = P(f.from), to = P(f.to);
    need(from, 'Выбери, что пересаживаешь'); need(to, 'Выбери, куда пересаживаешь');
    need(f.fromSize && f.toSize, 'Выбери размеры'); need(f.qty > 0, 'Укажи количество');
    need(!(String(from.id) === String(to.id) && f.fromSize === f.toSize), 'Размер «откуда» и «куда» совпадает');
    const liters = rnd(Math.max(0, SIZE(f.toSize).l - SIZE(f.fromSize).l) * f.qty);
    f.liters = liters;
    const soil = M(f.soil), pot = M(f.pot);
    const effects = [
      { c:'p', id:String(from.id), size:f.fromSize, d:-f.qty },
      { c:'p', id:String(to.id),   size:f.toSize,   d: f.qty }
    ];
    if (soil && liters > 0) effects.push({ c:'m', id:soil._docId, d:-liters });
    if (pot) effects.push({ c:'m', id:pot._docId, d:-f.qty });
    let summary = from.name + ' (' + SIZE(f.fromSize).name + ') → ' + (String(to.id) === String(from.id) ? '' : to.name + ' ') + '(' + SIZE(f.toSize).name + ') × ' + f.qty + ' шт';
    if (soil && liters > 0) summary += '; земля ' + liters + ' л';
    if (pot) summary += '; горшки ' + f.qty + ' шт';
    return { op: { type:t, form:f, effects, summary, note:f.note }, extra: {} };
  }
  if (t === 'sale') {
    need(f.lines.length, 'Добавь хотя бы одну позицию с количеством');
    const items = f.lines.map(l => { const p = P(l.pid); need(p, 'Товар не найден'); return { plantId:p.id, name:p.name, size:l.size, qty:l.qty, price:l.price }; });
    const c = saleCalc(f.lines, f.disc, f.discT);
    const effects = items.map(i => ({ c:'p', id:String(i.plantId), size:i.size, d:-i.qty }));
    const summary = (f.source === 'site' ? 'Заказ с сайта: ' : '') + items.map(i => i.name + ' ' + SIZE(i.size).short + ' ×' + i.qty).join(', ') + ' = ' + fmt(c.total);
    const order = { items, subtotal:c.subtotal, discount:c.discount, total:c.total,
      discountText: f.disc ? f.disc + (f.discT === 'pct' ? '%' : ' тг') : '', pay:f.pay };
    if (f.source !== 'site') Object.assign(order, { name:f.name, phone:f.phone, comment:f.note });
    return { op: { type:t, form:f, effects, summary, note:f.note }, extra: { order } };
  }
  throw new Error('Неизвестная операция');
}
async function saveOp(){
  let built;
  try { built = buildOp(OP.type, collectOp()); } catch (e) { alert(e.message); return; }
  const btn = document.getElementById('opSaveBtn'); btn.disabled = true;
  try{
    if (OP.moveId) await DB.updateOp(OP.moveId, built.op, built.extra);
    else {
      await DB.createOp(built.op, built.extra);
      const o = built.extra.order;
      if (o && o.phone) await DB.upsertCustomer(o, o.total);
    }
    closeOv('ovOp'); await reloadAll();
    setStatus((OP.moveId ? 'Операция изменена' : TYPE_NAME[OP.type] + ' записан(а)') + ' — склад пересчитан');
  }catch(e){ alert('Ошибка: ' + e.message); }
  finally{ btn.disabled = false; }
}

/* ================= ЖУРНАЛ ОПЕРАЦИЙ ================= */
function renderOps(){
  const cnt = t => MOVES.filter(m => m.type === t).length;
  const list = MOVES.filter(m => opsFilter === 'all' || m.type === opsFilter);
  document.getElementById('pane-ops').innerHTML =
    '<div class="stats">' + ['income','transplant','writeoff','sale'].map(t =>
      '<div class="stat"><div class="num">' + cnt(t) + '</div><div class="lbl">' + TYPE_NAME[t] + '</div></div>').join('') + '</div>' +
    '<div class="seg">' + [['all','Все'],['income','Приход'],['transplant','Пересадка'],['writeoff','Списание'],['sale','Продажа'],['start','Старт']].map(o =>
      '<div class="chip' + (opsFilter === o[0] ? ' on' : '') + '" onclick="opsFilter=\'' + o[0] + '\';renderOps()">' + o[1] + '</div>').join('') + '</div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Когда</th><th>Тип</th><th>Что</th><th>Кто</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map(m =>
      '<tr><td class="sub">' + dtt(m.createdAt) + '</td><td><span class="badge ' + TYPE_BADGE[m.type] + '">' + TYPE_NAME[m.type] + '</span></td>' +
      '<td>' + esc(m.summary || '') + (m.note ? '<div class="sub">' + esc(m.note) + '</div>' : '') + '</td>' +
      '<td class="sub">' + esc(who(m.author)) + (m.editedBy ? '<br>изм.: ' + esc(who(m.editedBy)) + ' ' + dtt(m.editedAt) : '') + '</td>' +
      '<td><div class="row-flex">' + (m.type !== 'start' ? '<button class="icon-btn" title="Изменить" onclick="openOp(\'' + m.type + '\',\'' + m._docId + '\')">e</button>' +
        '<button class="icon-btn" title="Удалить и откатить" onclick="delOp(\'' + m._docId + '\')">x</button>' : '') + '</div></td></tr>').join('')
      : '<tr><td colspan="5" class="empty">Операций пока нет</td></tr>') +
    '</tbody></table></div>';
}
async function delOp(id){
  const m = MOVES.find(x => x._docId === id); if (!m) return;
  const extra = m.type === 'sale' ? (m.form && m.form.source === 'site' ? '\nЗаказ вернётся в статус «Новый».' : '\nПродажа удалится из «Продаж».') : '';
  if (!confirm('Удалить операцию «' + (m.summary || '') + '»?\nОстатки вернутся как были до неё.' + extra)) return;
  try{ await DB.deleteOp(id); await reloadAll(); setStatus('Операция удалена, склад откатан'); }
  catch(e){ alert('Ошибка: ' + e.message); }
}

/* ================= ПРОДАЖИ (сайт + магазин) ================= */
function renderOrders(){
  const done = ORDERS.filter(o => o.status === 'done');
  const nw = ORDERS.filter(o => o.status === 'new').length;
  document.getElementById('pane-orders').innerHTML =
    '<div class="stats">' +
      '<div class="stat"><div class="num">' + ORDERS.length + '</div><div class="lbl">Всего</div></div>' +
      '<div class="stat warn"><div class="num">' + nw + '</div><div class="lbl">Новые с сайта</div></div>' +
      '<div class="stat good"><div class="num">' + fmt(done.reduce((n,o) => n + (o.total || 0), 0)) + '</div><div class="lbl">Сумма выполненных</div></div>' +
    '</div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Откуда</th><th>Клиент</th><th>Состав</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>' +
    (ORDERS.length ? ORDERS.map(o => {
      const items = (o.items || []).map(i => esc(i.name) + ' · ' + SIZE(i.size).name + ' × ' + i.qty).join('<br>');
      const b = o.status === 'new' ? 'b-new' : o.status === 'done' ? 'b-done' : 'b-cancel';
      const t = o.status === 'new' ? 'Новый' : o.status === 'done' ? 'Выполнен' : 'Отменён';
      const mv = MOVES.find(m => m.orderId === o._docId);
      let acts = '';
      if (o.status === 'new') acts = '<button class="btn small green" onclick="confirmOrder(\'' + o._docId + '\')">Подтвердить</button>' +
        '<button class="btn small" onclick="ordStatus(\'' + o._docId + '\',\'cancel\')">Отменить</button>';
      if (o.status === 'done' && mv) acts = '<button class="icon-btn" title="Изменить" onclick="openOp(\'sale\',\'' + mv._docId + '\')">e</button>' +
        '<button class="icon-btn" title="' + (o.source === 'manual' ? 'Удалить продажу' : 'Отменить подтверждение') + '" onclick="delOp(\'' + mv._docId + '\')">x</button>';
      if (o.status === 'cancel') acts = '<button class="icon-btn" title="Удалить заказ" onclick="delOrder(\'' + o._docId + '\')">x</button>';
      return '<tr><td>' + dt(o.createdAt) + '</td><td><span class="badge ' + (o.source === 'manual' ? 'b-sale' : 'b-tr') + '">' + (o.source === 'manual' ? 'Магазин' : 'Сайт') + '</span></td>' +
        '<td><b>' + esc(o.name || '-') + '</b><div class="sub">' + esc(o.phone || '') + '</div></td>' +
        '<td class="sub">' + items + '</td>' +
        '<td><b>' + fmt(o.total) + '</b>' + (o.discount ? '<div class="sub">скидка ' + fmt(o.discount) + '</div>' : '') + (o.pay ? '<div class="sub">' + esc(o.pay) + '</div>' : '') + '</td>' +
        '<td><span class="badge ' + b + '">' + t + '</span><div class="sub">' + esc(who(o.author || (mv && mv.author))) + '</div></td>' +
        '<td><div class="row-flex">' + acts + '</div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">Продаж пока нет</td></tr>') +
    '</tbody></table></div>';
}
async function ordStatus(id, st){ await DB.setOrderStatus(id, st); await reloadAll(); setStatus('Статус заказа обновлён'); }
async function delOrder(id){ if (!confirm('Удалить отменённый заказ из списка?')) return; await DB.deleteOrder(id); await reloadAll(); }
async function confirmOrder(id){
  const o = ORDERS.find(x => x._docId === id); if (!o || o.status === 'done') return;
  const items = o.items || [];
  const missing = items.filter(i => !P(i.plantId));
  if (missing.length) { alert('В заказе есть товары, которых нет в базе: ' + missing.map(i => i.name).join(', ')); return; }
  const low = items.filter(i => (((P(i.plantId).stock) || {})[i.size] || 0) < i.qty);
  let msg = 'Подтвердить заказ? Товары спишутся со склада.';
  if (low.length) msg += '\n\nНе хватает: ' + low.map(i => i.name + ' ' + SIZE(i.size).name).join(', ') + ' — остаток уйдёт в минус.';
  if (!confirm(msg)) return;
  const form = { source:'site', lines: items.map(i => ({ pid:String(i.plantId), size:i.size, qty:i.qty, price:i.price })),
    disc:0, discT:'tg', pay:o.pay || '', name:o.name || '', phone:o.phone || '', note:'' };
  const op = { type:'sale', form, note:'', summary:'Заказ с сайта: ' + (o.name || '') + ' = ' + fmt(o.total),
    effects: items.map(i => ({ c:'p', id:String(i.plantId), size:i.size, d:-i.qty })) };
  try{
    await DB.createOp(op, { orderId:id, confirmOrder:true });
    if (o.phone) await DB.upsertCustomer(o, o.total);
    await reloadAll(); setStatus('Заказ подтверждён — склад списан');
  }catch(e){ alert('Ошибка: ' + e.message); }
}

/* ================= СЫРЬЁ ================= */
let matEditId = null;
function renderMaterials(){
  document.getElementById('pane-materials').innerHTML =
    '<div class="stats"><div class="stat"><div class="num">' + MATERIALS.length + '</div><div class="lbl">Видов сырья</div></div></div>' +
    '<div class="bar"><button class="btn primary" onclick="openMat()">+ Новое сырьё</button>' +
    '<button class="btn green" onclick="OP_kind(\'income\')">Приход сырья</button>' +
    '<button class="btn" onclick="OP_kind(\'writeoff\')">Списать сырьё</button></div>' +
    '<div class="note">Горшкам укажи размер — тогда при пересадке нужный горшок спишется сам. Земля считается в литрах.</div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Название</th><th>Вид</th><th>Размер</th><th>Остаток</th><th></th></tr></thead><tbody>' +
    (MATERIALS.length ? MATERIALS.map(m =>
      '<tr><td><b>' + esc(m.name || '-') + '</b></td><td>' + MK(m.kind).name + '</td>' +
      '<td class="sub">' + (m.kind === 'pot' ? (m.size ? SIZE(m.size).name : '<span style="color:var(--red)">не указан</span>') : '') + '</td>' +
      '<td><b' + ((m.stock || 0) < 0 ? ' style="color:var(--red)"' : '') + '>' + rnd(m.stock) + '</b> ' + MK(m.kind).unit + '</td>' +
      '<td><div class="row-flex"><button class="icon-btn" onclick="openMat(\'' + m._docId + '\')">e</button>' +
      '<button class="icon-btn" onclick="delMat(\'' + m._docId + '\')">x</button></div></td></tr>').join('')
      : '<tr><td colspan="5" class="empty">Сырья пока нет</td></tr>') +
    '</tbody></table></div>';
}
function OP_kind(t){ openOp(t); OP.form = collectOp(); OP.form.kind = 'mat'; renderOpBody(true); }
function matKindChange(){
  const k = val('matKind');
  document.getElementById('matUnitHint').textContent = 'Единица измерения: ' + MK(k).unit;
  document.getElementById('matSizeBox').style.display = k === 'pot' ? 'block' : 'none';
}
function openMat(docId){
  matEditId = docId || null;
  const m = docId ? M(docId) : null;
  document.getElementById('matTitle').textContent = m ? 'Редактировать сырьё' : 'Новое сырьё';
  document.getElementById('matName').value = m ? (m.name || '') : '';
  document.getElementById('matKind').innerHTML = MAT_KINDS.map(x => '<option value="' + x.k + '"' + (x.k === (m ? m.kind : 'soil') ? ' selected' : '') + '>' + x.name + ' (' + x.unit + ')</option>').join('');
  document.getElementById('matSize').innerHTML = SIZES.filter(s => s.k !== 'k').map(s => '<option value="' + s.k + '"' + (m && m.size === s.k ? ' selected' : '') + '>' + s.name + '</option>').join('');
  matKindChange();
  document.getElementById('ovMat').classList.add('open');
}
async function saveMat(){
  const name = val('matName').trim(), kind = val('matKind');
  if (!name) { alert('Введите название'); return; }
  const data = { name, kind };
  if (kind === 'pot') data.size = val('matSize');
  if (matEditId) data._docId = matEditId;
  try{ await DB.saveMaterial(data); closeOv('ovMat'); setStatus('Сырьё сохранено'); }
  catch(e){ alert('Ошибка: ' + e.message); }
}
async function delMat(docId){
  const m = M(docId);
  if (MOVES.some(x => (x.effects || []).some(e => e.c === 'm' && e.id === docId))) {
    alert('По «' + m.name + '» есть операции — сначала удали их в журнале, иначе их нельзя будет откатить.'); return;
  }
  if (!confirm('Удалить «' + m.name + '»?')) return;
  try{ await DB.deleteMaterial(docId); setStatus('Сырьё удалено'); } catch(e){ alert('Ошибка: ' + e.message); }
}

/* ================= КЛИЕНТЫ ================= */
function renderCustomers(){
  const tot = CUSTOMERS.reduce((n,c) => n + (c.totalSpent || 0), 0);
  document.getElementById('pane-customers').innerHTML =
    '<div class="stats">' +
      '<div class="stat"><div class="num">' + CUSTOMERS.length + '</div><div class="lbl">Клиентов</div></div>' +
      '<div class="stat good"><div class="num">' + fmt(tot) + '</div><div class="lbl">Купили на сумму</div></div>' +
    '</div>' +
    '<div class="note">Клиент добавляется сам, если у продажи указан телефон.</div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Имя</th><th>Телефон</th><th>Адрес</th><th>Покупок</th><th>На сумму</th><th>Последняя</th></tr></thead><tbody>' +
    (CUSTOMERS.length ? CUSTOMERS.map(c => '<tr><td><b>' + esc(c.name || '-') + '</b></td><td>' + esc(c.phone || '') + '</td>' +
      '<td class="sub">' + esc(c.address || '-') + '</td><td>' + (c.ordersCount || 0) + '</td><td><b>' + fmt(c.totalSpent) + '</b></td><td class="sub">' + dt(c.lastOrderAt) + '</td></tr>').join('')
      : '<tr><td colspan="6" class="empty">Клиентов пока нет</td></tr>') +
    '</tbody></table></div>';
}

/* ================= РАСХОДЫ ================= */
function renderExpenses(){
  const tot = EXPENSES.reduce((n,e) => n + (e.sum || 0), 0);
  document.getElementById('pane-expenses').innerHTML =
    '<div class="stats"><div class="stat warn"><div class="num">' + fmt(tot) + '</div><div class="lbl">Всего расходов</div></div>' +
    '<div class="stat"><div class="num">' + EXPENSES.length + '</div><div class="lbl">Записей</div></div></div>' +
    '<div class="bar"><button class="btn primary" onclick="openExp()">+ Прочий расход</button></div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Сумма</th><th></th></tr></thead><tbody>' +
    (EXPENSES.length ? EXPENSES.map(e => '<tr><td>' + esc(e.date || dt(e.createdAt)) + '</td><td><b>' + esc(e.cat) + '</b></td>' +
      '<td class="sub">' + esc(e.note || '') + (e.moveId ? ' · из прихода' : '') + '</td><td class="money-neg">-' + fmt(e.sum) + '</td>' +
      '<td><button class="icon-btn" onclick="delExp(\'' + e._docId + '\')">x</button></td></tr>').join('')
      : '<tr><td colspan="5" class="empty">Расходов пока нет</td></tr>') +
    '</tbody></table></div>';
}
function openExp(){
  document.getElementById('eSum').value = ''; document.getElementById('eNote').value = '';
  document.getElementById('eDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('ovExp').classList.add('open');
}
async function saveExp(){
  const sum = num(val('eSum')); if (sum <= 0) { alert('Укажите сумму'); return; }
  try{ await DB.addExpense({ cat: val('eCat'), sum, date: val('eDate'), note: val('eNote').trim(), author: AUTH.currentUser ? AUTH.currentUser.email : '' });
    closeOv('ovExp'); await reloadAll(); setStatus('Расход записан'); }
  catch(e){ alert('Ошибка: ' + e.message); }
}
async function delExp(id){
  const e = EXPENSES.find(x => x._docId === id);
  if (e && e.moveId) { alert('Этот расход создан приходом. Измени сумму или удали сам приход во вкладке «Операции».'); return; }
  if (!confirm('Удалить запись о расходе?')) return;
  await DB.deleteExpense(id); await reloadAll();
}

/* ================= ФИНАНСЫ ================= */
function renderFinance(){
  const done = ORDERS.filter(o => o.status === 'done');
  const revenue = done.reduce((n,o) => n + (o.total || 0), 0);
  const spent = EXPENSES.reduce((n,e) => n + (e.sum || 0), 0);
  const profit = revenue - spent;
  const shop = done.filter(o => o.source === 'manual').reduce((n,o) => n + (o.total || 0), 0);
  const months = {};
  const mk = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  done.forEach(o => { if (!o.createdAt || !o.createdAt.toDate) return; const k = mk(o.createdAt.toDate()); months[k] = months[k] || {rev:0,exp:0}; months[k].rev += o.total || 0; });
  EXPENSES.forEach(e => { const d = (e.createdAt && e.createdAt.toDate) ? e.createdAt.toDate() : (e.date ? new Date(e.date) : null); if (!d) return; const k = mk(d); months[k] = months[k] || {rev:0,exp:0}; months[k].exp += e.sum || 0; });
  const rows = Object.entries(months).sort((a,b) => b[0].localeCompare(a[0]));
  const NM = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  document.getElementById('pane-finance').innerHTML =
    '<div class="stats">' +
      '<div class="stat good"><div class="num">' + fmt(revenue) + '</div><div class="lbl">Выручка</div></div>' +
      '<div class="stat warn"><div class="num">' + fmt(spent) + '</div><div class="lbl">Расходы</div></div>' +
      '<div class="stat"><div class="num ' + (profit >= 0 ? 'money-pos' : 'money-neg') + '">' + fmt(profit) + '</div><div class="lbl">Выручка − расходы</div></div>' +
      '<div class="stat"><div class="num">' + fmt(stockValue()) + '</div><div class="lbl">Склад в ценах продажи</div></div>' +
    '</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="num">' + fmt(revenue - shop) + '</div><div class="lbl">С сайта</div></div>' +
      '<div class="stat"><div class="num">' + fmt(shop) + '</div><div class="lbl">В магазине</div></div>' +
      '<div class="stat"><div class="num">' + fmt(done.length ? revenue / done.length : 0) + '</div><div class="lbl">Средний чек</div></div>' +
    '</div>' +
    '<div class="note">Считаются только выполненные продажи. Себестоимость стартового товара = 0, поэтому прибыль по нему завышена.</div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th>Выручка</th><th>Расходы</th><th>Разница</th></tr></thead><tbody>' +
    (rows.length ? rows.map(r => { const p = r[0].split('-'), v = r[1], d = v.rev - v.exp;
      return '<tr><td><b>' + NM[+p[1] - 1] + ' ' + p[0] + '</b></td><td class="money-pos">' + fmt(v.rev) + '</td><td class="money-neg">' + fmt(v.exp) + '</td><td class="' + (d >= 0 ? 'money-pos' : 'money-neg') + '"><b>' + fmt(d) + '</b></td></tr>'; }).join('')
      : '<tr><td colspan="4" class="empty">Пока нет данных</td></tr>') +
    '</tbody></table></div>';
}

/* ================= ЗАГРУЗКА ОСТАТКОВ ИЗ .TXT ================= */
const TXT_SECTIONS = [['раст','plant'],['цвет','plant'],['рассад','plant'],['зем','soil'],['грунт','soil'],['удобр','fertilizer'],
  ['горш','pot'],['кассет','cassette'],['черен','cutting'],['семен','seed'],['семя','seed']];
function txtSection(t){ t = normName(t.replace(/^#+/, '').replace(/[:()].*$/, '')); for (const [w, k] of TXT_SECTIONS) if (t.includes(w)) return k; return null; }
function txtSize(s){
  let t = normName(s).replace(',', '.').replace(/литр(а|ов)?/g, '').replace(/л\.?/g, '').replace(/\s/g, '');
  if (t.startsWith('кас') || t === 'к') return 'k';
  const n = parseFloat(t); if (isNaN(n)) return null;
  const z = SIZES.find(x => x.k !== 'k' && Math.abs(x.l - n) < 0.001);
  return z ? z.k : null;
}
const txtNum = s => { const n = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };

// Чистая функция: текст файла → план записи + отчёт. Ничего не пишет в базу.
function parseStockTxt(text, products, materials){
  const errors = [], newCards = [], pmap = {}, mmap = {};
  let sec = null, nextId = products.length ? Math.max.apply(null, products.map(p => Number(p.id) || 0)) + 1 : 1;
  const virtual = [];   // карточки, которые будут созданы
  const all = () => products.concat(virtual);
  const findBase = name => all().find(p => !p.cassette && normName(p.name) === normName(name));
  const findCass = (base, name) => all().find(p => p.cassette && (
    (base && String(p.baseId) === String(base.id)) || normName(p.name) === normName(name + ' (кассета)') || normName(p.name) === normName(name)));
  const touch = p => pmap[p.id] || (pmap[p.id] = { id: p.id, name: p.name, stock: {}, price: {}, data: p._new ? p._new : null });
  let rows = 0;
  String(text).replace(/^﻿/, '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim(), ln = idx + 1;
    if (!line || line.startsWith('//')) return;
    const parts = line.split(/\s*[|;\t]\s*/).map(s => s.trim()).filter((s, i, a) => s !== '' || i < a.length - 1);
    if (line.startsWith('#') || (parts.length === 1 && txtSection(line))) {
      const s = txtSection(line); if (s) sec = s; else if (line.startsWith('#')) errors.push('Строка ' + ln + ': непонятный раздел «' + line + '»');
      return;
    }
    if (parts.length >= 1 && /^название$/i.test(parts[0])) return; // строка-заголовок
    if (!sec) { errors.push('Строка ' + ln + ': до неё нет раздела (# РАСТЕНИЯ, # ЗЕМЛЯ ...)'); return; }
    if (sec === 'plant') {
      if (parts.length < 3) { errors.push('Строка ' + ln + ': нужно «название | размер | количество | цена»'); return; }
      const [name, sz, q, pr] = parts, size = txtSize(sz), qty = txtNum(q), price = pr != null && pr !== '' ? txtNum(pr) : undefined;
      if (!size) { errors.push('Строка ' + ln + ': непонятный размер «' + sz + '»'); return; }
      if (qty == null) { errors.push('Строка ' + ln + ': непонятное количество «' + q + '»'); return; }
      if (price === null) { errors.push('Строка ' + ln + ': непонятная цена «' + pr + '»'); return; }
      let base = findBase(name);
      let card;
      if (size === 'k') {
        card = findCass(base, name);
        if (!card) {
          if (!base) { base = mkCard(name, null); }
          card = mkCard(base.name + ' (кассета)', base);
        }
      } else {
        card = base || mkCard(name, null);
      }
      const e = touch(card);
      e.stock[size] = (e.stock[size] || 0) + qty;
      if (price != null) e.price[size] = price;
      rows++;
    } else {
      if (parts.length < 2) { errors.push('Строка ' + ln + ': нужно «название | количество»'); return; }
      const name = parts[0], qty = txtNum(parts[1]);
      if (qty == null) { errors.push('Строка ' + ln + ': непонятное количество «' + parts[1] + '»'); return; }
      let size;
      if (sec === 'pot') {
        size = (parts[2] && txtSize(parts[2])) || (() => { const m = name.replace(',', '.').match(/(\d+(?:\.\d+)?)/g); return m ? txtSize(m[m.length - 1]) : null; })();
        if (!size) { errors.push('Строка ' + ln + ': не понял размер горшка в «' + name + '» (напиши, например, «Горшок 0.2»)'); return; }
      }
      const key = sec + '|' + normName(name);
      const ex = materials.find(m => m.kind === sec && normName(m.name) === normName(name));
      mmap[key] = mmap[key] || { docId: ex ? ex._docId : null, name, kind: sec, size, stock: 0 };
      mmap[key].stock = rnd(mmap[key].stock + qty);
      rows++;
    }
  });
  function mkCard(name, base){
    const id = nextId++;
    const data = base
      ? { id, name, desc:'', group: base.group || 'Новые из файла', type: base.type || '-', vid: base.vid || [], image_card: base.image_card || '', active: true, cassette: true, baseId: base.id, cost: {} }
      : { id, name, desc:'', group: 'Новые из файла', type: '-', vid: [], image_card: '', active: true, cassette: false, cost: {} };
    const card = Object.assign({ _new: data }, data);
    virtual.push(card); newCards.push(name);
    if (!base) touch(card);   // базовая карточка создаётся, даже если в файле только кассеты
    return card;
  }
  return { plan: { products: Object.values(pmap), materials: Object.values(mmap) }, errors, newCards, rows };
}

let IMP = null;
function openImport(){
  IMP = null; document.getElementById('impPreview').innerHTML = ''; document.getElementById('impGo').disabled = true;
  document.getElementById('impFile').value = '';
  document.getElementById('ovImp').classList.add('open');
}
function checkImport(){
  const f = document.getElementById('impFile').files[0];
  if (!f) { alert('Выбери файл .txt'); return; }
  const r = new FileReader();
  r.onload = e => {
    IMP = parseStockTxt(e.target.result, PRODUCTS, MATERIALS);
    IMP.fileName = f.name;
    const pv = document.getElementById('impPreview');
    const noPrice = IMP.plan.products.filter(p => Object.keys(p.stock).some(k => !p.price[k] && !((P(p.id) || {}).price || {})[k]));
    pv.innerHTML =
      '<div class="note">Распознано строк: <b>' + IMP.rows + '</b> · карточек растений: <b>' + IMP.plan.products.length + '</b> · сырья: <b>' + IMP.plan.materials.length + '</b></div>' +
      (IMP.newCards.length ? '<div class="f"><b>Будут созданы новые карточки (' + IMP.newCards.length + '):</b><br>' + IMP.newCards.map(esc).join(', ') + '<div class="hint">Если название растения просто написано иначе — исправь его в файле, чтобы совпало с сайтом.</div></div>' : '') +
      (noPrice.length ? '<div class="f" style="color:var(--red)"><b>Без цены (' + noPrice.length + '):</b> ' + noPrice.map(p => esc(p.name)).join(', ') + '</div>' : '') +
      (IMP.errors.length ? '<div class="f" style="color:var(--red)"><b>Ошибки (' + IMP.errors.length + ') — эти строки будут пропущены:</b><br>' + IMP.errors.map(esc).join('<br>') + '</div>' : '<div class="money-pos">Ошибок нет</div>');
    document.getElementById('impGo').disabled = !IMP.rows;
  };
  r.readAsText(f, 'utf-8');
}
async function runImport(){
  if (!IMP) return;
  if (MOVES.some(m => m.type !== 'start') && !confirm('В базе уже есть операции. Остатки из файла ЗАМЕНЯТ текущие по указанным позициям. Продолжить?')) return;
  const btn = document.getElementById('impGo'); btn.disabled = true;
  const pv = document.getElementById('impPreview');
  try{
    await DB.applyImport(IMP.plan, IMP.fileName, (d, t) => { pv.innerHTML = 'Записываю ' + d + ' из ' + t + '...'; });
    pv.innerHTML = '<div class="money-pos">Готово! Остатки загружены.</div>';
    await reloadAll(); setStatus('Стартовые остатки загружены');
  }catch(e){ pv.innerHTML = '<span style="color:var(--red)">Ошибка: ' + esc(e.message) + '</span>'; btn.disabled = false; }
}

/* ================= ОБНУЛЕНИЕ ================= */
function openReset(){ document.getElementById('resetWord').value = ''; document.getElementById('resetLog').textContent = ''; document.getElementById('ovReset').classList.add('open'); }
async function runReset(){
  if (val('resetWord').trim().toUpperCase() !== 'УДАЛИТЬ') { alert('Напиши слово УДАЛИТЬ'); return; }
  const log = document.getElementById('resetLog');
  try{
    await DB.resetAll(m => log.textContent = m);
    log.textContent = 'Готово. Теперь загрузи остатки из .txt';
    await reloadAll(); setStatus('База обнулена');
    setTimeout(() => { closeOv('ovReset'); openImport(); }, 1200);
  }catch(e){ log.textContent = 'Ошибка: ' + e.message; }
}

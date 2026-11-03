// ============================================================
//  Слой работы с базой Firebase (общий для сайта и админки)
//  Настройки подключения — в firebase-config.js
//
//  ПРИНЦИП УЧЁТА: остаток меняется ТОЛЬКО через операции
//  (приход, пересадка, списание, продажа). Каждая операция хранит
//  свои «эффекты» — сколько и где прибавилось/убавилось. Поэтому её
//  можно отредактировать или удалить, и склад пересчитается сам.
// ============================================================

firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;

// Коллекции (таблицы) в базе
const COL = {
  products:  db.collection('products'),   // карточки растений + остатки по размерам
  orders:    db.collection('orders'),     // продажи: заказы с сайта и продажи в магазине
  customers: db.collection('customers'),  // клиенты
  expenses:  db.collection('expenses'),   // расходы бизнеса
  moves:     db.collection('stock_moves'),// журнал операций
  materials: db.collection('materials')   // сырьё: земля, удобрения, горшки, кассеты, черенки, семена
};

// ---------- РАЗМЕРЫ ----------
// l — объём земли в литрах (для расчёта при пересадке). Кассета = 0.
const SIZES = [
  { k: 'k',   name: 'Кассета', short: 'Кас', l: 0   },
  { k: 's02', name: '0.2 л',   short: '0.2', l: 0.2 },
  { k: 's05', name: '0.5 л',   short: '0.5', l: 0.5 },
  { k: 's1',  name: '1 л',     short: '1',   l: 1   },
  { k: 's3',  name: '3 л',     short: '3',   l: 3   },
  { k: 's5',  name: '5 л',     short: '5',   l: 5   },
  { k: 's7',  name: '7 л',     short: '7',   l: 7   },
  { k: 's10', name: '10 л',    short: '10',  l: 10  }
];
const SIZE = k => SIZES.find(s => s.k === k) || { k, name: k, short: k, l: 0 };
// Карточка «в кассетах» имеет один размер — кассета. Обычная — все горшки.
const sizesOf = p => (p && p.cassette) ? SIZES.filter(s => s.k === 'k') : SIZES.filter(s => s.k !== 'k');

const currentUserEmail = () => {
  try { const u = firebase.auth && firebase.auth().currentUser; return u ? (u.email || u.uid) : ''; }
  catch (e) { return ''; }
};

// Склеивает одинаковые эффекты: {c:'p'|'m', id, size?, d}
function mergeEffects(list) {
  const map = {};
  (list || []).forEach(e => {
    if (!e || !e.d) return;
    const key = e.c + '|' + e.id + '|' + (e.size || '');
    if (!map[key]) map[key] = { c: e.c, id: String(e.id), d: 0 };
    if (e.size) map[key].size = e.size;
    map[key].d = Math.round((map[key].d + Number(e.d)) * 1000) / 1000;
  });
  return Object.values(map).filter(e => e.d !== 0);
}
// Разница «новые минус старые» — то, что надо применить при редактировании
function diffEffects(oldList, newList) {
  return mergeEffects([...(newList || []), ...(oldList || []).map(e => ({ ...e, d: -e.d }))]);
}
function applyEffects(batch, effects) {
  mergeEffects(effects).forEach(e => {
    if (e.c === 'p') batch.update(COL.products.doc(String(e.id)), { ['stock.' + e.size]: FV.increment(e.d) });
    else if (e.c === 'm') batch.update(COL.materials.doc(String(e.id)), { stock: FV.increment(e.d) });
  });
}

const DB = {
  // ---------- ТОВАРЫ ----------
  async getProducts(onlyActive) {
    const snap = await COL.products.get();
    let list = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    if (onlyActive) list = list.filter(p => p.active !== false);
    return list;
  },

  // Живое обновление: колбэк вызывается при каждом изменении в базе
  watchProducts(callback, onlyActive) {
    return COL.products.onSnapshot(snap => {
      let list = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
      if (onlyActive) list = list.filter(p => p.active !== false);
      callback(list);
    });
  },

  // Сохраняет карточку. Остатки здесь НЕ меняются — только через операции.
  async saveProduct(product) {
    const id = String(product.id);
    const data = { ...product }; delete data._docId; delete data.stock;
    const ref = COL.products.doc(id);
    const snap = await ref.get();
    if (!snap.exists) data.stock = {};
    await ref.set(data, { merge: true });
    return id;
  },
  async setPrices(id, price) {
    await COL.products.doc(String(id)).update({ price });
  },
  async deleteProduct(id) {
    await COL.products.doc(String(id)).delete();
  },
  async setActive(id, active) {
    await COL.products.doc(String(id)).update({ active: !!active });
  },

  // ---------- ОПЕРАЦИИ (приход, пересадка, списание, продажа) ----------
  // op: { type, form, effects, summary, note }
  // extra.expense: {cat, sum, note} — расход, который создаётся вместе с операцией
  // extra.order:   данные продажи в магазине (создаётся документ в orders)
  // extra.orderId + extra.confirmOrder: подтверждение заказа с сайта
  async createOp(op, extra) {
    extra = extra || {};
    const batch = db.batch();
    const moveRef = COL.moves.doc();
    const effects = mergeEffects(op.effects);
    applyEffects(batch, effects);
    const move = {
      type: op.type, form: op.form || {}, effects, summary: op.summary || '', note: op.note || '',
      author: currentUserEmail(), createdAt: FV.serverTimestamp()
    };
    if (extra.expense && extra.expense.sum > 0) {
      const expRef = COL.expenses.doc();
      batch.set(expRef, { ...extra.expense, date: new Date().toISOString().slice(0, 10), moveId: moveRef.id, createdAt: FV.serverTimestamp() });
      move.expenseId = expRef.id;
    }
    if (extra.order) {
      const ordRef = COL.orders.doc();
      batch.set(ordRef, { ...extra.order, source: 'manual', status: 'done', moveId: moveRef.id,
        author: move.author, createdAt: FV.serverTimestamp(), confirmedAt: FV.serverTimestamp() });
      move.orderId = ordRef.id;
    }
    if (extra.orderId) {
      move.orderId = extra.orderId;
      if (extra.confirmOrder) batch.update(COL.orders.doc(extra.orderId), { status: 'done', moveId: moveRef.id, confirmedAt: FV.serverTimestamp() });
    }
    batch.set(moveRef, move);
    await batch.commit();
    return moveRef.id;
  },

  // Редактирование: применяем только разницу между старыми и новыми эффектами
  async updateOp(moveId, op, extra) {
    extra = extra || {};
    const ref = COL.moves.doc(moveId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Операция не найдена');
    const old = snap.data();
    if (old.type === 'start') throw new Error('Стартовую загрузку нельзя редактировать');
    const effects = mergeEffects(op.effects);
    const batch = db.batch();
    applyEffects(batch, diffEffects(old.effects, effects));
    const upd = { form: op.form || {}, effects, summary: op.summary || '', note: op.note || '',
      editedBy: currentUserEmail(), editedAt: FV.serverTimestamp() };
    // расход, привязанный к операции
    const sum = extra.expense ? (extra.expense.sum || 0) : 0;
    if (old.expenseId && sum > 0) batch.update(COL.expenses.doc(old.expenseId), { ...extra.expense });
    else if (old.expenseId && sum <= 0) { batch.delete(COL.expenses.doc(old.expenseId)); upd.expenseId = FV.delete(); }
    else if (!old.expenseId && sum > 0) {
      const expRef = COL.expenses.doc();
      batch.set(expRef, { ...extra.expense, date: new Date().toISOString().slice(0, 10), moveId, createdAt: FV.serverTimestamp() });
      upd.expenseId = expRef.id;
    }
    if (extra.order && old.orderId) batch.update(COL.orders.doc(old.orderId), { ...extra.order });
    batch.update(ref, upd);
    await batch.commit();
  },

  // Удаление: эффекты откатываются, связанный расход удаляется.
  // Продажа в магазине удаляется целиком, заказ с сайта возвращается в «Новые».
  async deleteOp(moveId) {
    const ref = COL.moves.doc(moveId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const old = snap.data();
    const batch = db.batch();
    applyEffects(batch, (old.effects || []).map(e => ({ ...e, d: -e.d })));
    if (old.expenseId) batch.delete(COL.expenses.doc(old.expenseId));
    if (old.orderId) {
      const oSnap = await COL.orders.doc(old.orderId).get();
      if (oSnap.exists) {
        if (oSnap.data().source === 'manual') batch.delete(oSnap.ref);
        else batch.update(oSnap.ref, { status: 'new', moveId: FV.delete() });
      }
    }
    batch.delete(ref);
    await batch.commit();
  },

  async getMoves(limit) {
    const snap = await COL.moves.orderBy('createdAt', 'desc').limit(limit || 2000).get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  // ---------- ЗАКАЗЫ С САЙТА ----------
  // items: [{ plantId, name, size, qty, price }]
  // Покупатель только ОСТАВЛЯЕТ заявку — склад не трогается до подтверждения.
  async createOrder(order, items) {
    const orderRef = COL.orders.doc();
    await orderRef.set({ ...order, items, source: 'site', status: 'new', createdAt: FV.serverTimestamp() });
    return orderRef.id;
  },
  async getOrders(limit) {
    const snap = await COL.orders.orderBy('createdAt', 'desc').limit(limit || 1000).get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },
  async setOrderStatus(docId, status) {
    await COL.orders.doc(docId).update({ status });
  },
  async deleteOrder(docId) {
    await COL.orders.doc(docId).delete();
  },

  // ---------- КЛИЕНТЫ ----------
  async upsertCustomer(order, total) {
    const phone = String(order.phone || '').replace(/\D/g, '');
    if (!phone) return;
    const ref = COL.customers.doc(phone);
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      await ref.update({
        name: order.name || d.name, email: order.email || d.email || '', address: order.address || d.address || '',
        ordersCount: (d.ordersCount || 0) + 1, totalSpent: (d.totalSpent || 0) + (total || 0),
        lastOrderAt: FV.serverTimestamp()
      });
    } else {
      await ref.set({
        phone, name: order.name || '', email: order.email || '', address: order.address || '',
        ordersCount: 1, totalSpent: total || 0, createdAt: FV.serverTimestamp(), lastOrderAt: FV.serverTimestamp()
      });
    }
  },
  async getCustomers() {
    const snap = await COL.customers.orderBy('totalSpent', 'desc').get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  // ---------- РАСХОДЫ ----------
  async addExpense(exp) {
    await COL.expenses.add({ ...exp, createdAt: FV.serverTimestamp() });
  },
  async getExpenses() {
    const snap = await COL.expenses.orderBy('createdAt', 'desc').limit(1000).get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },
  async deleteExpense(docId) {
    await COL.expenses.doc(docId).delete();
  },

  // ---------- СЫРЬЁ ----------
  async getMaterials() {
    const snap = await COL.materials.get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },
  watchMaterials(cb) {
    return COL.materials.onSnapshot(snap => cb(snap.docs.map(d => ({ ...d.data(), _docId: d.id }))));
  },
  // Создание/редактирование сырья (без остатка — он меняется операциями)
  async saveMaterial(m) {
    const data = { ...m }; delete data._docId; delete data.stock;
    if (m._docId) { await COL.materials.doc(m._docId).set(data, { merge: true }); return m._docId; }
    data.stock = 0; data.avgCost = 0;
    const ref = await COL.materials.add(data);
    return ref.id;
  },
  async deleteMaterial(docId) {
    await COL.materials.doc(String(docId)).delete();
  },

  // ---------- ЗАГРУЗКА СТАРТОВЫХ ОСТАТКОВ ----------
  // plan.products: [{ id, data? (для новой карточки), stock:{size:qty}, price:{size:price} }]
  // plan.materials: [{ docId? , name, kind, size?, stock }]
  async applyImport(plan, fileName, onProgress) {
    const ops = [];
    plan.products.forEach(p => {
      const ref = COL.products.doc(String(p.id));
      const data = { ...(p.data || {}), stock: p.stock };
      if (p.price && Object.keys(p.price).length) data.price = p.price;
      ops.push(b => b.set(ref, data, { merge: true }));
    });
    plan.materials.forEach(m => {
      const ref = m.docId ? COL.materials.doc(m.docId) : COL.materials.doc();
      const data = { name: m.name, kind: m.kind, stock: m.stock };
      if (m.size) data.size = m.size;
      if (!m.docId) data.avgCost = 0;
      ops.push(b => b.set(ref, data, { merge: true }));
    });
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(f => f(batch));
      await batch.commit();
      if (onProgress) onProgress(Math.min(i + 400, ops.length), ops.length);
    }
    await COL.moves.add({
      type: 'start', effects: [], form: {}, author: currentUserEmail(), createdAt: FV.serverTimestamp(),
      summary: 'Стартовые остатки из файла ' + (fileName || '') + ': растений ' + plan.products.length + ', сырья ' + plan.materials.length
    });
  },

  // ---------- ОБНУЛЕНИЕ БАЗЫ ----------
  // Удаляет операции, продажи, клиентов, расходы, сырьё.
  // Карточки растений остаются, но их остатки, цены и себестоимость обнуляются.
  async resetAll(onProgress) {
    const cols = [['операции', COL.moves], ['продажи', COL.orders], ['клиенты', COL.customers],
                  ['расходы', COL.expenses], ['сырьё', COL.materials]];
    for (const [label, col] of cols) {
      while (true) {
        const snap = await col.limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        if (onProgress) onProgress('Удаляю ' + label + '...');
      }
    }
    const prods = await COL.products.get();
    for (let i = 0; i < prods.docs.length; i += 400) {
      const batch = db.batch();
      prods.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { stock: {}, price: {}, cost: {} }));
      await batch.commit();
      if (onProgress) onProgress('Обнуляю карточки: ' + Math.min(i + 400, prods.docs.length) + ' из ' + prods.docs.length);
    }
  }
};

window.DB = DB;
window.SIZES = SIZES; window.SIZE = SIZE; window.sizesOf = sizesOf;
window._fb = { db, COL };

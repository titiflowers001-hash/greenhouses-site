// ============================================================
//  Слой работы с базой Firebase (общий для сайта и админки)
//  Ничего менять не нужно — настройки в firebase-config.js
// ============================================================

firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

// Коллекции (таблицы) в базе
const COL = {
  products:  db.collection('products'),   // товары + остатки
  orders:    db.collection('orders'),     // заказы
  customers: db.collection('customers'),  // клиенты
  expenses:  db.collection('expenses'),   // расходы бизнеса
  moves:     db.collection('stock_moves'),// приход / списание товара
  materials: db.collection('materials')   // сырьё (земля, горшки, удобрения, черенки, семена)
};

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

  async saveProduct(product) {
    const id = String(product.id);
    await COL.products.doc(id).set(product, { merge: true });
    return id;
  },

  async deleteProduct(id) {
    await COL.products.doc(String(id)).delete();
  },

  async setStock(id, size, qty) {
    await COL.products.doc(String(id)).update({ ['stock.' + size]: Math.max(0, qty) });
  },

  async setActive(id, active) {
    await COL.products.doc(String(id)).update({ active: !!active });
  },

  // ---------- ЗАКАЗЫ ----------
  // items: [{ plantId, name, size, qty, price }]
  // Покупатель на сайте только ОСТАВЛЯЕТ заявку. Склад не трогается —
  // товары спишутся позже, когда админ нажмёт «Подтвердить» (confirmOrder).
  async createOrder(order, items) {
    const orderRef = COL.orders.doc();
    await orderRef.set({
      ...order,
      items,
      status: 'new',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return orderRef.id;
  },

  // Подтверждение заказа АДМИНОМ: вот теперь списываем склад, заносим
  // клиента и пишем движения. По правилам базы это может сделать только
  // вошедший администратор.
  async confirmOrder(docId) {
    const orderRef = COL.orders.doc(docId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new Error('Заказ не найден');
    const order = orderSnap.data();
    if (order.status === 'done') return docId;      // уже подтверждён
    const items = order.items || [];

    // Транзакция: проверяем остатки и списываем их атомарно
    await db.runTransaction(async tx => {
      const refs = items.map(it => COL.products.doc(String(it.plantId)));
      const snaps = await Promise.all(refs.map(r => tx.get(r)));

      // 1) Проверка наличия
      snaps.forEach((snap, i) => {
        const it = items[i];
        if (!snap.exists) throw new Error(`Товар «${it.name}» больше не в базе`);
        const have = (snap.data().stock || {})[it.size] ?? 0;
        if (have < it.qty) {
          throw new Error(`«${it.name}» — в наличии только ${have} шт, а в заказе ${it.qty}`);
        }
      });

      // 2) Списание
      snaps.forEach((snap, i) => {
        const it = items[i];
        const have = (snap.data().stock || {})[it.size] ?? 0;
        tx.update(refs[i], { ['stock.' + it.size]: have - it.qty });
      });

      // 3) Отмечаем заказ выполненным
      tx.update(orderRef, {
        status: 'done',
        confirmedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    // Клиент в базу контактов
    if (order.phone) await DB.upsertCustomer(order, items);

    // Движения склада (история списаний)
    for (const it of items) {
      await COL.moves.add({
        type: 'sale', plantId: it.plantId, name: it.name, size: it.size,
        qty: -it.qty, note: 'Заказ ' + (order.name || ''),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    return docId;
  },

  async getOrders(limit) {
    const snap = await COL.orders.orderBy('createdAt', 'desc').limit(limit || 300).get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  async setOrderStatus(docId, status) {
    await COL.orders.doc(docId).update({ status });
  },

  async deleteOrder(docId) {
    await COL.orders.doc(docId).delete();
  },

  // ---------- КЛИЕНТЫ ----------
  async upsertCustomer(order, items) {
    const phone = String(order.phone).replace(/\D/g, '');
    if (!phone) return;
    const ref = COL.customers.doc(phone);
    const snap = await ref.get();
    const sum = items.reduce((s, it) => s + it.qty * it.price, 0);
    if (snap.exists) {
      const d = snap.data();
      await ref.update({
        name: order.name || d.name,
        email: order.email || d.email || '',
        address: order.address || d.address || '',
        ordersCount: (d.ordersCount || 0) + 1,
        totalSpent: (d.totalSpent || 0) + sum,
        lastOrderAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await ref.set({
        phone, name: order.name || '', email: order.email || '',
        address: order.address || '', ordersCount: 1, totalSpent: sum,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastOrderAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  },

  async getCustomers() {
    const snap = await COL.customers.orderBy('totalSpent', 'desc').get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  // ---------- РАСХОДЫ ----------
  async addExpense(exp) {
    await COL.expenses.add({ ...exp, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  },
  async getExpenses() {
    const snap = await COL.expenses.orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },
  async deleteExpense(docId) {
    await COL.expenses.doc(docId).delete();
  },

  // ---------- СЫРЬЁ (материалы) ----------
  async getMaterials() {
    const snap = await COL.materials.get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },
  watchMaterials(cb) {
    return COL.materials.onSnapshot(snap => cb(snap.docs.map(d => ({ ...d.data(), _docId: d.id }))));
  },
  // Создание/редактирование сырья. _docId есть → правим, нет → создаём.
  async saveMaterial(m) {
    const data = { ...m }; delete data._docId;
    if (m._docId) { await COL.materials.doc(m._docId).set(data, { merge: true }); return m._docId; }
    if (data.stock == null) data.stock = 0;
    if (data.avgCost == null) data.avgCost = 0;
    const ref = await COL.materials.add(data);
    return ref.id;
  },
  async deleteMaterial(docId) {
    await COL.materials.doc(String(docId)).delete();
  },
  // Приход сырья: пополняем остаток, пересчитываем среднюю цену
  // (сумма закупа ÷ количество, усредняя с уже имеющимся) и пишем расход.
  async receiveMaterial(docId, qty, totalCost, note) {
    const ref = COL.materials.doc(String(docId));
    const pre = await ref.get();
    if (!pre.exists) throw new Error('Сырьё не найдено в базе');
    const m0 = pre.data();
    const addQty = Number(qty) || 0;
    const addCost = Number(totalCost) || 0;
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const m = snap.data();
      const have = m.stock || 0, avg = m.avgCost || 0;
      const newStock = have + addQty;
      const newAvg = newStock > 0 ? (have * avg + addCost) / newStock : 0;
      tx.update(ref, { stock: newStock, avgCost: Math.round(newAvg) });
    });
    const catByKind = { soil:'Земля', fertilizer:'Удобрения', pot:'Горшки', cutting:'Покупной черенок', seed:'Покупные семена' };
    if (addCost > 0) {
      await COL.expenses.add({
        cat: catByKind[m0.kind] || 'Закуп сырья',
        sum: addCost,
        date: new Date().toISOString().slice(0, 10),
        note: (note ? note + ' · ' : 'Приход · ') + (m0.name || ''),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    return docId;
  },

  // ---------- ПРИХОД / СПИСАНИЕ ТОВАРА ----------
  // type: 'income' (приход) | 'writeoff' (списание брака/потерь)
  async addStockMove(move) {
    const ref = COL.products.doc(String(move.plantId));
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Товар не найден в базе');
      const have = (snap.data().stock || {})[move.size] ?? 0;
      const next = Math.max(0, have + move.qty); // qty: + приход, − списание
      tx.update(ref, { ['stock.' + move.size]: next });
    });
    await COL.moves.add({ ...move, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  },

  async getMoves(limit) {
    const snap = await COL.moves.orderBy('createdAt', 'desc').limit(limit || 300).get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  // ---------- ПЕРВОНАЧАЛЬНАЯ ЗАГРУЗКА ТОВАРОВ ----------
  async importProducts(list, onProgress) {
    let done = 0;
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      list.slice(i, i + 400).forEach(p => {
        batch.set(COL.products.doc(String(p.id)), {
          stock: { a1: 0, a2: 0, a3: 0 }, active: true, desc: '', ...p
        }, { merge: true });
      });
      await batch.commit();
      done = Math.min(i + 400, list.length);
      if (onProgress) onProgress(done, list.length);
    }
    return done;
  }
};

window.DB = DB;
window._fb = { db, COL };

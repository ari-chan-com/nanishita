// IndexedDB アクセス層。画面側はこの DB オブジェクトだけを使う。
const DB = (() => {
  'use strict';

  const NAME = 'nanishita';
  const VERSION = 2; // v2：家族（people）とできごと（events）を追加
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('categories')) {
            db.createObjectStore('categories', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('records')) {
            const store = db.createObjectStore('records', { keyPath: 'id' });
            store.createIndex('categoryId', 'categoryId');
            store.createIndex('datetime', 'datetime');
          }
          if (!db.objectStoreNames.contains('people')) {
            db.createObjectStore('people', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('events')) {
            db.createObjectStore('events', { keyPath: 'id' }).createIndex('date', 'date');
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // 別のタブで新しい版のアプリが開かれたら、作り替えを邪魔しないよう閉じる
          db.onversionchange = () => db.close();
          resolve(db);
        };
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function store(name, mode = 'readonly') {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  // crypto.randomUUID は https / localhost でしか使えないため予備を用意する
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---- categories ----

  // 削除済み（カテゴリだけ削除）は除外して返す
  async function listCategories() {
    const all = await wrap((await store('categories')).getAll());
    return all
      .filter(c => !c.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // 「カテゴリだけ削除」したものも含めた { id: category }（全履歴でカテゴリ名を出すため）
  async function getCategoryMap() {
    const all = await wrap((await store('categories')).getAll());
    return Object.fromEntries(all.map(c => [c.id, c]));
  }

  async function getCategory(id) {
    return wrap((await store('categories')).get(id));
  }

  async function addCategory(name) {
    const all = await wrap((await store('categories')).getAll());
    const maxOrder = all.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const now = Date.now();
    const category = {
      id: newId(),
      name,
      createdAt: now,
      updatedAt: now,
      sortOrder: maxOrder + 1,
    };
    await wrap((await store('categories', 'readwrite')).add(category));
    return category;
  }

  async function renameCategory(id, name) {
    const s = await store('categories', 'readwrite');
    const category = await wrap(s.get(id));
    if (!category) return;
    category.name = name;
    category.updatedAt = Date.now();
    await wrap(s.put(category));
  }

  // ---- records ----

  // date: 'YYYY-MM-DD', time: 'HH:MM'。datetime は並べ替え用のミリ秒
  async function addRecord(categoryId, { date, time, memo = '' }) {
    const now = Date.now();
    const record = {
      id: newId(),
      categoryId,
      date,
      time,
      datetime: new Date(`${date}T${time}`).getTime(),
      memo,
      createdAt: now,
      updatedAt: now,
    };
    await wrap((await store('records', 'readwrite')).add(record));
    return record;
  }

  async function getRecord(id) {
    return wrap((await store('records')).get(id));
  }

  async function updateRecord(id, { date, time, memo = '' }) {
    const s = await store('records', 'readwrite');
    const record = await wrap(s.get(id));
    if (!record) return null;
    Object.assign(record, {
      date,
      time,
      datetime: new Date(`${date}T${time}`).getTime(),
      memo,
      updatedAt: Date.now(),
    });
    await wrap(s.put(record));
    return record;
  }

  async function deleteRecord(id) {
    await wrap((await store('records', 'readwrite')).delete(id));
  }

  // カテゴリIDごとの最新の記録 { categoryId: record }
  async function getLastRecords() {
    const index = (await store('records')).index('datetime');
    const last = {};
    return new Promise((resolve, reject) => {
      const req = index.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(last);
        const r = cursor.value;
        if (!last[r.categoryId]) last[r.categoryId] = r;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // 全カテゴリの全記録。新しい順
  async function getAllRecords() {
    const index = (await store('records')).index('datetime');
    return (await wrap(index.getAll())).reverse();
  }

  // カテゴリIDごとの、記録を最後に追加・編集した時刻 { categoryId: ミリ秒 }（「更新した順」用）
  async function getRecordTouchedTimes() {
    const all = await wrap((await store('records')).getAll());
    const times = {};
    for (const r of all) {
      const t = Math.max(r.createdAt || 0, r.updatedAt || 0);
      if (!(times[r.categoryId] >= t)) times[r.categoryId] = t;
    }
    return times;
  }

  // あるカテゴリの全記録。新しい順
  async function getRecordsOfCategory(categoryId) {
    const index = (await store('records')).index('categoryId');
    const all = await wrap(index.getAll(categoryId));
    return all.sort((a, b) => b.datetime - a.datetime);
  }

  // あるカテゴリの指定日（'YYYY-MM-DD'）の記録。新しい順
  async function getRecordsOfDay(categoryId, date) {
    return (await getRecordsOfCategory(categoryId)).filter(r => r.date === date);
  }

  // ids の順に sortOrder を振り直す
  async function reorderCategories(ids) {
    const db = await open();
    const tx = db.transaction('categories', 'readwrite');
    const s = tx.objectStore('categories');
    const all = await wrap(s.getAll());
    const byId = Object.fromEntries(all.map(c => [c.id, c]));
    ids.forEach((id, i) => {
      const c = byId[id];
      if (c) {
        c.sortOrder = i + 1;
        s.put(c);
      }
    });
    await done(tx);
  }

  async function countRecords(categoryId) {
    const index = (await store('records')).index('categoryId');
    return wrap(index.count(categoryId));
  }

  // withRecords=true: カテゴリと記録を両方削除
  // withRecords=false: カテゴリを一覧から消し、記録は全履歴に残す（deletedAt を付ける）
  async function deleteCategory(id, withRecords) {
    const db = await open();
    const tx = db.transaction(['categories', 'records'], 'readwrite');
    const cats = tx.objectStore('categories');
    const recs = tx.objectStore('records');
    const keys = await wrap(recs.index('categoryId').getAllKeys(id));

    if (withRecords || keys.length === 0) {
      cats.delete(id);
      keys.forEach(k => recs.delete(k));
    } else {
      const category = await wrap(cats.get(id));
      if (category) {
        category.deletedAt = Date.now();
        category.updatedAt = category.deletedAt;
        cats.put(category);
      }
    }
    await done(tx);
  }

  // ---- 家族 ----

  // 削除済みは除外。追加した順
  async function listPeople() {
    const all = await wrap((await store('people')).getAll());
    return all.filter(p => !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // 削除済みも含めた { id: person }（できごとに名前を出すため）
  async function getPeopleMap() {
    const all = await wrap((await store('people')).getAll());
    return Object.fromEntries(all.map(p => [p.id, p]));
  }

  async function addPerson(name) {
    const all = await wrap((await store('people')).getAll());
    const maxOrder = all.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    const now = Date.now();
    const person = { id: newId(), name, createdAt: now, updatedAt: now, sortOrder: maxOrder + 1 };
    await wrap((await store('people', 'readwrite')).add(person));
    return person;
  }

  async function renamePerson(id, name) {
    const s = await store('people', 'readwrite');
    const person = await wrap(s.get(id));
    if (!person) return;
    person.name = name;
    person.updatedAt = Date.now();
    await wrap(s.put(person));
  }

  async function countEventsOfPerson(personId) {
    const all = await wrap((await store('events')).getAll());
    return all.filter(e => e.personId === personId).length;
  }

  // できごとがあれば deletedAt を付けて選択肢から隠す（できごとは「削除済み」付きで残す）。なければ完全に削除
  async function deletePerson(id) {
    const db = await open();
    const tx = db.transaction(['people', 'events'], 'readwrite');
    const people = tx.objectStore('people');
    const events = await wrap(tx.objectStore('events').getAll());
    if (events.some(e => e.personId === id)) {
      const person = await wrap(people.get(id));
      if (person) {
        person.deletedAt = person.updatedAt = Date.now();
        people.put(person);
      }
    } else {
      people.delete(id);
    }
    await done(tx);
  }

  // ---- できごと ----
  // personId は家族の id か、家族みんなを表す 'family'

  // ある年のできごと。古い順（同じ日は登録順）
  async function listEventsOfYear(year) {
    const index = (await store('events')).index('date');
    const all = await wrap(index.getAll(IDBKeyRange.bound(`${year}-01-01`, `${year}-12-31`)));
    return all.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  }

  // すべてのできごと。古い順（検索用）
  async function listAllEvents() {
    const all = await wrap((await store('events')).getAll());
    return all.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  }

  async function addEvent({ date, personId, text }) {
    const now = Date.now();
    const event = { id: newId(), date, personId, text, createdAt: now, updatedAt: now };
    await wrap((await store('events', 'readwrite')).add(event));
    return event;
  }

  async function updateEvent(id, { date, personId, text }) {
    const s = await store('events', 'readwrite');
    const event = await wrap(s.get(id));
    if (!event) return null;
    Object.assign(event, { date, personId, text, updatedAt: Date.now() });
    await wrap(s.put(event));
    return event;
  }

  async function deleteEvent(id) {
    await wrap((await store('events', 'readwrite')).delete(id));
  }

  // ---- バックアップ・全削除 ----

  const ALL_STORES = ['categories', 'records', 'people', 'events'];

  async function exportAll() {
    const db = await open();
    const tx = db.transaction(ALL_STORES);
    const [categories, records, people, events] = await Promise.all(
      ALL_STORES.map(name => wrap(tx.objectStore(name).getAll()))
    );
    return { categories, records, people, events };
  }

  // 今のデータをすべて消して置き換える（1つのトランザクションなので途中で失敗したら元のまま）
  async function replaceAll(data) {
    const db = await open();
    const tx = db.transaction(ALL_STORES, 'readwrite');
    for (const name of ALL_STORES) {
      const s = tx.objectStore(name);
      s.clear();
      (data[name] || []).forEach(item => s.put(item));
    }
    await done(tx);
  }

  async function clearAll() {
    await replaceAll({});
  }

  return {
    exportAll,
    replaceAll,
    clearAll,
    listCategories,
    getCategoryMap,
    getCategory,
    addCategory,
    renameCategory,
    reorderCategories,
    deleteCategory,
    addRecord,
    getRecord,
    updateRecord,
    deleteRecord,
    getLastRecords,
    getAllRecords,
    getRecordTouchedTimes,
    getRecordsOfCategory,
    getRecordsOfDay,
    countRecords,
    listPeople,
    getPeopleMap,
    addPerson,
    renamePerson,
    countEventsOfPerson,
    deletePerson,
    listEventsOfYear,
    listAllEvents,
    addEvent,
    updateEvent,
    deleteEvent,
  };
})();

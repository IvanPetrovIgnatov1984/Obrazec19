const DB_NAME = 'obrazec19';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sites')) {
        db.createObjectStore('sites', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('positions')) {
        const s = db.createObjectStore('positions', { keyPath: 'id' });
        s.createIndex('siteId', 'siteId');
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('siteId', 'siteId');
        s.createIndex('positionId', 'positionId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('entryId', 'entryId');
      }
      if (!db.objectStoreNames.contains('signatures')) {
        const s = db.createObjectStore('signatures', { keyPath: 'id' });
        s.createIndex('siteId', 'siteId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('acts')) {
        const s = db.createObjectStore('acts', { keyPath: 'id' });
        s.createIndex('siteId', 'siteId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onblocked = () => {
      // Друг отворен таб/прозорец държи старата версия на базата.
      alert('Образец 19 е отворен в друг таб или прозорец. Затвори останалите и опитай пак.');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// ВАЖНО: транзакцията и заявките ѝ трябва да се създадат в една и съща задача.
// Ако между тях има await, транзакцията вече е неактивна — Chrome го прощава,
// Safari на iPhone хвърля TransactionInactiveError и записът пропада мълчаливо.
// Затова всичко се прави синхронно вътре в run(), а промисът се решава на
// tx.oncomplete, т.е. едва след като данните са наистина записани.
function run(storeNames, mode, work) {
  return openDb().then(
    (database) =>
      new Promise((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        let tx;
        try {
          tx = database.transaction(names, mode);
        } catch (err) {
          reject(err);
          return;
        }
        let result;
        try {
          result = work(
            names.length === 1 ? tx.objectStore(names[0]) : names.map((n) => tx.objectStore(n)),
            tx
          );
        } catch (err) {
          try { tx.abort(); } catch (e) { /* вече е прекратена */ }
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Транзакцията е прекратена'));
      })
  );
}

// Обвивка, която пази резултата на заявката до края на транзакцията.
function capture(request) {
  const box = { value: undefined };
  request.onsuccess = () => {
    box.value = request.result;
  };
  return box;
}

export const db = {
  // Всеки запис носи кога е променен — оттам се разбира коя версия е по-новата
  // при сверяване между устройства и при връщане от резервно копие.
  put(storeName, value) {
    const stamped = { ...value, updatedAt: Date.now() };
    return run(storeName, 'readwrite', (store) => {
      store.put(stamped);
      return { value: stamped };
    });
  },
  // Записва както е — ползва се при връщане от файл, за да се запази
  // оригиналното време на промяна.
  putRaw(storeName, value) {
    return run(storeName, 'readwrite', (store) => {
      store.put(value);
      return { value };
    });
  },
  putMany(storeName, values) {
    return run(storeName, 'readwrite', (store) => {
      for (const v of values) store.put(v);
      return { value: values };
    });
  },
  get(storeName, id) {
    return run(storeName, 'readonly', (store) => capture(store.get(id)));
  },
  getAll(storeName) {
    return run(storeName, 'readonly', (store) => capture(store.getAll()));
  },
  getAllByIndex(storeName, indexName, value) {
    return run(storeName, 'readonly', (store) => capture(store.index(indexName).getAll(value)));
  },
  delete(storeName, id) {
    return run(storeName, 'readwrite', (store) => {
      store.delete(id);
      return { value: undefined };
    });
  },
  // Имената на хранилищата — ползват се от резервното копие и по-късно от сверяването.
  stores() {
    return ['sites', 'positions', 'entries', 'photos', 'acts', 'settings'];
  },
  deleteByIndex(storeName, indexName, value) {
    return run(storeName, 'readwrite', (store) => {
      // Курсорът върви в рамките на същата транзакция — без await по средата.
      const req = store.index(indexName).openKeyCursor(IDBKeyRange.only(value));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      return { value: undefined };
    });
  },
};

export async function deletePositionCascade(positionId) {
  const entries = await db.getAllByIndex('entries', 'positionId', positionId);
  for (const e of entries) {
    await db.deleteByIndex('photos', 'entryId', e.id);
  }
  await db.deleteByIndex('entries', 'positionId', positionId);
  await db.delete('positions', positionId);
}

export async function deleteSiteCascade(siteId) {
  const entries = await db.getAllByIndex('entries', 'siteId', siteId);
  for (const e of entries) {
    await db.deleteByIndex('photos', 'entryId', e.id);
  }
  await db.deleteByIndex('entries', 'siteId', siteId);
  await db.deleteByIndex('positions', 'siteId', siteId);
  await db.deleteByIndex('signatures', 'siteId', siteId);
  await db.deleteByIndex('acts', 'siteId', siteId);
  await db.delete('sites', siteId);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Изнасяне и връщане на всички данни в един файл.
// Ползва се за архив, за прехвърляне на друго устройство, и по-късно
// като основа на сверяването със сървър.
import { db } from '../db.js';
import { downloadBlob, shareOrDownload, fmtNum } from './util.js';

const FORMAT = 'obrazec19-backup';
const FORMAT_VERSION = 1;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

// Събира всичко от базата. Снимките стават текст, за да се поберат в един файл.
export async function collectAll() {
  const data = {};
  let photoCount = 0;
  for (const store of db.stores()) {
    const rows = await db.getAll(store);
    if (store === 'photos') {
      data[store] = [];
      for (const row of rows) {
        const { blob, ...rest } = row;
        data[store].push({ ...rest, blobDataUrl: blob ? await blobToDataUrl(blob) : null });
        photoCount++;
      }
    } else {
      data[store] = rows;
    }
  }
  return { data, photoCount };
}

export async function buildBackup() {
  const { data, photoCount } = await collectAll();
  const payload = {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    filename: `obrazec19-arhiv-${stamp}.json`,
    counts: payload.counts,
    photoCount,
    sizeKb: Math.round(blob.size / 1024),
  };
}

export async function exportBackup({ share = false } = {}) {
  const { blob, filename, counts, sizeKb } = await buildBackup();
  const text = `Архив на Образец 19 от ${new Date().toLocaleDateString('bg-BG')} — ${counts.sites} обекта, ${counts.entries} отчитания, ${counts.acts} акта.`;
  if (share) {
    await shareOrDownload(blob, filename, { title: 'Архив на Образец 19', text });
  } else {
    downloadBlob(blob, filename);
  }
  return { counts, sizeKb };
}

function isNewer(incoming, existing) {
  if (!existing) return true;
  const a = Number(incoming && incoming.updatedAt) || 0;
  const b = Number(existing && existing.updatedAt) || 0;
  // При равни времена се предпочита вече наличното — връщането не бива да разваля.
  return a > b;
}

// Връща данните от файл. Слива по номер на запис: печели по-новата промяна.
export async function importBackup(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error('Файлът не е валиден архив (не е четим).');
  }
  if (!payload || payload.format !== FORMAT || !payload.data) {
    throw new Error('Файлът не е архив на Образец 19.');
  }
  if (Number(payload.version) > FORMAT_VERSION) {
    throw new Error('Архивът е от по-нова версия на приложението. Обнови приложението и опитай пак.');
  }

  const report = { added: 0, updated: 0, skipped: 0 };
  for (const store of db.stores()) {
    const rows = payload.data[store];
    if (!Array.isArray(rows)) continue;
    const key = store === 'settings' ? 'key' : 'id';
    const existing = await db.getAll(store);
    const byKey = new Map(existing.map((r) => [r[key], r]));

    for (const row of rows) {
      const current = byKey.get(row[key]);
      if (!isNewer(row, current)) {
        report.skipped++;
        continue;
      }
      let toStore = row;
      if (store === 'photos') {
        const { blobDataUrl, ...rest } = row;
        toStore = { ...rest, blob: blobDataUrl ? await dataUrlToBlob(blobDataUrl) : null };
      }
      await db.putRaw(store, toStore);
      if (current) report.updated++;
      else report.added++;
    }
  }
  return report;
}

export function describeCounts(counts) {
  const parts = [];
  if (counts.sites) parts.push(`${fmtNum(counts.sites)} обекта`);
  if (counts.positions) parts.push(`${fmtNum(counts.positions)} позиции`);
  if (counts.entries) parts.push(`${fmtNum(counts.entries)} отчитания`);
  if (counts.acts) parts.push(`${fmtNum(counts.acts)} акта`);
  if (counts.photos) parts.push(`${fmtNum(counts.photos)} снимки`);
  return parts.join(' · ') || 'няма данни';
}

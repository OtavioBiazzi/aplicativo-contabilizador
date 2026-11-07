// 0.4.18: ao atualizar, a planilha automatica e desligada uma unica vez; depois a escolha do usuario vale.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LedgerStore } from '../dist-electron/electron/storage.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'caixa-migration-'));
const dataDirectory = path.join(root, 'data');
const defaultOutputDirectory = path.join(root, 'files');
await mkdir(dataDirectory, { recursive: true });
const settingsFile = path.join(dataDirectory, 'settings.json');
const open = async () => { const store = new LedgerStore({ dataDirectory, defaultOutputDirectory }); await store.initialize(); return store; };

// Instalacao antiga (0.4.17) com a planilha ligada e outras configuracoes.
await writeFile(settingsFile, JSON.stringify({ automaticSpreadsheetEnabled: true, businessName: 'Bar do Tio', defaultPeople: 3 }), 'utf8');
let store = await open();
let settings = await store.getSettings();
assert.equal(settings.automaticSpreadsheetEnabled, false, 'Atualizacao desliga a planilha automatica');
assert.equal(settings.defaultPeople, 3, 'Demais configuracoes preservadas');
const saved = JSON.parse(await readFile(settingsFile, 'utf8'));
assert.equal(saved.automaticSpreadsheetEnabled, false);
assert.equal(saved.businessName, 'Bar do Tio');
assert.deepEqual(JSON.parse(await readFile(path.join(dataDirectory, 'migrations.json'), 'utf8')), ['0.4.18-planilha-manual', '0.4.22-planilha-manual']);

// Usuario religa: proximas aberturas respeitam.
await store.saveSettings({ ...settings, automaticSpreadsheetEnabled: true });
for (let i = 0; i < 2; i += 1) {
  store = await open();
  assert.equal((await store.getSettings()).automaticSpreadsheetEnabled, true, 'Escolha do usuario respeitada depois da migracao');
}

// Quem ja passou pela 0.4.18 e religou: ao atualizar para a 0.4.22 desliga uma vez, depois respeita.
const r2 = await mkdtemp(path.join(os.tmpdir(), 'caixa-0422-'));
await mkdir(path.join(r2, 'data'), { recursive: true });
await writeFile(path.join(r2, 'data', 'settings.json'), JSON.stringify({ automaticSpreadsheetEnabled: true, defaultPeople: 2 }), 'utf8');
await writeFile(path.join(r2, 'data', 'migrations.json'), JSON.stringify(['0.4.18-planilha-manual']), 'utf8');
const open2 = async () => { const s = new LedgerStore({ dataDirectory: path.join(r2, 'data'), defaultOutputDirectory: path.join(r2, 'files') }); await s.initialize(); return s; };
let s2 = await open2();
let st2 = await s2.getSettings();
assert.equal(st2.automaticSpreadsheetEnabled, false, '0.4.22 desliga de novo quem ja tinha religado');
assert.equal(st2.defaultPeople, 2);
await s2.saveSettings({ ...st2, automaticSpreadsheetEnabled: true });
s2 = await open2();
assert.equal((await s2.getSettings()).automaticSpreadsheetEnabled, true, 'Depois da 0.4.22 a escolha volta a valer');
await rm(r2, { recursive: true, force: true });

// Instalacao nova: padrao desligado.
const fresh = await mkdtemp(path.join(os.tmpdir(), 'caixa-fresh-'));
const freshStore = new LedgerStore({ dataDirectory: path.join(fresh, 'data'), defaultOutputDirectory: path.join(fresh, 'files') });
await freshStore.initialize();
assert.equal((await freshStore.getSettings()).automaticSpreadsheetEnabled, false, 'Instalacao nova vem desligada');

await rm(root, { recursive: true, force: true });
await rm(fresh, { recursive: true, force: true });
console.log('PASS spreadsheet migration: update to 0.4.22 turns it off once (also after 0.4.18), user choice kept afterwards, fresh install off');

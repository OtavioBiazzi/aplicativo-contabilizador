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
assert.deepEqual(JSON.parse(await readFile(path.join(dataDirectory, 'migrations.json'), 'utf8')), ['0.4.18-planilha-manual']);

// Usuario religa: proximas aberturas respeitam.
await store.saveSettings({ ...settings, automaticSpreadsheetEnabled: true });
for (let i = 0; i < 2; i += 1) {
  store = await open();
  assert.equal((await store.getSettings()).automaticSpreadsheetEnabled, true, 'Escolha do usuario respeitada depois da migracao');
}

// Instalacao nova: padrao desligado.
const fresh = await mkdtemp(path.join(os.tmpdir(), 'caixa-fresh-'));
const freshStore = new LedgerStore({ dataDirectory: path.join(fresh, 'data'), defaultOutputDirectory: path.join(fresh, 'files') });
await freshStore.initialize();
assert.equal((await freshStore.getSettings()).automaticSpreadsheetEnabled, false, 'Instalacao nova vem desligada');

await rm(root, { recursive: true, force: true });
await rm(fresh, { recursive: true, force: true });
console.log('PASS spreadsheet migration: update turns it off once, user choice kept afterwards, fresh install off');

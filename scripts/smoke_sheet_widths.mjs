import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { writeTableXlsx } from '../dist-electron/electron/pdvExporter.js';
import { autoColumnWidth } from '../dist-electron/electron/sheetColumnWidth.js';

const longName = 'PORCAO DE CALABRESA ACEBOLADA COM PAO E MOLHO DA CASA';
const directory = await mkdtemp(path.join(os.tmpdir(), 'caixa-sheet-'));
const file = path.join(directory, 'produtos.xlsx');
await writeTableXlsx(file, 'Produtos', ['Produto', 'Categoria', 'Quantidade', 'Faturamento'], [
  [longName, 'Porcoes', '12', 1234.5],
  ['CAFE', 'Bebidas', '3', 15]
]);
const zip = await JSZip.loadAsync(await readFile(file));
const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
const widths = [...sheet.matchAll(/<col min="(\d+)" max="\d+" width="([\d.]+)"/g)].map((match) => Number(match[2]));
assert.equal(widths.length, 4);
assert.ok(widths[0] >= longName.length, `Produto deveria caber: largura ${widths[0]} para ${longName.length} caracteres`);
assert.ok(widths[2] < 20, 'Quantidade continua estreita');
assert.ok(sheet.includes(longName) && sheet.includes('<v>1234.5</v>'), 'Conteudo e numeros preservados');
const workbook = await zip.file('xl/workbook.xml').async('string');
assert.ok(workbook.includes('name="Produtos"'));
assert.equal(autoColumnWidth('Valor', [{ Valor: 1234567.89 }], true) >= 'R$ 1.234.567,89'.length, true);
assert.equal(autoColumnWidth('Obs', [{ Obs: 'x'.repeat(500) }]), 70, 'Limite maximo de largura');
await rm(directory, { recursive: true, force: true });
console.log(`PASS sheet widths: product column ${widths[0]} for ${longName.length} chars; money and max width handled`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseCsvLine,
  toNumber,
  parseTradeDate,
  ensureRequiredColumns,
  parseRecords,
  sortRecords,
  calculateProfitLossForRecords,
  buildOutputCsv,
  calculateProfitLossCsv,
  runFileCalculation,
} = require('./calculate_pl');

const baseHeader = [
  'Account Number',
  'Account Name',
  'AsxCode',
  'Confirmation Number',
  'Order Type',
  'As at Date',
  'Trade Date',
  'Settlement Date',
  'Avg Price',
  'Exch Rate',
  'Price',
  'Quantity',
  'Brokerage',
  'GST',
  'Stampduty',
  'Application Fee',
  'OtherCharge',
  'Fee',
  'Discount',
  'Consideration',
  'Reverse Confirmation Number',
].join(',');

function buildRow(fields) {
  return [
    fields.accountNumber ?? '722178',
    fields.accountName ?? 'MR TEST',
    fields.asxCode ?? '',
    fields.confirmationNumber ?? '',
    fields.orderType ?? '',
    fields.asAtDate ?? '',
    fields.tradeDate ?? '',
    fields.settlementDate ?? '',
    fields.avgPrice ?? '',
    fields.exchRate ?? '1.000000',
    fields.price ?? '',
    fields.quantity ?? '',
    fields.brokerage ?? '0.00',
    fields.gst ?? '0.00',
    fields.stampduty ?? '0.00',
    fields.applicationFee ?? '0.00',
    fields.otherCharge ?? '0.00',
    fields.fee ?? '0.00',
    fields.discount ?? '0.00',
    fields.consideration ?? '0.00',
    fields.reverseConfirmationNumber ?? '0',
  ].join(',');
}

test('parseCsvLine splits on commas', () => {
  const line = 'a,b,c';
  assert.deepEqual(parseCsvLine(line), ['a', 'b', 'c']);
});

test('toNumber parses numeric strings and trims quotes and spaces', () => {
  assert.equal(toNumber('"10.50 "'), 10.5);
  assert.equal(toNumber(' 0 '), 0);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
});

test('toNumber throws on invalid numeric input', () => {
  assert.throws(() => toNumber('abc'), /Unable to parse numeric value/);
});

test('parseTradeDate parses valid dates and rejects invalid ones', () => {
  const date = parseTradeDate('2024-01-02');
  assert.equal(date.getFullYear(), 2024);
  assert.throws(() => parseTradeDate('not-a-date'), /Invalid Trade Date/);
});

test('ensureRequiredColumns returns indices and validates presence', () => {
  const headerCols = baseHeader.split(',');
  const info = ensureRequiredColumns(headerCols);
  assert.equal(info.asxIdx, headerCols.indexOf('AsxCode'));
  assert.equal(info.orderTypeIdx, headerCols.indexOf('Order Type'));
  assert.equal(info.tradeDateIdx, headerCols.indexOf('Trade Date'));
  assert.equal(info.avgPriceIdx, headerCols.indexOf('Avg Price'));
  assert.equal(info.qtyIdx, headerCols.indexOf('Quantity'));
});

test('ensureRequiredColumns throws when required columns are missing', () => {
  const headerCols = ['AsxCode', 'Order Type', 'Avg Price', 'Quantity'];
  assert.throws(() => ensureRequiredColumns(headerCols), /Missing required columns/);
});

test('parseRecords parses lines into structured records', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);
  const line = buildRow({
    asxCode: 'ABC',
    orderType: 'Buy',
    tradeDate: '2024-01-02',
    avgPrice: '"10.00 "',
    quantity: '5',
  });
  const records = parseRecords([line], columnInfo);
  const record = records[0];
  assert.equal(record.asxCode, 'ABC');
  assert.equal(record.orderType, 'Buy');
  assert.equal(record.avgPrice, 10);
  assert.equal(record.quantity, 5);
});

test('sortRecords orders by Trade Date then confirmation number then original index', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);
  const line1 = buildRow({
    asxCode: 'ABC',
    confirmationNumber: '2',
    orderType: 'Buy',
    tradeDate: '2024-01-02',
    avgPrice: '10',
    quantity: '1',
  });
  const line2 = buildRow({
    asxCode: 'ABC',
    confirmationNumber: '1',
    orderType: 'Buy',
    tradeDate: '2024-01-02',
    avgPrice: '10',
    quantity: '1',
  });
  const line3 = buildRow({
    asxCode: 'ABC',
    confirmationNumber: '3',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '1',
  });
  const records = parseRecords([line1, line2, line3], columnInfo);
  const sorted = sortRecords(records, columnInfo);
  assert.equal(sorted[0].cols[columnInfo.confirmationIdx], '3');
  assert.equal(sorted[1].cols[columnInfo.confirmationIdx], '1');
  assert.equal(sorted[2].cols[columnInfo.confirmationIdx], '2');
});

test('sortRecords works when confirmation column is missing', () => {
  const headerCols = baseHeader.split(',').filter((name) => name !== 'Confirmation Number');
  const columnInfo = ensureRequiredColumns(headerCols);
  const line1 = buildRow({
    asxCode: 'ABC',
    orderType: 'Buy',
    tradeDate: '2024-01-02',
    avgPrice: '10',
    quantity: '1',
  });
  const line2 = buildRow({
    asxCode: 'ABC',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '1',
  });
  const records = parseRecords([line1, line2], columnInfo);
  const sorted = sortRecords(records, columnInfo);
  assert.equal(sorted[0].tradeDate.getTime() <= sorted[1].tradeDate.getTime(), true);
});

test('calculateProfitLossForRecords computes moving-average profit for sells', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);

  const buy1 = buildRow({
    asxCode: 'ABC',
    confirmationNumber: '1',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '10',
  });
  const buy2 = buildRow({
    asxCode: 'ABC',
    confirmationNumber: '2',
    orderType: 'Buy',
    tradeDate: '2024-01-02',
    avgPrice: '20',
    quantity: '10',
  });
  const sell = buildRow({
    asxCode: 'ABC',
    confirmationNumber: '3',
    orderType: 'Sell',
    tradeDate: '2024-01-03',
    avgPrice: '30',
    quantity: '10',
  });

  const records = parseRecords([sell, buy2, buy1], columnInfo);
  const profitLossByIndex = calculateProfitLossForRecords(records, columnInfo);

  assert.equal(profitLossByIndex[0], '150.00');
  assert.equal(profitLossByIndex[1], '');
  assert.equal(profitLossByIndex[2], '');
});

test('calculateProfitLossForRecords supports multiple codes and partial sells', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);

  const buyA1 = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '1',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '10',
  });
  const buyA2 = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '2',
    orderType: 'Buy',
    tradeDate: '2024-01-02',
    avgPrice: '20',
    quantity: '10',
  });
  const buyB = buildRow({
    asxCode: 'BBB',
    confirmationNumber: '3',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '5',
    quantity: '4',
  });
  const sellA = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '4',
    orderType: 'Sell',
    tradeDate: '2024-01-03',
    avgPrice: '25',
    quantity: '5',
  });
  const sellB = buildRow({
    asxCode: 'BBB',
    confirmationNumber: '5',
    orderType: 'Sell',
    tradeDate: '2024-01-02',
    avgPrice: '6',
    quantity: '4',
  });

  const records = parseRecords([buyA1, buyA2, buyB, sellA, sellB], columnInfo);
  const profitLossByIndex = calculateProfitLossForRecords(records, columnInfo);

  assert.equal(profitLossByIndex[0], '');
  assert.equal(profitLossByIndex[1], '');
  assert.equal(profitLossByIndex[2], '');
  assert.equal(profitLossByIndex[3], '50.00');
  assert.equal(profitLossByIndex[4], '4.00');
});

test('calculateProfitLossForRecords throws when selling without position', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);

  const sell = buildRow({
    asxCode: 'XYZ',
    confirmationNumber: '1',
    orderType: 'Sell',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '1',
  });

  const records = parseRecords([sell], columnInfo);
  assert.throws(() => calculateProfitLossForRecords(records, columnInfo), /Sell encountered without existing position/);
});

test('calculateProfitLossForRecords throws when selling more than position', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);

  const buy = buildRow({
    asxCode: 'XYZ',
    confirmationNumber: '1',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '5',
  });
  const sell = buildRow({
    asxCode: 'XYZ',
    confirmationNumber: '2',
    orderType: 'Sell',
    tradeDate: '2024-01-02',
    avgPrice: '12',
    quantity: '6',
  });

  const records = parseRecords([buy, sell], columnInfo);
  assert.throws(() => calculateProfitLossForRecords(records, columnInfo), /Sell quantity exceeds position/);
});

test('calculateProfitLossForRecords ignores rows without AsxCode and non buy/sell order types', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);

  const blankCodeRow = buildRow({
    asxCode: '',
    confirmationNumber: '1',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '10',
  });
  const otherTypeRow = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '2',
    orderType: 'Dividend',
    tradeDate: '2024-01-02',
    avgPrice: '1',
    quantity: '1',
  });
  const sellRow = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '3',
    orderType: 'Sell',
    tradeDate: '2024-01-03',
    avgPrice: '10',
    quantity: '1',
  });
  const buyRow = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '4',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '5',
    quantity: '1',
  });

  const records = parseRecords([blankCodeRow, otherTypeRow, sellRow, buyRow], columnInfo);
  const profitLossByIndex = calculateProfitLossForRecords(records, columnInfo);

  assert.equal(profitLossByIndex[0], '');
  assert.equal(profitLossByIndex[1], '');
  assert.equal(profitLossByIndex[3], '');
  assert.equal(profitLossByIndex[2], '5.00');
});

test('buildOutputCsv appends ProfitLoss column and preserves order', () => {
  const headerCols = baseHeader.split(',');
  const columnInfo = ensureRequiredColumns(headerCols);
  const line1 = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '1',
    orderType: 'Buy',
    tradeDate: '2024-01-01',
    avgPrice: '10',
    quantity: '1',
  });
  const line2 = buildRow({
    asxCode: 'AAA',
    confirmationNumber: '2',
    orderType: 'Sell',
    tradeDate: '2024-01-02',
    avgPrice: '12',
    quantity: '1',
  });
  const records = parseRecords([line1, line2], columnInfo);
  const profitLossByIndex = ['', '2.00'];

  const output = buildOutputCsv(baseHeader, records, profitLossByIndex);
  const lines = output.trimEnd().split('\n');

  assert.equal(lines[0], `${baseHeader},ProfitLoss`);
  assert.equal(lines[1].endsWith(','), true);
  assert.equal(lines[2].endsWith(',2.00'), true);
});

test('calculateProfitLossCsv processes CSV string end-to-end', () => {
  const rows = [
    baseHeader,
    buildRow({
      asxCode: 'AAA',
      confirmationNumber: '1',
      orderType: 'Buy',
      tradeDate: '2024-01-01',
      avgPrice: '10',
      quantity: '10',
    }),
    buildRow({
      asxCode: 'AAA',
      confirmationNumber: '2',
      orderType: 'Sell',
      tradeDate: '2024-01-02',
      avgPrice: '12',
      quantity: '4',
    }),
  ];

  const inputCsv = rows.join('\n') + '\n';
  const outputCsv = calculateProfitLossCsv(inputCsv);
  const lines = outputCsv.trimEnd().split('\n');

  assert.equal(lines[0], `${baseHeader},ProfitLoss`);
  assert.equal(lines[1].endsWith(','), true);
  assert.equal(lines[2].endsWith(',8.00'), true);
});

test('calculateProfitLossCsv rejects empty input and header-only input', () => {
  assert.throws(() => calculateProfitLossCsv(''), /Input CSV is empty/);
  assert.throws(() => calculateProfitLossCsv(baseHeader), /Input CSV has no data rows/);
});

test('runFileCalculation reads and writes files correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-test-'));
  const inputPath = path.join(tmpDir, 'input.csv');
  const outputPath = path.join(tmpDir, 'output.csv');

  const rows = [
    baseHeader,
    buildRow({
      asxCode: 'AAA',
      confirmationNumber: '1',
      orderType: 'Buy',
      tradeDate: '2024-01-01',
      avgPrice: '10',
      quantity: '10',
    }),
    buildRow({
      asxCode: 'AAA',
      confirmationNumber: '2',
      orderType: 'Sell',
      tradeDate: '2024-01-02',
      avgPrice: '15',
      quantity: '10',
    }),
  ];

  fs.writeFileSync(inputPath, rows.join('\n') + '\n', 'utf8');
  runFileCalculation(inputPath, outputPath);

  const output = fs.readFileSync(outputPath, 'utf8');
  const lines = output.trimEnd().split('\n');

  assert.equal(lines[0], `${baseHeader},ProfitLoss`);
  assert.equal(lines[1].endsWith(','), true);
  assert.equal(lines[2].endsWith(',50.00'), true);
});


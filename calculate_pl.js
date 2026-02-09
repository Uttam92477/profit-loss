const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
  return line.split(',');
}

function toNumber(value) {
  if (value === undefined || value === null) return 0;
  const trimmed = String(value).replace(/"/g, '').trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse numeric value: ${value}`);
  }
  return parsed;
}

function parseTradeDate(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return new Date(0);
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Trade Date: ${value}`);
  }
  return date;
}

function ensureRequiredColumns(headerCols) {
  const index = {};
  headerCols.forEach((name, i) => {
    index[name] = i;
  });

  const required = ['AsxCode', 'Order Type', 'Trade Date', 'Avg Price', 'Quantity'];
  const missing = required.filter((name) => !(name in index));
  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`);
  }

  return {
    headerCols,
    index,
    asxIdx: index['AsxCode'],
    orderTypeIdx: index['Order Type'],
    tradeDateIdx: index['Trade Date'],
    avgPriceIdx: index['Avg Price'],
    qtyIdx: index['Quantity'],
    confirmationIdx: index['Confirmation Number'] ?? -1,
  };
}

function parseRecords(lines, columnInfo) {
  return lines.map((line, originalIndex) => {
    const cols = parseCsvLine(line);
    const asxCode = cols[columnInfo.asxIdx];
    const orderType = cols[columnInfo.orderTypeIdx];
    const tradeDate = parseTradeDate(cols[columnInfo.tradeDateIdx]);
    const avgPrice = toNumber(cols[columnInfo.avgPriceIdx]);
    const quantity = toNumber(cols[columnInfo.qtyIdx]);

    return {
      originalIndex,
      line,
      cols,
      asxCode,
      orderType,
      tradeDate,
      avgPrice,
      quantity,
    };
  });
}

function sortRecords(records, columnInfo) {
  return [...records].sort((a, b) => {
    const tDiff = a.tradeDate - b.tradeDate;
    if (tDiff !== 0) return tDiff;

    if (columnInfo.confirmationIdx !== -1) {
      const aConf = a.cols[columnInfo.confirmationIdx] || '';
      const bConf = b.cols[columnInfo.confirmationIdx] || '';
      if (aConf !== bConf) {
        return aConf.localeCompare(bConf);
      }
    }

    return a.originalIndex - b.originalIndex;
  });
}

function calculateProfitLossForRecords(records, columnInfo) {
  const positions = Object.create(null);
  const profitLossByIndex = new Array(records.length).fill('');

  for (const record of sortRecords(records, columnInfo)) {
    const code = record.asxCode;
    if (!code) continue;

    if (!positions[code]) {
      positions[code] = { quantity: 0, totalCost: 0 };
    }

    const position = positions[code];
    const isBuy = /^buy$/i.test(record.orderType);
    const isSell = /^sell$/i.test(record.orderType);

    if (isBuy) {
      const cost = record.avgPrice * record.quantity;
      position.quantity += record.quantity;
      position.totalCost += cost;
      continue;
    }

    if (isSell) {
      if (record.quantity <= 0) {
        throw new Error(`Sell quantity must be positive for ${code}`);
      }
      if (position.quantity <= 0 || position.totalCost <= 0) {
        throw new Error(`Sell encountered without existing position for ${code}`);
      }
      if (record.quantity - position.quantity > 1e-8) {
        throw new Error(`Sell quantity exceeds position for ${code}`);
      }

      const averageCostPerShare = position.totalCost / position.quantity;
      const proceeds = record.avgPrice * record.quantity;
      const costBasis = averageCostPerShare * record.quantity;
      const profitLoss = proceeds - costBasis;

      profitLossByIndex[record.originalIndex] = profitLoss.toFixed(2);

      position.quantity -= record.quantity;
      position.totalCost -= costBasis;

      if (Math.abs(position.quantity) < 1e-8) position.quantity = 0;
      if (Math.abs(position.totalCost) < 1e-6) position.totalCost = 0;
    }
  }

  return profitLossByIndex;
}

function buildOutputCsv(headerLine, records, profitLossByIndex) {
  const headerWithProfitLoss = `${headerLine},ProfitLoss`;
  const dataLines = records.map((record) => {
    const profitLoss = profitLossByIndex[record.originalIndex] ?? '';
    return `${record.line},${profitLoss}`;
  });
  return [headerWithProfitLoss, ...dataLines].join('\n') + '\n';
}

function calculateProfitLossCsv(inputCsv) {
  if (!inputCsv || !inputCsv.trim()) {
    throw new Error('Input CSV is empty');
  }

  const lines = inputCsv.trimEnd().split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) {
    throw new Error('Input CSV is empty');
  }

  const headerLine = lines[0];
  const dataLines = lines.slice(1);
  if (!dataLines.length) {
    throw new Error('Input CSV has no data rows');
  }

  const headerCols = parseCsvLine(headerLine);
  const columnInfo = ensureRequiredColumns(headerCols);
  const records = parseRecords(dataLines, columnInfo);
  const profitLossByIndex = calculateProfitLossForRecords(records, columnInfo);
  return buildOutputCsv(headerLine, records, profitLossByIndex);
}

function runFileCalculation(inputPath, outputPath) {
  const inputCsv = fs.readFileSync(inputPath, 'utf8');
  const outputCsv = calculateProfitLossCsv(inputCsv);
  fs.writeFileSync(outputPath, outputCsv, 'utf8');
}

function main() {
  const inputPath = path.join(__dirname, 'all_confirmations_cmc.csv');
  const outputPath = path.join(__dirname, 'all_confirmations_cmc_with_pl.csv');
  runFileCalculation(inputPath, outputPath);
}

if (require.main === module) {
  main();
}

module.exports = {
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
};


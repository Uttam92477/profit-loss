const fs = require('fs');
const path = require('path');

// Simple CSV line parser for this specific file (no embedded commas in fields)
function parseCsvLine(line) {
  return line.split(',');
}

function main() {
  const inputPath = path.join(__dirname, 'all_confirmations_cmc.csv');
  const outputPath = path.join(__dirname, 'all_confirmations_cmc_with_pl.csv');

  const raw = fs.readFileSync(inputPath, 'utf8').trimEnd();
  const allLines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (allLines.length === 0) {
    throw new Error('Input CSV appears to be empty.');
  }

  const headerLine = allLines[0];
  const dataLines = allLines.slice(1);

  const headerCols = parseCsvLine(headerLine);

  const asxIdx = headerCols.indexOf('AsxCode');
  const orderTypeIdx = headerCols.indexOf('Order Type');
  const tradeDateIdx = headerCols.indexOf('Trade Date');
  const avgPriceIdx = headerCols.indexOf('Avg Price');
  const qtyIdx = headerCols.indexOf('Quantity');
  const confirmationIdx = headerCols.indexOf('Confirmation Number');

  if ([asxIdx, orderTypeIdx, tradeDateIdx, avgPriceIdx, qtyIdx].some((i) => i === -1)) {
    throw new Error('One or more expected columns are missing in the CSV header.');
  }

  // Parse each data line into a structured record
  const records = dataLines.map((line, idx) => {
    const cols = parseCsvLine(line);

    const asxCode = cols[asxIdx];
    const orderType = cols[orderTypeIdx];
    const tradeDateStr = cols[tradeDateIdx];

    const avgPriceStr = (cols[avgPriceIdx] || '').replace(/"/g, '').trim();
    const quantityStr = cols[qtyIdx] || '';

    const avgPrice = parseFloat(avgPriceStr || '0');
    const quantity = parseFloat(quantityStr || '0');

    const tradeDate = tradeDateStr ? new Date(tradeDateStr) : new Date(0);

    return {
      originalIndex: idx, // index within dataLines (excluding header)
      line,
      cols,
      asxCode,
      orderType,
      tradeDate,
      avgPrice,
      quantity,
    };
  });

  // Sort by Trade Date ascending, then by Confirmation Number (if present), then by original index
  const sorted = [...records].sort((a, b) => {
    const tDiff = a.tradeDate - b.tradeDate;
    if (tDiff !== 0) return tDiff;

    if (confirmationIdx !== -1) {
      const aConf = a.cols[confirmationIdx] || '';
      const bConf = b.cols[confirmationIdx] || '';
      if (aConf !== bConf) {
        return aConf.localeCompare(bConf);
      }
    }

    return a.originalIndex - b.originalIndex;
  });

  // Track running positions per AsxCode
  // positions[code] = { quantity: number, totalCost: number }
  const positions = Object.create(null);

  // Profit/Loss per original record index (aligned with records array)
  const plByIndex = new Array(records.length).fill('');

  for (const rec of sorted) {
    const code = rec.asxCode;
    if (!code) continue;

    if (!positions[code]) {
      positions[code] = { quantity: 0, totalCost: 0 };
    }

    const pos = positions[code];

    const isBuy = /^buy$/i.test(rec.orderType);
    const isSell = /^sell$/i.test(rec.orderType);

    if (isBuy) {
      const cost = rec.avgPrice * rec.quantity;
      pos.quantity += rec.quantity;
      pos.totalCost += cost;
    } else if (isSell) {
      // Average cost per share based on existing position before this sale
      let avgCostPerShare = 0;
      if (pos.quantity > 0 && pos.totalCost > 0) {
        avgCostPerShare = pos.totalCost / pos.quantity;
      }

      const proceeds = rec.avgPrice * rec.quantity;
      const costBasis = avgCostPerShare * rec.quantity;
      const pl = proceeds - costBasis;

      // Store Profit/Loss for this sell in the slot corresponding to the original row
      plByIndex[rec.originalIndex] = pl.toFixed(2);

      // Update remaining position after the sale
      pos.quantity -= rec.quantity;
      pos.totalCost -= costBasis;

      // Clean up tiny floating point residues
      if (Math.abs(pos.quantity) < 1e-8) pos.quantity = 0;
      if (Math.abs(pos.totalCost) < 1e-6) pos.totalCost = 0;
    }
  }

  // Build output CSV, preserving original row order
  const outputHeader = headerLine + ',ProfitLoss';

  const outputDataLines = records.map((rec) => {
    const pl = plByIndex[rec.originalIndex] ?? '';
    return rec.line + ',' + pl;
  });

  const output = [outputHeader, ...outputDataLines].join('\n') + '\n';
  fs.writeFileSync(outputPath, output, 'utf8');

  console.log(`Wrote ${outputPath}`);
}

if (require.main === module) {
  main();
}


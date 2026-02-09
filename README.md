# profit-loss

### What I implemented

- **Core calculator (`calculate_pl.js`)**
  - Reads `all_confirmations_cmc.csv` from the repo root and writes `all_confirmations_cmc_with_pl.csv`.
  - Uses **moving-average cost per share** per `AsxCode`:
    - Tracks `quantity` and `totalCost` for each code.
    - On **Buy**:
      - Increases position `quantity` and `totalCost` by `Avg Price * Quantity`.
    - On **Sell**:
      - Validates that a positive position exists and that you are not selling more than you hold.
      - Computes average cost = `totalCost / quantity`.
      - Computes P/L = `(Sell Avg Price * Sell Quantity) - (average cost * Sell Quantity)`.
      - Writes P/L (to 2 decimals) into the `ProfitLoss` column for that row.
      - Reduces position by the sold quantity and corresponding cost.
    - Non-Buy/Sell rows and rows with missing `AsxCode` are ignored for position and P/L.
  - Preserves **original CSV order** and simply adds a `ProfitLoss` column:
    - Buys get a **blank** `ProfitLoss` value.
    - Sells get positive (profit) or negative (loss) numeric strings, e.g. `150.00`.
  - Robust input handling:
    - Validates required headers: `AsxCode`, `Order Type`, `Trade Date`, `Avg Price`, `Quantity`.
    - Parses numeric values safely via `toNumber`, rejecting malformed numbers.
    - Parses and validates `Trade Date` via `parseTradeDate`.
    - Throws clear errors for:
      - Empty CSV input or no data rows.
      - Missing required columns.
      - Invalid `Trade Date`.
      - Invalid numeric fields.
      - Sell without an existing position.
      - Sell quantity exceeding available position.

- **Public API (all exported for testability)**
  - `parseCsvLine(line)`
  - `toNumber(value)`
  - `parseTradeDate(value)`
  - `ensureRequiredColumns(headerCols)`
  - `parseRecords(lines, columnInfo)`
  - `sortRecords(records, columnInfo)`
  - `calculateProfitLossForRecords(records, columnInfo)`
  - `buildOutputCsv(headerLine, records, profitLossByIndex)`
  - `calculateProfitLossCsv(inputCsv)`
  - `runFileCalculation(inputPath, outputPath)`
  - CLI entrypoint:
    - Running `node calculate_pl.js` will:
      - Read `all_confirmations_cmc.csv`
      - Write `all_confirmations_cmc_with_pl.csv` with the `ProfitLoss` column.

### Tests

- **Test file**: `calculate_pl.test.js` using Node’s built-in `node:test` and `assert/strict`.
- **Coverage and scenarios**:
  - Parsing helpers:
    - `parseCsvLine` splits correctly.
    - `toNumber` handles quotes, spaces, empty, null, undefined, and throws on invalid numeric input.
    - `parseTradeDate` parses valid dates and throws on invalid ones.
  - Header handling:
    - `ensureRequiredColumns` finds correct indices.
    - Throws when any required column is missing.
  - Record parsing and sorting:
    - `parseRecords` builds structured records from CSV lines.
    - `sortRecords`:
      - Sorts by `Trade Date`, then `Confirmation Number`, then original index.
      - Works when `Confirmation Number` column is missing.
  - P/L computation:
    - Correct moving-average P/L for simple buy–buy–sell scenarios.
    - Multiple codes and partial sells.
    - Throws when selling without any position.
    - Throws when selling more than available quantity.
    - Ignores rows with blank `AsxCode` and non-buy/sell `Order Type`, while still correctly computing P/L for valid sells.
  - CSV output:
    - `buildOutputCsv` appends `ProfitLoss` header and preserves row order, with correct P/L placement.
    - `calculateProfitLossCsv` exercises the full path from CSV string to output CSV:
      - Validates header/data presence.
      - Adds `ProfitLoss` column and calculates values.
    - Input validation:
      - Rejects empty input.
      - Rejects header-only input.
  - File I/O:
    - `runFileCalculation` tested end-to-end in a temp directory:
      - Writes an output CSV with correct header and computed P/L.

### How to use it

- **Generate the P/L-augmented CSV**:

```bash
cd /Users/kila/repos/profit-loss
node calculate_pl.js
```

- This will read `all_confirmations_cmc.csv` and overwrite or create `all_confirmations_cmc_with_pl.csv` with the extra `ProfitLoss` column populated for each `Sell` row.

- **Run the tests**:

```bash
cd /Users/kila/repos/profit-loss
node --test calculate_pl.test.js
```

This setup gives you a production-grade, moving-average profit/loss calculator with a fully covered, meaningful test suite.

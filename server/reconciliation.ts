/**
 * Reconciliation Pipeline
 * Implements Steps B through I from the specification
 */

import type {
  FxData,
  SpFxDebugRow,
  PrimaryRow,
  OverallSummaryRow,
  RunResult,
  SheetData,
} from "@shared/schema";

// FX API endpoint
const FX_API_URL = "https://open.er-api.com/v6/latest/USD";

/**
 * Fetch FX rates from API (USD base)
 */
export async function fetchFxRates(): Promise<FxData> {
  try {
    const response = await fetch(FX_API_URL);
    if (!response.ok) {
      throw new Error(`FX API returned ${response.status}`);
    }
    const data = await response.json();
    return {
      usdToCcy: data.rates as Record<string, number>,
      refreshedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Failed to fetch FX rates, using fallback:", error);
    // Fallback rates
    return {
      usdToCcy: {
        USD: 1,
        EUR: 0.92,
        GBP: 0.79,
        INR: 83.5,
        AED: 3.67,
        SGD: 1.34,
        AUD: 1.53,
        CAD: 1.36,
        JPY: 149.5,
        THB: 35.5,
      },
      refreshedAt: new Date().toISOString(),
    };
  }
}

// HO Row from parsed sheet
interface HORow {
  bookingId: string;
  netPrice: number;
  currency: string;
  bookingCreationDate: string | null;
  bookingStatus: string;
  cancellable: string | null;
  cancellationInsurance: string | null;
  experienceName?: string;
  supplierName?: string;
}

// SP Row from parsed sheet
interface SPRow {
  bookingId: string;
  netPrice: number;
  billingCurrency: string;
  fulfilmentDate?: string | null;
}

/**
 * Parse HO Data sheet into typed rows
 */
function parseHOData(sheet: SheetData): HORow[] {
  // DEBUG: Log column headers from the sheet
  console.log(`\n[DEBUG] HO Data sheet headers: ${sheet.headers.join(", ")}`);
  console.log(`[DEBUG] Sample row keys (first row): ${sheet.rows.length > 0 ? Object.keys(sheet.rows[0]).join(", ") : "no rows"}`);
  
  return sheet.rows.map((row) => ({
    bookingId: String(row["bookingId"] || ""),
    netPrice: Number(row["netPrice"]) || 0,
    currency: String(row["currency"] || "USD"),
    bookingCreationDate: row["bookingCreationDate"] ? String(row["bookingCreationDate"]) : null,
    bookingStatus: String(row["bookingStatus"] || ""),
    cancellable: row["Cancellable"] ? String(row["Cancellable"]) : null,
    cancellationInsurance: row["Cancellation Insurance"] ? String(row["Cancellation Insurance"]) : null,
    experienceName: row["experienceName"] ? String(row["experienceName"]) : undefined,
    supplierName: row["vendorName"] || row["supplierName"] ? String(row["vendorName"] || row["supplierName"]) : undefined,
  }));
}

/**
 * Parse SP Invoice Report sheet into typed rows
 */
function parseSPData(sheet: SheetData): SPRow[] {
  return sheet.rows.map((row) => ({
    bookingId: String(row["bookingId"] || ""),
    netPrice: Number(row["netPrice"]) || 0,
    billingCurrency: String(row["Billing Currency"] || row["billingCurrency"] || "USD"),
    fulfilmentDate: row["fulfilmentDate"] ? String(row["fulfilmentDate"]) : null,
  }));
}

/**
 * Parse date string safely, returns timestamp for comparison
 */
function parseDate(dateStr: string | null): number {
  if (!dateStr) return 0;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

/**
 * STEP B: Determine Primary candidate per bookingId from HO Data
 * Primary = row with max bookingCreationDate
 */
function buildPrimaryHOMap(hoRows: HORow[]): {
  primaryHoCurrencyByBookingId: Map<string, string>;
  primaryHoNetByBookingId: Map<string, number>;
  primaryHoRowByBookingId: Map<string, HORow>;
  hoRowsByBookingId: Map<string, HORow[]>;
} {
  const hoRowsByBookingId = new Map<string, HORow[]>();
  
  // Group HO rows by bookingId
  for (const row of hoRows) {
    if (!row.bookingId) continue;
    const existing = hoRowsByBookingId.get(row.bookingId) || [];
    hoRowsByBookingId.set(row.bookingId, [...existing, row]);
  }
  
  const primaryHoCurrencyByBookingId = new Map<string, string>();
  const primaryHoNetByBookingId = new Map<string, number>();
  const primaryHoRowByBookingId = new Map<string, HORow>();
  
  // For each bookingId, find Primary candidate (max bookingCreationDate)
  Array.from(hoRowsByBookingId.entries()).forEach(([bookingId, rows]) => {
    if (rows.length === 0) return;
    
    // DEBUG: Log when there are multiple rows for a bookingId
    if (rows.length > 1) {
      console.log(`\n[DEBUG] BookingId ${bookingId} has ${rows.length} rows:`);
      rows.forEach((r, idx) => {
        const parsedTs = parseDate(r.bookingCreationDate);
        console.log(`  Row ${idx + 1}: bookingCreationDate="${r.bookingCreationDate}" -> parsed timestamp=${parsedTs} (${parsedTs ? new Date(parsedTs).toISOString() : 'INVALID'}), netPrice=${r.netPrice}`);
      });
    }
    
    // Sort by bookingCreationDate descending
    const sorted = [...rows].sort((a, b) => 
      parseDate(b.bookingCreationDate) - parseDate(a.bookingCreationDate)
    );
    
    const primary = sorted[0];
    
    // DEBUG: Log which row was selected as Primary
    if (rows.length > 1) {
      console.log(`  -> Selected PRIMARY: bookingCreationDate="${primary.bookingCreationDate}", netPrice=${primary.netPrice}`);
    }
    
    primaryHoCurrencyByBookingId.set(bookingId, primary.currency);
    primaryHoNetByBookingId.set(bookingId, primary.netPrice);
    primaryHoRowByBookingId.set(bookingId, primary);
  });
  
  return {
    primaryHoCurrencyByBookingId,
    primaryHoNetByBookingId,
    primaryHoRowByBookingId,
    hoRowsByBookingId,
  };
}

/**
 * STEP C: Augment SP rows with FX conversion using Primary HO currency
 */
function augmentSPRows(
  spRows: SPRow[],
  primaryHoCurrencyByBookingId: Map<string, string>,
  usdToCcy: Record<string, number>
): { augmentedSP: SpFxDebugRow[]; unmappedSP: SPRow[] } {
  const augmentedSP: SpFxDebugRow[] = [];
  const unmappedSP: SPRow[] = [];
  
  for (const sp of spRows) {
    if (!sp.bookingId) continue;
    
    const hoCurrencyUsed = primaryHoCurrencyByBookingId.get(sp.bookingId);
    
    if (!hoCurrencyUsed) {
      // Unmapped: bookingId in SP but not in primary map
      unmappedSP.push(sp);
      augmentedSP.push({
        bookingId: sp.bookingId,
        spCurrency: sp.billingCurrency,
        hoCurrencyUsed: null,
        fxRateUsed: null,
        spNetOriginal: sp.netPrice,
        spNetInHo: null,
      });
      continue;
    }
    
    // Compute FX rate: USD_to_CCY[hoCurrencyUsed] / USD_to_CCY[spCurrency]
    const hoRate = usdToCcy[hoCurrencyUsed] || 1;
    const spRate = usdToCcy[sp.billingCurrency] || 1;
    const fxRateUsed = hoRate / spRate;
    const spNetInHo = sp.netPrice * fxRateUsed;
    
    augmentedSP.push({
      bookingId: sp.bookingId,
      spCurrency: sp.billingCurrency,
      hoCurrencyUsed,
      fxRateUsed,
      spNetOriginal: sp.netPrice,
      spNetInHo,
    });
  }
  
  return { augmentedSP, unmappedSP };
}

/**
 * STEP D: Build SP lookup by bookingId from augmented SP rows
 * For bookingIds that exist in primary map only
 */
interface SPBundle {
  spNetInHo: number;
  spNetOriginal: number;
  spCurrency: string;
  hoCurrencyUsed: string;
  fxRateUsed: number;
}

function buildSPLookup(
  spRows: SPRow[],
  augmentedSP: SpFxDebugRow[],
  primaryHoCurrencyByBookingId: Map<string, string>
): Map<string, SPBundle> {
  const spByBookingId = new Map<string, SPBundle>();
  
  // Group augmented SP by bookingId
  const spGrouped = new Map<string, { sp: SPRow; aug: SpFxDebugRow }[]>();
  
  for (let i = 0; i < spRows.length; i++) {
    const sp = spRows[i];
    const aug = augmentedSP[i];
    
    if (!sp.bookingId || !primaryHoCurrencyByBookingId.has(sp.bookingId)) continue;
    if (aug.hoCurrencyUsed === null) continue;
    
    const existing = spGrouped.get(sp.bookingId) || [];
    spGrouped.set(sp.bookingId, [...existing, { sp, aug }]);
  }
  
  // For each bookingId, pick best SP record (latest by fulfilmentDate or first)
  Array.from(spGrouped.entries()).forEach(([bookingId, records]) => {
    if (records.length === 0) return;
    
    // Sort by fulfilmentDate descending if present
    const sorted = [...records].sort((a, b) => {
      const dateA = parseDate(a.sp.fulfilmentDate || null);
      const dateB = parseDate(b.sp.fulfilmentDate || null);
      return dateB - dateA;
    });
    
    const best = sorted[0];
    spByBookingId.set(bookingId, {
      spNetInHo: best.aug.spNetInHo!,
      spNetOriginal: best.aug.spNetOriginal,
      spCurrency: best.aug.spCurrency,
      hoCurrencyUsed: best.aug.hoCurrencyUsed!,
      fxRateUsed: best.aug.fxRateUsed!,
    });
  });
  
  return spByBookingId;
}

/**
 * STEP G: Reason logic for Primary rows
 */
function assignReason(
  bookingStatus: string,
  cancellable: string | null,
  cancellationInsurance: string | null,
  differenceLc: number,
  differencePct: number | null,
  sameCurrency: boolean,
  spNetInHo: number
): string {
  // 1) Cancelled cases
  if (bookingStatus.toLowerCase() === "cancelled") {
    // a) If Cancellable == "Yes" AND spNetInHo > 0 => "Charge loss"
    if (cancellable?.toLowerCase() === "yes" && spNetInHo > 0) {
      return "Charge loss";
    }
    // b) If Cancellable == "No" AND Cancellation Insurance == "Yes" => "Cancellation Insurance"
    if (cancellable?.toLowerCase() === "no" && cancellationInsurance?.toLowerCase() === "yes") {
      return "Cancellation Insurance";
    }
    // c) If Cancellable == "No" AND Cancellation Insurance == "No" => "HO policy cancellation"
    if (cancellable?.toLowerCase() === "no" && cancellationInsurance?.toLowerCase() === "no") {
      return "HO policy cancellation";
    }
    // d) Default for cancelled
    return "HO policy cancellation";
  }
  
  // 2) Not Cancelled cases
  if (differencePct !== null) {
    // a) MTB rule: abs(differencePct) >= 0.95 AND close to whole percentage
    const absPct = Math.abs(differencePct);
    if (absPct >= 0.95) {
      const pctTimesHundred = absPct * 100;
      const roundedToHundred = Math.round(pctTimesHundred / 100) * 100;
      if (Math.abs(pctTimesHundred - roundedToHundred) <= 5) {
        return "Multiple Tickets Booked";
      }
    }
    
    // b) Reconciled rules
    if (sameCurrency) {
      // reconciled if abs(differenceLc) < 1 AND abs(differencePct) < 0.01
      if (Math.abs(differenceLc) < 1 && Math.abs(differencePct) < 0.01) {
        return "Reconciled";
      }
    } else {
      // different currency: reconciled if abs(differencePct) < 0.03
      if (Math.abs(differencePct) < 0.03) {
        return "Reconciled";
      }
    }
  }
  
  // c) Else => "Net Price Discrepancy"
  return "Net Price Discrepancy";
}

/**
 * STEP E-F: Compute reconciliation fields on HO rows and assign Primary/Secondary
 */
function computeReconciliationRows(
  hoRowsByBookingId: Map<string, HORow[]>,
  primaryHoRowByBookingId: Map<string, HORow>,
  spByBookingId: Map<string, SPBundle>,
  usdToCcy: Record<string, number>
): PrimaryRow[] {
  const allRows: PrimaryRow[] = [];
  
  Array.from(hoRowsByBookingId.entries()).forEach(([bookingId, hoRows]) => {
    const primaryHoRow = primaryHoRowByBookingId.get(bookingId);
    
    for (const ho of hoRows) {
      const isPrimary = ho === primaryHoRow;
      const fulfillmentIdentifier = isPrimary ? "Primary" : "Secondary";
      
      // Get SP bundle
      const spBundle = spByBookingId.get(bookingId);
      
      let spNetOriginal: number;
      let spCurrency: string;
      let spNetInHo: number;
      let fxRateUsed: number;
      let sameCurrency: boolean;
      
      if (spBundle) {
        spNetOriginal = spBundle.spNetOriginal;
        spCurrency = spBundle.spCurrency;
        spNetInHo = spBundle.spNetInHo;
        fxRateUsed = spBundle.fxRateUsed;
        sameCurrency = spBundle.spCurrency === ho.currency;
      } else {
        // Missing SP bundle: treat spNetInHo = 0
        spNetOriginal = 0;
        spCurrency = ho.currency;
        spNetInHo = 0;
        fxRateUsed = 1;
        sameCurrency = true;
      }
      
      // Compute differences
      const differenceLc = ho.netPrice - spNetInHo;
      const differencePct = ho.netPrice !== 0 ? differenceLc / ho.netPrice : null;
      
      // STEP I: Convert to USD
      const hoRate = usdToCcy[ho.currency] || 1;
      const differenceUsd = differenceLc / hoRate;
      
      // STEP G: Assign reason (only matters for Primary, Secondary always gets "Duplicate Fulfillment")
      let reason: string;
      if (!isPrimary) {
        reason = "Duplicate Fulfillment";
      } else {
        reason = assignReason(
          ho.bookingStatus,
          ho.cancellable,
          ho.cancellationInsurance,
          differenceLc,
          differencePct,
          sameCurrency,
          spNetInHo
        );
      }
      
      allRows.push({
        bookingId,
        fulfillmentIdentifier,
        hoNet: ho.netPrice,
        hoCurrency: ho.currency,
        bookingCreationDate: ho.bookingCreationDate,
        bookingStatus: ho.bookingStatus,
        cancellable: ho.cancellable,
        cancellationInsurance: ho.cancellationInsurance,
        spNetOriginal,
        spCurrency,
        spNetInHo,
        fxRateUsed,
        sameCurrency,
        differenceLc,
        differencePct,
        differenceUsd,
        reason,
        experienceName: ho.experienceName,
        supplierName: ho.supplierName,
      });
    }
  });
  
  return allRows;
}

/**
 * STEP H: Build overall summary (Primary only + Unmapped)
 */
function buildOverallSummary(
  primaryRows: PrimaryRow[],
  unmappedSP: SPRow[],
  usdToCcy: Record<string, number>
): OverallSummaryRow[] {
  // STEP H: Filter to Primary only
  const primaryOnly = primaryRows.filter(r => r.fulfillmentIdentifier === "Primary");
  
  // Group Primary rows by (reason, hoCurrency)
  const summaryMap = new Map<string, OverallSummaryRow>();
  const bidsByKey = new Map<string, Set<string>>();
  
  for (const row of primaryOnly) {
    const key = `${row.reason}|${row.hoCurrency}`;
    
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        reason: row.reason,
        currency: row.hoCurrency,
        discrepancyLc: 0,
        discrepancyUsd: 0,
        countBid: 0,
      });
      bidsByKey.set(key, new Set());
    }
    
    const summary = summaryMap.get(key)!;
    const bids = bidsByKey.get(key)!;
    
    summary.discrepancyLc += row.differenceLc;
    summary.discrepancyUsd += row.differenceUsd;
    bids.add(row.bookingId);
  }
  
  // Update unique BID counts
  Array.from(bidsByKey.entries()).forEach(([key, bids]) => {
    const summary = summaryMap.get(key)!;
    summary.countBid = bids.size;
  });
  
  // Add Unmapped groups by spCurrency
  const unmappedBySpCurrency = new Map<string, { discrepancyLc: number; discrepancyUsd: number; bids: Set<string> }>();
  
  for (const sp of unmappedSP) {
    if (!unmappedBySpCurrency.has(sp.billingCurrency)) {
      unmappedBySpCurrency.set(sp.billingCurrency, {
        discrepancyLc: 0,
        discrepancyUsd: 0,
        bids: new Set(),
      });
    }
    
    const group = unmappedBySpCurrency.get(sp.billingCurrency)!;
    // HO base is 0, so discrepancy = 0 - spNetOriginal
    const discrepancyLc = 0 - sp.netPrice;
    const spRate = usdToCcy[sp.billingCurrency] || 1;
    const discrepancyUsd = discrepancyLc / spRate;
    
    group.discrepancyLc += discrepancyLc;
    group.discrepancyUsd += discrepancyUsd;
    group.bids.add(sp.bookingId);
  }
  
  Array.from(unmappedBySpCurrency.entries()).forEach(([currency, group]) => {
    summaryMap.set(`Unmapped|${currency}`, {
      reason: "Unmapped",
      currency,
      discrepancyLc: group.discrepancyLc,
      discrepancyUsd: group.discrepancyUsd,
      countBid: group.bids.size,
    });
  });
  
  // Convert to array and sort by discrepancyUsd ascending
  const summaryRows = Array.from(summaryMap.values());
  summaryRows.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
  
  return summaryRows;
}

/**
 * Main reconciliation function
 */
export async function runReconciliation(
  hoData: SheetData,
  spData: SheetData
): Promise<RunResult> {
  // Fetch FX rates
  const fx = await fetchFxRates();
  const { usdToCcy } = fx;
  
  // Parse sheets
  const hoRows = parseHOData(hoData);
  const spRows = parseSPData(spData);
  
  // STEP B: Build Primary HO map
  const {
    primaryHoCurrencyByBookingId,
    primaryHoRowByBookingId,
    hoRowsByBookingId,
  } = buildPrimaryHOMap(hoRows);
  
  // STEP C: Augment SP rows
  const { augmentedSP, unmappedSP } = augmentSPRows(
    spRows,
    primaryHoCurrencyByBookingId,
    usdToCcy
  );
  
  // STEP D: Build SP lookup
  const spByBookingId = buildSPLookup(
    spRows,
    augmentedSP,
    primaryHoCurrencyByBookingId
  );
  
  // STEP E-G: Compute reconciliation rows
  const allRows = computeReconciliationRows(
    hoRowsByBookingId,
    primaryHoRowByBookingId,
    spByBookingId,
    usdToCcy
  );
  
  // STEP H: Filter to Primary only for main tables
  const primaryRows = allRows.filter(r => r.fulfillmentIdentifier === "Primary");
  
  // Sort both arrays by differenceUsd ascending
  primaryRows.sort((a, b) => a.differenceUsd - b.differenceUsd);
  allRows.sort((a, b) => a.differenceUsd - b.differenceUsd);
  
  // Build overall summary
  const overallSummary = buildOverallSummary(allRows, unmappedSP, usdToCcy);
  
  return {
    fx,
    overallSummary,
    primaryRows,
    allRows,
    spFxDebugRows: augmentedSP,
  };
}

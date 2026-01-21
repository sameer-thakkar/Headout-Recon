/**
 * Reconciliation Pipeline
 * Implements Steps B through I from the specification
 */

import fs from 'fs';
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
  tid?: string;
  fulfillmentMethod?: string;
  driTeam?: string;
  headoutSellingPrice?: number;
  priceSync?: string;
  beId?: string;
  billingEntityName?: string;
}

// SP Row from parsed sheet
interface SPRow {
  bookingId: string;
  netPrice: number;
  billingCurrency: string;
  fulfilmentDate?: string | null;
  beId?: string;
  ticketId?: string;
}

/**
 * Helper to get value from row with fallback column names (case-insensitive)
 */
function getRowValue(row: Record<string, unknown>, ...columnNames: string[]): unknown {
  // First try exact match
  for (const name of columnNames) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
      return row[name];
    }
  }
  // Then try case-insensitive match (and with/without spaces)
  const rowKeys = Object.keys(row);
  for (const name of columnNames) {
    const normalizedName = name.toLowerCase().replace(/\s+/g, "");
    for (const key of rowKeys) {
      const normalizedKey = key.toLowerCase().replace(/\s+/g, "");
      if (normalizedKey === normalizedName && row[key] !== undefined && row[key] !== null && row[key] !== "") {
        return row[key];
      }
    }
  }
  return null;
}

/**
 * Parse HO Data sheet into typed rows
 */
function parseHOData(sheet: SheetData): HORow[] {
  // Write debug info to a file for troubleshooting
  const debugInfo = {
    headers: sheet.headers,
    sampleRowKeys: sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : [],
    sampleRow: sheet.rows.length > 0 ? sheet.rows[0] : null,
  };
  fs.writeFileSync('/tmp/ho_data_debug.json', JSON.stringify(debugInfo, null, 2));
  
  return sheet.rows.map((row) => {
    const bookingCreationDate = getRowValue(row, "bookingCreationDate", "Booking Creation Date", "booking_creation_date", "creationDate");
    const bookingId = getRowValue(row, "bookingId", "Booking ID", "booking_id");
    const netPrice = getRowValue(row, "netPrice", "Net Price", "net_price", "finalNetPrice", "Final Net Price");
    const currency = getRowValue(row, "currency", "Currency", "Billing Currency");
    const bookingStatus = getRowValue(row, "bookingStatus", "Booking Status", "booking_status", "status");
    
    return {
      bookingId: String(bookingId || ""),
      netPrice: Number(netPrice) || 0,
      currency: String(currency || "USD"),
      bookingCreationDate: bookingCreationDate ? String(bookingCreationDate) : null,
      bookingStatus: String(bookingStatus || ""),
      cancellable: getRowValue(row, "Cancellable", "cancellable") ? String(getRowValue(row, "Cancellable", "cancellable")) : null,
      cancellationInsurance: getRowValue(row, "Cancellation Insurance", "cancellationInsurance") ? String(getRowValue(row, "Cancellation Insurance", "cancellationInsurance")) : null,
      experienceName: getRowValue(row, "experienceName", "Experience Name") ? String(getRowValue(row, "experienceName", "Experience Name")) : undefined,
      supplierName: getRowValue(row, "vendorName", "supplierName", "Vendor Name", "Supplier Name") ? String(getRowValue(row, "vendorName", "supplierName", "Vendor Name", "Supplier Name")) : undefined,
      tid: getRowValue(row, "tid", "TID", "tourId", "Tour ID", "tour_id") ? String(getRowValue(row, "tid", "TID", "tourId", "Tour ID", "tour_id")) : undefined,
      fulfillmentMethod: getRowValue(row, "fulfillmentMethod", "Fulfillment Method", "fulfilmentMethod", "Fulfilment Method") ? String(getRowValue(row, "fulfillmentMethod", "Fulfillment Method", "fulfilmentMethod", "Fulfilment Method")) : undefined,
      driTeam: getRowValue(row, "driTeam", "DRI Team", "dri_team", "DRI") ? String(getRowValue(row, "driTeam", "DRI Team", "dri_team", "DRI")) : undefined,
      headoutSellingPrice: Number(getRowValue(row, "headoutSellingPrice", "Headout Selling Price", "headout_selling_price", "sellingPrice", "Selling Price")) || undefined,
      priceSync: getRowValue(row, "priceSync", "Price Sync", "price_sync", "PriceSync") ? String(getRowValue(row, "priceSync", "Price Sync", "price_sync", "PriceSync")) : undefined,
      beId: getRowValue(row, "beId", "BE ID", "be_id", "billingEntityId", "Billing Entity ID", "billing_entity_id") ? String(getRowValue(row, "beId", "BE ID", "be_id", "billingEntityId", "Billing Entity ID", "billing_entity_id")) : undefined,
      billingEntityName: getRowValue(row, "billingEntityName", "Billing Entity Name", "billing_entity_name", "BE Name", "beName") ? String(getRowValue(row, "billingEntityName", "Billing Entity Name", "billing_entity_name", "BE Name", "beName")) : undefined,
    };
  });
}

/**
 * Parse SP Invoice Report sheet into typed rows
 */
function parseSPData(sheet: SheetData): SPRow[] {
  // Write debug info to a file for troubleshooting
  const debugInfo = {
    headers: sheet.headers,
    sampleRowKeys: sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : [],
    sampleRow: sheet.rows.length > 0 ? sheet.rows[0] : null,
  };
  fs.writeFileSync('/tmp/sp_data_debug.json', JSON.stringify(debugInfo, null, 2));
  
  return sheet.rows.map((row) => {
    const bookingId = getRowValue(row, "bookingId", "Booking ID", "booking_id");
    const netPrice = getRowValue(row, "netPrice", "Net Price", "net_price");
    const billingCurrency = getRowValue(row, "Billing Currency", "billingCurrency", "currency", "Currency");
    const fulfilmentDate = getRowValue(row, "fulfilmentDate", "Fulfilment Date", "fulfilment_date");
    const beId = getRowValue(row, "beId", "BE ID", "be_id", "billingEntityId", "Billing Entity ID", "billing_entity_id");
    const ticketId = getRowValue(row, "ticketId", "Ticket ID", "ticket_id", "Ticket Id", "ticketid");
    
    return {
      bookingId: String(bookingId || ""),
      netPrice: Number(netPrice) || 0,
      billingCurrency: String(billingCurrency || "USD"),
      fulfilmentDate: fulfilmentDate ? String(fulfilmentDate) : null,
      beId: beId ? String(beId) : undefined,
      ticketId: ticketId ? String(ticketId) : undefined,
    };
  });
}

/**
 * Parse date value safely, handles:
 * - ISO date strings like "2025-11-18 18:20:43"
 * - Excel serial numbers (days since 1899-12-30)
 * - Various date formats
 * Returns timestamp for comparison (higher = more recent)
 */
function parseDate(dateValue: string | number | null | undefined): number {
  if (dateValue === null || dateValue === undefined || dateValue === "") return 0;
  
  // Handle Excel serial numbers (numeric values)
  if (typeof dateValue === "number" || !isNaN(Number(dateValue))) {
    const numValue = Number(dateValue);
    // Excel dates are days since 1899-12-30 (with a bug for 1900 leap year)
    // Only treat as Excel serial if it looks like a reasonable date serial (> 40000 = ~2009+)
    if (numValue > 40000 && numValue < 60000) {
      // Convert Excel serial to JS timestamp
      // Excel epoch: Dec 30, 1899 (accounting for the 1900 leap year bug)
      const excelEpoch = new Date(1899, 11, 30).getTime();
      const msPerDay = 24 * 60 * 60 * 1000;
      return excelEpoch + numValue * msPerDay;
    }
    // Could also be a Unix timestamp in seconds or ms
    if (numValue > 1000000000000) {
      // Looks like milliseconds timestamp
      return numValue;
    }
    if (numValue > 1000000000) {
      // Looks like seconds timestamp
      return numValue * 1000;
    }
  }
  
  // Handle string dates
  const strValue = String(dateValue);
  const parsed = new Date(strValue);
  if (!isNaN(parsed.getTime())) {
    return parsed.getTime();
  }
  
  // Try some common formats
  // "DD/MM/YYYY HH:MM:SS" format
  const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/);
  if (dmyMatch) {
    const [, day, month, year, time] = dmyMatch;
    const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${time ? 'T' + time : ''}`;
    const parsed2 = new Date(isoStr);
    if (!isNaN(parsed2.getTime())) {
      return parsed2.getTime();
    }
  }
  
  return 0;
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
  beId?: string;
  ticketId?: string;
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
      beId: best.sp.beId,
      ticketId: best.sp.ticketId,
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
    // a) MTB rule: HO Net < SP Net (differencePct is negative) AND abs(differencePct) >= 95%
    // differencePct = (hoNet - spNet) / hoNet, so negative means SP claims more than HO
    if (differencePct <= -0.95) {
      return "Multiple Tickets Booked";
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
 * Get DRI team based on reason, fulfillment method, and price sync
 */
function getDriTeam(
  reason: string,
  fulfillmentMethod: string | undefined,
  priceSync: string | undefined
): string {
  const fm = (fulfillmentMethod || "").toLowerCase().trim();
  const ps = (priceSync || "").toLowerCase().trim();
  
  // Helper to check fulfillment method variants
  const isFreesale = fm === "freesale";
  const isManual = fm === "manual";
  const isSelenium = fm === "selenium";
  const isPrePurchase = fm === "pre purchase" || fm === "prepurchase" || fm === "pre-purchase" || fm === "pre_purchase";
  const isVendorApi = fm === "vendor api" || fm === "vendorapi" || fm === "vendor-api" || fm === "vendor_api";
  const isVendorRequest = fm === "vendor request" || fm === "vendorrequest" || fm === "vendor-request" || fm === "vendor_request";
  
  // MTB (Multiple Tickets Booked) - based on fulfillment method only
  if (reason === "Multiple Tickets Booked") {
    if (isFreesale) return "Tech";
    if (isManual) return "Reservation Ops";
    if (isSelenium) return "Selenium";
    if (isPrePurchase) return "Inventory Ops";
    if (isVendorApi) return "Tech";
    if (isVendorRequest) return "Tech";
    return "Unknown";
  }
  
  // NPD (Net Price Discrepancy) - based on fulfillment method and price sync
  if (reason === "Net Price Discrepancy") {
    if (isFreesale) return "Biz Ops";
    if (isManual) return "Biz Ops";
    if (isSelenium) return "Selenium";
    if (isPrePurchase) return "Inventory Ops";
    if (isVendorApi) {
      if (ps === "yes") return "Inventory Ops";
      return "Biz Ops"; // No or blank
    }
    if (isVendorRequest) return "Tech";
    return "Unknown";
  }
  
  // For other reasons, default to Unknown
  return "Unknown";
}

/**
 * STEP E-F: Compute reconciliation fields on Primary HO rows only
 * Secondary rows are completely excluded from analysis
 */
function computeReconciliationRows(
  primaryHoRowByBookingId: Map<string, HORow>,
  spByBookingId: Map<string, SPBundle>,
  usdToCcy: Record<string, number>
): PrimaryRow[] {
  const primaryRows: PrimaryRow[] = [];
  
  Array.from(primaryHoRowByBookingId.entries()).forEach(([bookingId, ho]) => {
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
    
    // STEP G: Assign reason
    const reason = assignReason(
      ho.bookingStatus,
      ho.cancellable,
      ho.cancellationInsurance,
      differenceLc,
      differencePct,
      sameCurrency,
      spNetInHo
    );
    
    // Compute DRI team based on reason and fulfillment method
    const driTeam = getDriTeam(reason, ho.fulfillmentMethod, ho.priceSync);
    
    primaryRows.push({
      bookingId,
      fulfillmentIdentifier: "Primary",
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
      tid: ho.tid,
      fulfillmentMethod: ho.fulfillmentMethod,
      driTeam,
      headoutSellingPrice: ho.headoutSellingPrice,
      beId: spBundle?.beId || ho.beId,
      billingEntityName: ho.billingEntityName,
      ticketId: spBundle?.ticketId,
    });
  });
  
  return primaryRows;
}

/**
 * STEP H: Build overall summary (Primary only + Unmapped)
 */
function buildOverallSummary(
  primaryRows: PrimaryRow[],
  unmappedSP: SPRow[],
  usdToCcy: Record<string, number>
): OverallSummaryRow[] {
  // All rows passed in are already Primary only (no filtering needed)
  
  // Group Primary rows by (reason, hoCurrency)
  const summaryMap = new Map<string, OverallSummaryRow>();
  const bidsByKey = new Map<string, Set<string>>();
  
  for (const row of primaryRows) {
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
  
  // STEP E-G: Compute reconciliation rows (Primary only, Secondary excluded)
  const primaryRows = computeReconciliationRows(
    primaryHoRowByBookingId,
    spByBookingId,
    usdToCcy
  );
  
  // Sort by differenceUsd ascending
  primaryRows.sort((a, b) => a.differenceUsd - b.differenceUsd);
  
  // Convert unmapped SP rows to PrimaryRow format for Amount Payable Calculator
  const unmappedRows: PrimaryRow[] = unmappedSP.map(sp => {
    const spCurrency = sp.billingCurrency;
    const spNetOriginal = sp.netPrice;
    // For unmapped, use SP currency as HO currency equivalent (no conversion)
    const usdRate = usdToCcy[spCurrency] || 1;
    // Difference = HO Net - SP Net = 0 - spNetOriginal (negative when SP claims more)
    const differenceLc = -spNetOriginal;
    const differenceUsd = differenceLc / usdRate;
    
    return {
      bookingId: sp.bookingId,
      fulfillmentIdentifier: "Primary" as const,
      hoNet: 0, // No HO match
      hoCurrency: spCurrency, // Use SP currency as placeholder
      bookingCreationDate: null,
      bookingStatus: "Unknown",
      cancellable: null,
      cancellationInsurance: null,
      spNetOriginal,
      spCurrency,
      spNetInHo: spNetOriginal, // Same as original since no conversion
      fxRateUsed: 1,
      sameCurrency: true,
      differenceLc, // 0 - SP Net (negative = HO owes SP)
      differencePct: null,
      differenceUsd,
      reason: "Unmapped",
      beId: sp.beId,
      ticketId: sp.ticketId,
    };
  });
  
  // Build overall summary (Primary only + Unmapped)
  const overallSummary = buildOverallSummary(primaryRows, unmappedSP, usdToCcy);
  
  return {
    fx,
    overallSummary,
    primaryRows,
    unmappedRows, // New: unmapped bookings for Amount Payable Calculator
    allRows: primaryRows, // allRows now same as primaryRows (no Secondary)
    spFxDebugRows: augmentedSP,
  };
}

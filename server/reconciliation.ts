/**
 * Reconciliation Pipeline
 * Implements Steps B through I from the specification
 */

import fs from 'fs';
import type {
  FxData,
  SpFxDebugRow,
  PrimaryRow,
  PaxBreakdown,
  OverallSummaryRow,
  RunResult,
  SheetData,
} from "@shared/schema";
import { storage } from "./storage";

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
  chargedLoss: string | null;
  comment: string | null;
  experienceName?: string;
  supplierName?: string;
  tid?: string;
  fulfillmentMethod?: string;
  driTeam?: string;
  headoutSellingPrice?: number;
  priceSync?: string;
  beId?: string;
  billingEntityName?: string;
  paymentBasis?: string;
  paymentMethod?: string;
  // Already Reconciled detection
  hoReason?: string;
  dateOfPayment?: string;
  // Vendor ID for correction
  vid?: string;
  // Pax type breakdown
  paxBreakdown?: PaxBreakdown[];
  // Experience date
  experienceDate?: string | null;
}

// Result from reason assignment
interface ReasonResult {
  reason: string;
  chargedLoss: string;
  comment: string;
  // Already Reconciled sub-classification
  alreadyReconciledType?: "same_be" | "different_be";
  // Cross-cutting Secondary Vendor flag (BE ID mismatch)
  isSecondaryVendor: boolean;
}

// SP Row from parsed sheet
interface SPRow {
  bookingId: string;
  netPrice: number;
  billingCurrency: string;
  fulfilmentDate?: string | null;
  beId?: string;
  ticketId?: string;
  dateOfPayment?: string | null;
  paymentMethod?: string;
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
function parseHOData(sheet: SheetData, paxTypeNames: string[] = []): HORow[] {
  const rowKeys = sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : sheet.headers;
  const normalizedKeys = rowKeys.map(k => k.toLowerCase().replace(/\s+/g, "_"));
  
  const detectedPaxColumns: { paxType: string; countKey: string | null; unitPriceKey: string | null; priceNetKey: string | null }[] = [];

  // Auto-detect pax types from column headers: any column ending in _count is a potential pax type
  const autoDetectedPaxTypes = new Set<string>();
  for (const nk of normalizedKeys) {
    if (nk.endsWith("_count")) {
      const paxName = nk.replace(/_count$/, "");
      if (paxName) autoDetectedPaxTypes.add(paxName);
    }
  }

  // Merge with pre-configured pax type names (if any) for backward compatibility
  const configuredPaxTypes = paxTypeNames.map(name => name.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_"));
  configuredPaxTypes.forEach(pt => autoDetectedPaxTypes.add(pt));

  const allPaxTypes = Array.from(autoDetectedPaxTypes);
  for (const pt of allPaxTypes) {
    const countSuffix = `${pt}_count`;
    const unitPriceSuffix = `${pt}_unit_price`;
    const priceNetSuffix = `${pt}_price_net`;
    
    let countKey: string | null = null;
    let unitPriceKey: string | null = null;
    let priceNetKey: string | null = null;
    
    for (let i = 0; i < normalizedKeys.length; i++) {
      if (normalizedKeys[i] === countSuffix) countKey = rowKeys[i];
      if (normalizedKeys[i] === unitPriceSuffix) unitPriceKey = rowKeys[i];
      if (normalizedKeys[i] === priceNetSuffix) priceNetKey = rowKeys[i];
    }
    
    if (countKey && (unitPriceKey || priceNetKey)) {
      detectedPaxColumns.push({ paxType: pt, countKey, unitPriceKey, priceNetKey });
    }
  }
  
  const excelSerialToDateString = (val: unknown): string | null => {
    if (val === null || val === undefined || val === "") return null;
    if (val instanceof Date) {
      return val.toISOString();
    }
    const str = String(val);
    if (!isNaN(Date.parse(str))) return str;
    const num = Number(val);
    if (!isNaN(num) && num > 10000 && num < 100000) {
      const epoch = new Date((num - 25569) * 86400000);
      if (!isNaN(epoch.getTime())) return epoch.toISOString();
    }
    return str || null;
  };

  return sheet.rows.map((row) => {
    const bookingCreationDate = getRowValue(row, "bookingCreationDate", "Booking Creation Date", "booking_creation_date", "creationDate");
    const bookingId = getRowValue(row, "bookingId", "Booking ID", "booking_id");
    const netPrice = getRowValue(row, "netPrice", "Net Price", "net_price", "finalNetPrice", "Final Net Price");
    const currency = getRowValue(row, "currency", "Currency", "Billing Currency");
    const bookingStatus = getRowValue(row, "bookingStatus", "Booking Status", "booking_status", "status");
    
    const chargedLoss = getRowValue(row, "chargedLoss", "Charged Loss", "charged_loss", "charge_loss");
    const commentValue = getRowValue(row, "comment", "Comment", "comments", "Comments", "notes", "Notes");
    
    return {
      bookingId: String(bookingId || ""),
      netPrice: Number(netPrice) || 0,
      currency: String(currency || "USD"),
      bookingCreationDate: excelSerialToDateString(bookingCreationDate),
      bookingStatus: String(bookingStatus || ""),
      cancellable: getRowValue(row, "Cancellable", "cancellable") ? String(getRowValue(row, "Cancellable", "cancellable")) : null,
      cancellationInsurance: getRowValue(row, "Cancellation Insurance", "cancellationInsurance") ? String(getRowValue(row, "Cancellation Insurance", "cancellationInsurance")) : null,
      chargedLoss: chargedLoss ? String(chargedLoss) : null,
      comment: commentValue ? String(commentValue) : null,
      experienceName: getRowValue(row, "experienceName", "Experience Name") ? String(getRowValue(row, "experienceName", "Experience Name")) : undefined,
      supplierName: getRowValue(row, "vendorName", "supplierName", "Vendor Name", "Supplier Name") ? String(getRowValue(row, "vendorName", "supplierName", "Vendor Name", "Supplier Name")) : undefined,
      tid: getRowValue(row, "tid", "TID", "tourId", "Tour ID", "tour_id") ? String(getRowValue(row, "tid", "TID", "tourId", "Tour ID", "tour_id")) : undefined,
      fulfillmentMethod: getRowValue(row, "fulfillmentMethod", "Fulfillment Method", "fulfilmentMethod", "Fulfilment Method") ? String(getRowValue(row, "fulfillmentMethod", "Fulfillment Method", "fulfilmentMethod", "Fulfilment Method")) : undefined,
      driTeam: getRowValue(row, "driTeam", "DRI Team", "dri_team", "DRI") ? String(getRowValue(row, "driTeam", "DRI Team", "dri_team", "DRI")) : undefined,
      headoutSellingPrice: Number(getRowValue(row, "headoutSellingPrice", "Headout Selling Price", "headout_selling_price", "sellingPrice", "Selling Price")) || undefined,
      priceSync: getRowValue(row, "priceSync", "Price Sync", "price_sync", "PriceSync") ? String(getRowValue(row, "priceSync", "Price Sync", "price_sync", "PriceSync")) : undefined,
      beId: getRowValue(row, "beId", "BE ID", "be_id", "billingEntityId", "Billing Entity ID", "billing_entity_id") ? String(getRowValue(row, "beId", "BE ID", "be_id", "billingEntityId", "Billing Entity ID", "billing_entity_id")) : undefined,
      billingEntityName: getRowValue(row, "billingEntityName", "Billing Entity Name", "billing_entity_name", "BE Name", "beName") ? String(getRowValue(row, "billingEntityName", "Billing Entity Name", "billing_entity_name", "BE Name", "beName")) : undefined,
      paymentBasis: getRowValue(row, "paymentBasis", "Payment Basis", "payment_basis", "PaymentBasis") ? String(getRowValue(row, "paymentBasis", "Payment Basis", "payment_basis", "PaymentBasis")) : undefined,
      paymentMethod: getRowValue(row, "paymentMethod", "Payment Method", "payment_method", "PaymentMethod") ? String(getRowValue(row, "paymentMethod", "Payment Method", "payment_method", "PaymentMethod")) : undefined,
      // Already Reconciled detection - capture "reason" column from HO data
      hoReason: getRowValue(row, "reason", "Reason", "reconReason", "Recon Reason", "reconciliation_reason") ? String(getRowValue(row, "reason", "Reason", "reconReason", "Recon Reason", "reconciliation_reason")) : undefined,
      dateOfPayment: excelSerialToDateString(getRowValue(row, "dateOfPayment", "Date of Payment", "date_of_payment", "paymentDate", "Payment Date")) || undefined,
      // Vendor ID for correction
      vid: getRowValue(row, "vid", "VID", "vendorId", "Vendor ID", "vendor_id") ? String(getRowValue(row, "vid", "VID", "vendorId", "Vendor ID", "vendor_id")) : undefined,
      // Experience date
      experienceDate: excelSerialToDateString(getRowValue(row, "experienceDate", "Experience Date", "experience_date", "fulfilmentDate", "Fulfilment Date", "tour_date", "Travel Date")),
      // Pax type breakdown
      paxBreakdown: detectedPaxColumns.length > 0 ? extractPaxBreakdown(row, detectedPaxColumns) : undefined,
    };
  });
}

/**
 * Extract pax type breakdown from a single HO row
 */
function extractPaxBreakdown(
  row: Record<string, unknown>,
  paxColumns: { paxType: string; countKey: string | null; unitPriceKey: string | null; priceNetKey: string | null }[]
): PaxBreakdown[] {
  const breakdowns: PaxBreakdown[] = [];
  for (const col of paxColumns) {
    const count = col.countKey ? Number(row[col.countKey]) || 0 : 0;
    if (count === 0) continue; // Skip pax types with zero count for this booking
    const unitPrice = col.unitPriceKey ? Number(row[col.unitPriceKey]) || 0 : 0;
    const priceNet = col.priceNetKey ? Number(row[col.priceNetKey]) || 0 : count * unitPrice;
    breakdowns.push({
      paxType: col.paxType,
      count,
      unitPrice,
      priceNet,
    });
  }
  return breakdowns;
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
    
    const dateOfPayment = getRowValue(row, "dateOfPayment", "Date of Payment", "date_of_payment", "paymentDate", "Payment Date");
    const paymentMethod = getRowValue(row, "paymentMethod", "Payment Method", "payment_method", "PaymentMethod");
    
    return {
      bookingId: String(bookingId || ""),
      netPrice: Number(netPrice) || 0,
      billingCurrency: String(billingCurrency || "USD"),
      fulfilmentDate: fulfilmentDate ? String(fulfilmentDate) : null,
      beId: beId ? String(beId) : undefined,
      ticketId: ticketId ? String(ticketId) : undefined,
      dateOfPayment: dateOfPayment ? String(dateOfPayment) : null,
      paymentMethod: paymentMethod ? String(paymentMethod) : undefined,
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
  dateOfPayment?: string | null;
  paymentMethod?: string;
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
      dateOfPayment: best.sp.dateOfPayment,
      paymentMethod: best.sp.paymentMethod,
    });
  });
  
  return spByBookingId;
}

/**
 * STEP G: Reason logic for Primary rows
 * Updated to return reason, chargedLoss, comment, and isSecondaryVendor flag
 * 
 * Primary reason priority (highest to lowest):
 * 1) Already Reconciled - check HO reason column
 * 2) Cancellations - cancelled booking handling
 * 3) MTB (Multiple Tickets Booked) - large percentage difference
 * 4) NPD (Net Price Discrepancy) - amounts don't reconcile
 * 5) Reconciled - amounts within tolerance
 * 
 * Cross-cutting check (applies to ALL bookings independently):
 * - isSecondaryVendor: true if HO BE ID != SP BE ID (BE mismatch)
 */
function assignReason(
  bookingStatus: string,
  cancellable: string | null,
  cancellationInsurance: string | null,
  chargedLossOriginal: string | null,
  differenceLc: number,
  differencePct: number | null,
  sameCurrency: boolean,
  spNetInHo: number,
  hoBeId: string | undefined,
  spBeId: string | undefined,
  hoReason: string | undefined
): ReasonResult {
  // Normalize chargedLoss to check if it's already TRUE
  const isChargedLossTrue = chargedLossOriginal?.toUpperCase() === "TRUE";
  
  // Secondary Vendor check: HO BE ID ≠ SP BE ID
  // When true, booking is grouped under Secondary Vendor section (same reasons, just different section)
  let isSecondaryVendor = false;
  if (hoBeId && spBeId && hoBeId.trim() !== "" && spBeId.trim() !== "") {
    const normalizedHoBeId = hoBeId.trim().toLowerCase();
    const normalizedSpBeId = spBeId.trim().toLowerCase();
    if (normalizedHoBeId !== normalizedSpBeId) {
      isSecondaryVendor = true;
    }
  }
  
  // 1) Already Reconciled - check HO reason column
  // Values: "Already Auto Reconciled" or "Already Manually Reconciled"
  if (hoReason) {
    const normalizedHoReason = hoReason.trim().toLowerCase();
    if (normalizedHoReason === "already auto reconciled" || normalizedHoReason === "already manually reconciled") {
      // Sub-classify based on BE ID match
      const hoBeNorm = (hoBeId || "").trim().toLowerCase();
      const spBeNorm = (spBeId || "").trim().toLowerCase();
      
      // Check if BE IDs match (both must exist for comparison)
      if (hoBeNorm && spBeNorm && hoBeNorm === spBeNorm) {
        return {
          reason: "Already Reconciled-Same BE",
          chargedLoss: chargedLossOriginal || "FALSE",
          comment: hoReason,
          alreadyReconciledType: "same_be",
          isSecondaryVendor
        };
      } else {
        // Different BE or one is missing
        return {
          reason: "Already Reconciled-Different BE",
          chargedLoss: chargedLossOriginal || "FALSE",
          comment: hoReason,
          alreadyReconciledType: "different_be",
          isSecondaryVendor
        };
      }
    }
  }
  
  // 2) Cancelled cases - NEW LOGIC per user requirements
  if (bookingStatus.toLowerCase() === "cancelled") {
    // Case 1: Cancellable = "Yes"
    if (cancellable?.toLowerCase() === "yes") {
      if (spNetInHo === 0) {
        // SP Net = 0 → Reconciled, Comment = "Cancelled-OK"
        return {
          reason: "Reconciled",
          chargedLoss: chargedLossOriginal || "FALSE",
          comment: "Cancelled-OK",
          isSecondaryVendor
        };
      } else {
        // SP Net > 0 → "Cancelled-SP error", chargedLoss = TRUE
        return {
          reason: "Cancelled-SP error",
          chargedLoss: "TRUE",
          comment: "Cancelled-SP error",
          isSecondaryVendor
        };
      }
    }
    
    // Case 2: Cancellable = "No"
    if (cancellable?.toLowerCase() === "no") {
      if (spNetInHo === 0) {
        // SP Net = 0 → Reconciled, Comment = "Cancelled-OK"
        return {
          reason: "Reconciled",
          chargedLoss: chargedLossOriginal || "FALSE",
          comment: "Cancelled-OK",
          isSecondaryVendor
        };
      } else {
        // SP Net > 0 - check Cancellation Insurance
        if (cancellationInsurance?.toLowerCase() === "yes") {
          // Cancellation Insurance = "Yes" → Cancelled-Insured Booking, chargedLoss = TRUE
          return {
            reason: "Cancelled-Insured Booking",
            chargedLoss: "TRUE",
            comment: "Cancelled-Insured Booking",
            isSecondaryVendor
          };
        } else {
          // Cancellation Insurance = "No" - check chargedLoss
          if (isChargedLossTrue) {
            // chargedLoss = TRUE → "Cancelled-DSS policy"
            return {
              reason: "Cancelled-DSS policy",
              chargedLoss: "TRUE",
              comment: "Cancelled-DSS policy",
              isSecondaryVendor
            };
          } else {
            // chargedLoss = FALSE → "Cancelled-Check for Charge loss"
            return {
              reason: "Cancelled-Check for Charge loss",
              chargedLoss: "FALSE",
              comment: "Cancelled-Check for Charge loss",
              isSecondaryVendor
            };
          }
        }
      }
    }
    
    // Default for cancelled (if Cancellable field is missing/other)
    return {
      reason: "Reconciled",
      chargedLoss: chargedLossOriginal || "FALSE",
      comment: "Cancelled-OK",
      isSecondaryVendor
    };
  }
  
  // 3) MTB (Multiple Tickets Booked) - for non-cancelled cases
  if (differencePct !== null) {
    // MTB rule: HO Net < SP Net (differencePct is negative) AND abs(differencePct) >= 95%
    if (differencePct <= -0.95) {
      return {
        reason: "Multiple Tickets Booked",
        chargedLoss: chargedLossOriginal || "FALSE",
        comment: "",
        isSecondaryVendor
      };
    }
    
    // 4) Reconciled rules (small differences)
    // Check if amounts are within tolerance
    const isReconciled = sameCurrency 
      ? (Math.abs(differenceLc) < 1 && Math.abs(differencePct) < 0.01)
      : (Math.abs(differencePct) < 0.03);
    
    if (isReconciled) {
      return {
        reason: "Reconciled",
        chargedLoss: chargedLossOriginal || "FALSE",
        comment: "",
        isSecondaryVendor
      };
    }
  }
  
  // 5) NPD - Net Price Discrepancy (amounts don't reconcile)
  // This is the fallback for non-matching amounts
  return {
    reason: "Net Price Discrepancy",
    chargedLoss: chargedLossOriginal || "FALSE",
    comment: "",
    isSecondaryVendor
  };
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
  
  // MTB (Multiple Tickets Booked) and Cancelled-SP error - based on fulfillment method only
  // Cancelled-SP error uses the same DRI logic as MTB
  if (reason === "Multiple Tickets Booked" || reason === "Cancelled-SP error") {
    if (isFreesale) return "Tech";
    if (isManual) return "Reservation Ops";
    if (isSelenium) return "Selenium";
    if (isPrePurchase) return "Inventory Ops";
    if (isVendorApi) return "Tech";
    if (isVendorRequest) return "Tech";
    return "Unknown";
  }
  
  // Secondary Vendor (BE ID mismatch) - highest priority, needs Supply team review
  if (reason === "Secondary Vendor") {
    return "Supply";
  }
  
  // Already Reconciled - needs Finance/Biz Ops review to determine payment decision
  if (reason === "Already Reconciled-Same BE" || reason === "Already Reconciled-Different BE") {
    return "Finance";
  }
  
  // Cancelled-Insured Booking and Cancelled-DSS policy - no action needed, informational only
  if (reason === "Cancelled-Insured Booking" || reason === "Cancelled-DSS policy") {
    return "N/A";
  }
  
  // Cancelled-Check for Charge loss - needs review by Biz Ops
  if (reason === "Cancelled-Check for Charge loss") {
    return "Biz Ops";
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
    
    // STEP G: Assign reason (now returns ReasonResult with chargedLoss, comment, and isSecondaryVendor flag)
    // Primary reason priority: Already Reconciled → Cancelled → MTB → NPD → Reconciled
    // Cross-cutting: isSecondaryVendor checked independently for all bookings
    const reasonResult = assignReason(
      ho.bookingStatus,
      ho.cancellable,
      ho.cancellationInsurance,
      ho.chargedLoss,
      differenceLc,
      differencePct,
      sameCurrency,
      spNetInHo,
      ho.beId,
      spBundle?.beId,
      ho.hoReason
    );
    
    // Compute DRI team based on reason and fulfillment method
    const driTeam = getDriTeam(reasonResult.reason, ho.fulfillmentMethod, ho.priceSync);
    
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
      reason: reasonResult.reason,
      experienceName: ho.experienceName,
      supplierName: ho.supplierName,
      tid: ho.tid,
      fulfillmentMethod: ho.fulfillmentMethod,
      driTeam,
      headoutSellingPrice: ho.headoutSellingPrice,
      beId: spBundle?.beId || ho.beId,
      billingEntityName: ho.billingEntityName,
      ticketId: spBundle?.ticketId,
      paymentBasis: ho.paymentBasis,
      paymentMethod: ho.paymentMethod,
      chargedLoss: reasonResult.chargedLoss,
      comment: reasonResult.comment,
      // Already Reconciled fields
      alreadyReconciledType: reasonResult.alreadyReconciledType,
      hoReason: ho.hoReason,
      dateOfPayment: ho.dateOfPayment,
      spDateOfPayment: spBundle?.dateOfPayment || undefined,
      spPaymentMethod: spBundle?.paymentMethod,
      hoBeId: ho.beId, // Store HO BE ID for comparison display
      vid: ho.vid, // Store HO Vendor ID for Vendor ID correction
      // Secondary Vendor flag (cross-cutting check)
      isSecondaryVendor: reasonResult.isSecondaryVendor,
      spBeId: spBundle?.beId, // Store SP BE ID for comparison display
      // Pax type breakdown from HO data
      paxBreakdown: ho.paxBreakdown,
      // Experience date from HO data
      experienceDate: ho.experienceDate || undefined,
    });
  });
  
  return primaryRows;
}

/**
 * STEP H: Build overall summary (Primary only + Unmapped)
 */
/**
 * Build summary from a set of rows (groups by reason + currency)
 */
function buildSummaryFromRows(
  rows: PrimaryRow[],
  unmappedSP: SPRow[] | null,
  usdToCcy: Record<string, number>
): OverallSummaryRow[] {
  // Group rows by (reason, hoCurrency)
  const summaryMap = new Map<string, OverallSummaryRow>();
  const bidsByKey = new Map<string, Set<string>>();
  
  for (const row of rows) {
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
  
  // Add Unmapped groups by spCurrency (only for primary summary)
  if (unmappedSP && unmappedSP.length > 0) {
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
  }
  
  // Convert to array and sort by discrepancyUsd ascending
  const summaryRows = Array.from(summaryMap.values());
  summaryRows.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
  
  return summaryRows;
}

/**
 * Build overall summaries split by Primary vs Secondary Vendor
 */
function buildOverallSummaries(
  allRows: PrimaryRow[],
  unmappedSP: SPRow[],
  usdToCcy: Record<string, number>
): { primarySummary: OverallSummaryRow[]; secondaryVendorSummary: OverallSummaryRow[] } {
  // Split rows by isSecondaryVendor flag
  const primaryVendorRows = allRows.filter(r => !r.isSecondaryVendor);
  const secondaryVendorRows = allRows.filter(r => r.isSecondaryVendor);
  
  // Build summary for Primary Vendor (includes Unmapped)
  const primarySummary = buildSummaryFromRows(primaryVendorRows, unmappedSP, usdToCcy);
  
  // Build summary for Secondary Vendor (no Unmapped - those don't have BE ID to compare)
  const secondaryVendorSummary = buildSummaryFromRows(secondaryVendorRows, null, usdToCcy);
  
  return { primarySummary, secondaryVendorSummary };
}

/**
 * Main reconciliation function
 */
export async function runReconciliation(
  hoData: SheetData,
  spData: SheetData
): Promise<RunResult> {
  // Fetch FX rates and pax types in parallel
  const [fx, paxTypes] = await Promise.all([
    fetchFxRates(),
    storage.getPaxTypes(),
  ]);
  const { usdToCcy } = fx;
  const paxTypeNames = paxTypes.map(pt => pt.name);
  
  // Parse sheets
  const hoRows = parseHOData(hoData, paxTypeNames);
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
  
  // STEP E-G: Compute reconciliation rows (all rows with isSecondaryVendor flag)
  const allReconciliationRows = computeReconciliationRows(
    primaryHoRowByBookingId,
    spByBookingId,
    usdToCcy
  );
  
  // Sort by differenceUsd ascending
  allReconciliationRows.sort((a, b) => a.differenceUsd - b.differenceUsd);
  
  // Split rows by Secondary Vendor flag
  const primaryRows = allReconciliationRows.filter(r => !r.isSecondaryVendor);
  const secondaryVendorRows = allReconciliationRows.filter(r => r.isSecondaryVendor);
  
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
  
  // Build overall summaries split by Primary vs Secondary Vendor
  const { primarySummary, secondaryVendorSummary } = buildOverallSummaries(
    allReconciliationRows,
    unmappedSP,
    usdToCcy
  );
  
  return {
    fx,
    overallSummary: primarySummary,
    secondaryVendorSummary,
    primaryRows,
    secondaryVendorRows,
    unmappedRows,
    allRows: allReconciliationRows, // All rows for DRI/drafts
    spFxDebugRows: augmentedSP,
  };
}

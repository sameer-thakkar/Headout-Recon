import { storage } from "./storage";

/**
 * Sanitize a sheet name for Excel compatibility.
 * Excel sheet names cannot contain: : \ / ? * [ ]
 * Also truncates to 31 characters (Excel limit)
 */
export function sanitizeSheetName(name: string): string {
  return name
    .replace(/[:\\/?\*\[\]]/g, "_")
    .substring(0, 31);
}

/**
 * Get a unique sheet name by appending a number if the name already exists.
 * Tracks used names in the provided Set and updates it.
 */
export function getUniqueSheetName(baseName: string, usedNames: Set<string>): string {
  let sanitized = sanitizeSheetName(baseName);
  let finalName = sanitized;
  let counter = 1;
  
  while (usedNames.has(finalName)) {
    const suffix = `_${counter}`;
    const maxBaseLength = 31 - suffix.length;
    finalName = sanitized.substring(0, maxBaseLength) + suffix;
    counter++;
  }
  
  usedNames.add(finalName);
  return finalName;
}

/**
 * Format a number in Indian notation (1,00,000.00)
 * Uses lakhs/crores grouping: X,XX,XX,XXX.XX
 */
export function formatIndianNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  
  let num: number;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "");
    num = parseFloat(cleaned);
  } else {
    num = value;
  }
  
  if (isNaN(num)) return String(value);
  
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const [intPart, decPart] = absNum.toFixed(2).split(".");
  
  let result = "";
  const len = intPart.length;
  
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    
    while (remaining.length > 0) {
      const chunk = remaining.slice(-2);
      result = chunk + "," + result;
      remaining = remaining.slice(0, -2);
    }
  }
  
  return (isNegative ? "-" : "") + result + "." + decPart;
}

/**
 * Format date value to DD/MM/YYYY format
 * Handles Excel serial numbers, ISO dates, and DD/MM/YYYY strings
 * Uses UTC to avoid timezone issues
 */
export function formatDateValue(dateValue: string | number | null | undefined): string {
  if (dateValue === null || dateValue === undefined || dateValue === "") return "";
  
  let day: number, month: number, year: number;
  
  if (typeof dateValue === "number" || (!isNaN(Number(dateValue)) && String(dateValue).match(/^[\d.]+$/))) {
    const numValue = Number(dateValue);
    if (numValue > 40000 && numValue < 60000) {
      const excelEpochMs = Date.UTC(1899, 11, 30);
      const msPerDay = 24 * 60 * 60 * 1000;
      const date = new Date(excelEpochMs + numValue * msPerDay);
      day = date.getUTCDate();
      month = date.getUTCMonth() + 1;
      year = date.getUTCFullYear();
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    } else if (numValue > 1000000000000) {
      const date = new Date(numValue);
      day = date.getUTCDate();
      month = date.getUTCMonth() + 1;
      year = date.getUTCFullYear();
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    } else if (numValue > 1000000000) {
      const date = new Date(numValue * 1000);
      day = date.getUTCDate();
      month = date.getUTCMonth() + 1;
      year = date.getUTCFullYear();
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    }
  }
  
  const strValue = String(dateValue).trim();
  
  const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    day = parseInt(dmyMatch[1], 10);
    month = parseInt(dmyMatch[2], 10);
    year = parseInt(dmyMatch[3], 10);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  
  const isoMatch = strValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  
  const mdyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    day = parseInt(mdyMatch[1], 10);
    month = parseInt(mdyMatch[2], 10);
    year = parseInt(mdyMatch[3], 10);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  
  return strValue;
}

export interface ExportData {
  run: any;
  result: any;
  upload: any;
  originalHoData: Record<string, unknown>[];
  originalSpData: Record<string, unknown>[];
  allRowsMap: Map<string, any[]>;
  spFxMap: Map<string, any>;
  allDisputes: any[];
  disputesByBooking: Map<string, any>;
  disputeOverrides: Record<string, any>;
  priceOverrides: Record<string, any>;
}

export interface ExcelExportData extends ExportData {
  vendorCorrections: any[];
  vendorCorrectionsByBooking: Map<string, string>;
  spTicketIdByBooking: Map<string, string>;
}

/**
 * Fetch and prepare common export data shared by all export types.
 * Returns null with error response if validation fails.
 */
export async function getExportData(runId: string, res: any): Promise<ExportData | null> {
  const run = await storage.getRun(runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return null;
  }

  if (run.status !== "done") {
    res.status(400).json({ error: "Run not complete" });
    return null;
  }

  const result = await storage.getRunResult(runId);
  if (!result) {
    res.status(404).json({ error: "Results not found" });
    return null;
  }

  const upload = await storage.getUpload(run.uploadId);
  const originalHoData = upload?.hoData?.rows || [];
  const originalSpData = upload?.spData?.rows || [];

  const allDisputes = await storage.getDisputes(runId);
  const disputesByBooking = new Map<string, typeof allDisputes[0]>();
  for (const d of allDisputes) {
    disputesByBooking.set(d.bookingId, d);
  }

  const disputeOverrides = await storage.getDisputeOverrides(runId);
  const priceOverrides = await storage.getPriceOverrides(runId);

  const allRowsMap = new Map<string, typeof result.allRows[0][]>();
  for (const r of result.allRows) {
    const existing = allRowsMap.get(r.bookingId) || [];
    existing.push(r);
    allRowsMap.set(r.bookingId, existing);
  }
  const spFxMap = new Map(result.spFxDebugRows.map((r: any) => [r.bookingId, r]));

  return {
    run,
    result,
    upload,
    originalHoData,
    originalSpData,
    allRowsMap,
    spFxMap,
    allDisputes,
    disputesByBooking,
    disputeOverrides,
    priceOverrides,
  };
}

/**
 * Fetch additional data needed only for Excel exports.
 */
export async function getExcelExportData(runId: string, res: any): Promise<ExcelExportData | null> {
  const base = await getExportData(runId, res);
  if (!base) return null;

  const vendorCorrections = await storage.getVendorCorrections(runId);
  const vendorCorrectionsByBooking = new Map<string, string>();
  for (const vc of vendorCorrections) {
    vendorCorrectionsByBooking.set(vc.bookingId, vc.finalVendorId);
  }

  const spTicketIdByBooking = new Map<string, string>();
  for (const spRow of base.originalSpData) {
    const row = spRow as Record<string, unknown>;
    const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
    const ticketId = String(row["ticketId"] || row["Ticket ID"] || row["ticket_id"] || row["TicketID"] || "");
    if (bookingId && ticketId) {
      spTicketIdByBooking.set(bookingId, ticketId);
    }
  }

  return {
    ...base,
    vendorCorrections,
    vendorCorrectionsByBooking,
    spTicketIdByBooking,
  };
}

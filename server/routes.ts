import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, sessionStorage } from "./storage";
import { randomUUID } from "crypto";
import multer from "multer";
import XLSX from "xlsx-js-style";
import path from "path";
import fs from "fs";
import type { UploadedFile, SheetData, FxRate } from "@shared/schema";
import { runReconciliation } from "./reconciliation";
import { getUncachableGoogleSheetClient } from "./google-sheets";

/**
 * Sanitize a sheet name for Excel compatibility.
 * Excel sheet names cannot contain: : \ / ? * [ ]
 * Also truncates to 31 characters (Excel limit)
 */
function sanitizeSheetName(name: string): string {
  return name
    .replace(/[:\\/?\*\[\]]/g, "_")
    .substring(0, 31);
}

/**
 * Get a unique sheet name by appending a number if the name already exists.
 * Tracks used names in the provided Set and updates it.
 */
function getUniqueSheetName(baseName: string, usedNames: Set<string>): string {
  let sanitized = sanitizeSheetName(baseName);
  let finalName = sanitized;
  let counter = 1;
  
  while (usedNames.has(finalName)) {
    // Reserve space for the suffix (e.g., "_2") within 31 char limit
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
function formatIndianNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  
  // Handle already formatted strings (strip commas before parsing)
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
  
  // Indian grouping: first 3 digits from right, then groups of 2
  let result = "";
  const len = intPart.length;
  
  if (len <= 3) {
    result = intPart;
  } else {
    // Last 3 digits
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    
    // Groups of 2 from right
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
function formatDateValue(dateValue: string | number | null | undefined): string {
  if (dateValue === null || dateValue === undefined || dateValue === "") return "";
  
  let day: number, month: number, year: number;
  
  // Handle Excel serial numbers (numeric)
  if (typeof dateValue === "number" || (!isNaN(Number(dateValue)) && String(dateValue).match(/^[\d.]+$/))) {
    const numValue = Number(dateValue);
    if (numValue > 40000 && numValue < 60000) {
      // Excel serial date: days since 1899-12-30
      // Use UTC to avoid timezone shifts
      const excelEpochMs = Date.UTC(1899, 11, 30);
      const msPerDay = 24 * 60 * 60 * 1000;
      const date = new Date(excelEpochMs + numValue * msPerDay);
      day = date.getUTCDate();
      month = date.getUTCMonth() + 1;
      year = date.getUTCFullYear();
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    } else if (numValue > 1000000000000) {
      // Milliseconds timestamp
      const date = new Date(numValue);
      day = date.getUTCDate();
      month = date.getUTCMonth() + 1;
      year = date.getUTCFullYear();
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    } else if (numValue > 1000000000) {
      // Seconds timestamp
      const date = new Date(numValue * 1000);
      day = date.getUTCDate();
      month = date.getUTCMonth() + 1;
      year = date.getUTCFullYear();
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    }
  }
  
  // Handle string dates
  const strValue = String(dateValue).trim();
  
  // Already in DD/MM/YYYY format - return as-is
  const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    day = parseInt(dmyMatch[1], 10);
    month = parseInt(dmyMatch[2], 10);
    year = parseInt(dmyMatch[3], 10);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  
  // ISO format YYYY-MM-DD (parse manually to avoid timezone issues)
  const isoMatch = strValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  
  // MM/DD/YYYY format (US format)
  const mdyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    // Assume DD/MM/YYYY since that's the target format
    day = parseInt(mdyMatch[1], 10);
    month = parseInt(mdyMatch[2], 10);
    year = parseInt(mdyMatch[3], 10);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  
  // Fallback: return original value if can't parse
  return strValue;
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "server", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer disk storage for file uploads
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  },
});
const upload = multer({ 
  storage: diskStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
    }
  }
});

/**
 * Parse Excel file with multiple sheets
 */
function parseXlsxWithSheets(buffer: Buffer): Map<string, SheetData> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets = new Map<string, SheetData>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
    
    sheets.set(sheetName, {
      name: sheetName,
      headers,
      rows: jsonData,
    });
  }

  return sheets;
}

// Default FX rates (legacy)
const defaultFxRates: FxRate[] = [
  { currency: "USD", rateToUsd: 1.0, lastUpdated: new Date().toISOString() },
  { currency: "EUR", rateToUsd: 1.08, lastUpdated: new Date().toISOString() },
  { currency: "GBP", rateToUsd: 1.27, lastUpdated: new Date().toISOString() },
  { currency: "INR", rateToUsd: 0.012, lastUpdated: new Date().toISOString() },
  { currency: "AED", rateToUsd: 0.27, lastUpdated: new Date().toISOString() },
  { currency: "SGD", rateToUsd: 0.75, lastUpdated: new Date().toISOString() },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize FX rates
  await storage.setFxRates(defaultFxRates);

  // ==========================================
  // NEW API ENDPOINTS (per specification)
  // ==========================================

  /**
   * Upload single XLSX file with HO Data and SP Invoice Report tabs
   * Returns uploadId for use with /api/runs/from-upload
   */
  app.post("/api/upload", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const uploadedFile = req.file;

      if (!uploadedFile) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("Processing file:", uploadedFile.originalname);
      
      const ext = uploadedFile.originalname.split(".").pop()?.toLowerCase() || "";

      if (ext !== "xlsx" && ext !== "xls") {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          error: `Unsupported file format: ${ext}. Please upload an .xlsx file.`,
        });
      }

      // Read and parse file with explicit error handling
      let fileBuffer: Buffer;
      let sheets: Map<string, SheetData>;
      
      try {
        fileBuffer = fs.readFileSync(uploadedFile.path);
        console.log("File read successfully, size:", fileBuffer.length);
        sheets = parseXlsxWithSheets(fileBuffer);
        console.log("Parsed sheets:", Array.from(sheets.keys()));
      } catch (parseError) {
        console.error("File parsing error:", parseError);
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({ 
          error: "Failed to parse Excel file. Please ensure it's a valid .xlsx file." 
        });
      }

      if (sheets.size === 0) {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({ error: "Empty file with no data sheets." });
      }

      // Find HO Data and SP Invoice Report tabs
      let hoData: SheetData | null = null;
      let spData: SheetData | null = null;

      Array.from(sheets.entries()).forEach(([name, data]) => {
        const normalizedName = name.toLowerCase().trim();
        if (normalizedName.includes("ho data") || normalizedName === "ho data") {
          hoData = data;
        } else if (
          normalizedName.includes("sp invoice") ||
          normalizedName === "sp invoice report"
        ) {
          spData = data;
        }
      });

      if (!hoData) {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          error: 'Missing required sheet "HO Data". Please check your file.',
        });
      }

      if (!spData) {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          error: 'Missing required sheet "SP Invoice Report". Please check your file.',
        });
      }

      // Create file info
      const fileInfo: UploadedFile = {
        id: randomUUID(),
        name: uploadedFile.originalname,
        size: uploadedFile.size,
        type: uploadedFile.mimetype,
        filePath: uploadedFile.path,
        sheetNames: Array.from(sheets.keys()),
      };

      // Store upload with parsed data
      const uploadRecord = await storage.createUpload(fileInfo, hoData, spData);

      res.json({
        uploadId: uploadRecord.id,
        file: fileInfo,
        hoDataRowCount: (hoData as SheetData).rows.length,
        spDataRowCount: (spData as SheetData).rows.length,
        sheetNames: Array.from(sheets.keys()),
      });
    } catch (error) {
      console.error("Upload parsing error:", error);
      res.status(500).json({ error: "Failed to parse uploaded file" });
    }
  });

  /**
   * POST /api/runs/from-upload
   * Start reconciliation using the existing upload session (no new session created)
   */
  app.post("/api/runs/from-upload", async (req, res) => {
    try {
      const { uploadId } = req.body;

      if (!uploadId) {
        return res.status(400).json({ error: "Missing uploadId" });
      }

      // Get upload record - in DatabaseStorage, uploadId IS the session ID
      const upload = await storage.getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      if (!upload.hoData || !upload.spData) {
        return res.status(400).json({ error: "Upload missing required data sheets" });
      }

      // Use the same session ID as the upload - no new session needed
      const runId = uploadId;
      
      // Update the existing session to "processing" status
      await storage.updateRun(runId, {
        status: "processing",
        progressStep: "Fetching FX rates",
      });

      try {
        await storage.updateRun(runId, { progressStep: "Processing HO Data" });
        await storage.updateRun(runId, { progressStep: "Processing SP Data" });
        await storage.updateRun(runId, { progressStep: "Computing reconciliation" });

        const result = await runReconciliation(upload.hoData!, upload.spData!);

        // Save results and update status
        await storage.setRunResult(runId, result);
        await storage.updateRun(runId, {
          status: "done",
          progressStep: "Complete",
          completedAt: new Date().toISOString(),
        });
        console.log(`Reconciliation completed for session ${runId}`);

        // Return the runId and FX data after reconciliation is complete
        res.json({ runId, fx: result.fx });
      } catch (error) {
        console.error("Reconciliation error:", error);
        await storage.updateRun(runId, {
          status: "error",
          progressStep: "Failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        res.status(500).json({ error: "Reconciliation failed", details: error instanceof Error ? error.message : "Unknown error" });
      }
    } catch (error) {
      console.error("Run creation error:", error);
      res.status(500).json({ error: "Failed to create run" });
    }
  });

  /**
   * GET /api/runs/:runId/status
   * Get run status and progress
   */
  app.get("/api/runs/:runId/status", async (req, res) => {
    try {
      const { runId } = req.params;
      const run = await storage.getRun(runId);

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      res.json({
        status: run.status,
        progressStep: run.progressStep,
        error: run.error,
      });
    } catch (error) {
      console.error("Status fetch error:", error);
      res.status(500).json({ error: "Failed to fetch run status" });
    }
  });

  /**
   * GET /api/runs/:runId/results
   * Get full reconciliation results
   */
  app.get("/api/runs/:runId/results", async (req, res) => {
    try {
      const { runId } = req.params;
      const run = await storage.getRun(runId);

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "done") {
        return res.status(400).json({
          error: "Run not complete",
          status: run.status,
          progressStep: run.progressStep,
        });
      }

      const result = await storage.getRunResult(runId);

      if (!result) {
        return res.status(404).json({ error: "Results not found" });
      }

      res.json(result);
    } catch (error) {
      console.error("Results fetch error:", error);
      res.status(500).json({ error: "Failed to fetch results" });
    }
  });

  /**
   * GET /api/runs
   * List all runs
   */
  app.get("/api/runs", async (req, res) => {
    try {
      const runs = await storage.getRuns();
      res.json(runs);
    } catch (error) {
      console.error("Runs fetch error:", error);
      res.status(500).json({ error: "Failed to fetch runs" });
    }
  });

  // ==========================================
  // LEGACY ENDPOINTS (for backward compatibility)
  // ==========================================

  /**
   * Demo mode - create demo run with sample data
   */
  app.post("/api/demo", async (req, res) => {
    try {
      // Create demo HO and SP data
      // Demo data includes various cancellation scenarios to test the new logic:
      // BK003: Cancelled + Cancellable=Yes + SP Net>0 → Cancelled-SP error
      // BK004: Cancelled + Cancellable=No + Insurance=No + chargedLoss=FALSE → Cancelled-Check for Charge loss
      // BK011: Cancelled + Cancellable=Yes + SP Net=0 → Cancelled-OK (Reconciled)
      // BK012: Cancelled + Cancellable=No + Insurance=Yes + SP Net>0 → Cancelled-Insured Booking
      // BK013: Cancelled + Cancellable=No + Insurance=No + chargedLoss=TRUE → Cancelled-DSS policy
      const hoData: SheetData = {
        name: "HO Data",
        headers: ["bookingId", "netPrice", "currency", "bookingCreationDate", "bookingStatus", "Cancellable", "Cancellation Insurance", "chargedLoss", "billingEntityName", "beId", "paymentBasis", "fulfillmentMethod"],
        rows: [
          { bookingId: "BK001", netPrice: 100, currency: "USD", bookingCreationDate: "2024-01-15", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Booking", fulfillmentMethod: "Freesale" },
          { bookingId: "BK001", netPrice: 50, currency: "USD", bookingCreationDate: "2024-01-10", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Booking", fulfillmentMethod: "Freesale" }, // Duplicate - Secondary
          { bookingId: "BK002", netPrice: 150, currency: "EUR", bookingCreationDate: "2024-01-16", bookingStatus: "CONFIRMED", Cancellable: "No", "Cancellation Insurance": "Yes", chargedLoss: "FALSE", billingEntityName: "Euro Adventures", beId: "BE-002", paymentBasis: "Per Ticket", fulfillmentMethod: "Manual" },
          { bookingId: "BK003", netPrice: 200, currency: "USD", bookingCreationDate: "2024-01-17", bookingStatus: "CANCELLED", Cancellable: "Yes", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Booking", fulfillmentMethod: "Freesale" }, // Cancelled-SP error (SP Net=50 > 0)
          { bookingId: "BK004", netPrice: 75, currency: "GBP", bookingCreationDate: "2024-01-18", bookingStatus: "CANCELLED", Cancellable: "No", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "British Excursions", beId: "BE-003", paymentBasis: "Per Pax", fulfillmentMethod: "Manual" }, // Cancelled-Check for Charge loss (SP Net=25 > 0)
          { bookingId: "BK005", netPrice: 300, currency: "USD", bookingCreationDate: "2024-01-19", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Booking", fulfillmentMethod: "Vendor API" },
          { bookingId: "BK006", netPrice: 125, currency: "USD", bookingCreationDate: "2024-01-20", bookingStatus: "CONFIRMED", Cancellable: "No", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Ticket", fulfillmentMethod: "Selenium" },
          { bookingId: "BK007", netPrice: 50, currency: "EUR", bookingCreationDate: "2024-01-21", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "Yes", chargedLoss: "FALSE", billingEntityName: "Euro Adventures", beId: "BE-002", paymentBasis: "Per Booking", fulfillmentMethod: "Pre Purchase" },
          { bookingId: "BK008", netPrice: 180, currency: "USD", bookingCreationDate: "2024-01-22", bookingStatus: "PENDING", Cancellable: "No", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Pax", fulfillmentMethod: "Freesale" },
          { bookingId: "BK009", netPrice: 220, currency: "USD", bookingCreationDate: "2024-01-23", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Booking", fulfillmentMethod: "Manual" },
          { bookingId: "BK010", netPrice: 90, currency: "GBP", bookingCreationDate: "2024-01-24", bookingStatus: "CONFIRMED", Cancellable: "No", "Cancellation Insurance": "Yes", chargedLoss: "FALSE", billingEntityName: "British Excursions", beId: "BE-003", paymentBasis: "Per Ticket", fulfillmentMethod: "Vendor Request" },
          { bookingId: "BK011", netPrice: 100, currency: "USD", bookingCreationDate: "2024-01-25", bookingStatus: "CANCELLED", Cancellable: "Yes", "Cancellation Insurance": "No", chargedLoss: "FALSE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Booking", fulfillmentMethod: "Freesale" }, // Cancelled-OK (SP Net=0)
          { bookingId: "BK012", netPrice: 150, currency: "USD", bookingCreationDate: "2024-01-26", bookingStatus: "CANCELLED", Cancellable: "No", "Cancellation Insurance": "Yes", chargedLoss: "FALSE", billingEntityName: "Euro Adventures", beId: "BE-002", paymentBasis: "Per Ticket", fulfillmentMethod: "Manual" }, // Cancelled-Insured Booking (SP Net=60 > 0)
          { bookingId: "BK013", netPrice: 80, currency: "USD", bookingCreationDate: "2024-01-27", bookingStatus: "CANCELLED", Cancellable: "No", "Cancellation Insurance": "No", chargedLoss: "TRUE", billingEntityName: "Acme Tours Ltd", beId: "BE-001", paymentBasis: "Per Pax", fulfillmentMethod: "Selenium" }, // Cancelled-DSS policy (SP Net=40 > 0, chargedLoss=TRUE)
        ],
      };

      const spData: SheetData = {
        name: "SP Invoice Report",
        headers: ["bookingId", "netPrice", "Billing Currency", "fulfilmentDate", "ticketId"],
        rows: [
          { bookingId: "BK001", netPrice: 95, "Billing Currency": "USD", fulfilmentDate: "2024-01-16", ticketId: "TKT-2024-001" },
          { bookingId: "BK002", netPrice: 150, "Billing Currency": "EUR", fulfilmentDate: "2024-01-17", ticketId: "TKT-2024-002" },
          { bookingId: "BK003", netPrice: 50, "Billing Currency": "USD", fulfilmentDate: "2024-01-18", ticketId: "TKT-2024-003" }, // SP Net > 0 for cancelled booking
          { bookingId: "BK004", netPrice: 25, "Billing Currency": "GBP", fulfilmentDate: "2024-01-18", ticketId: "TKT-2024-004" }, // SP Net > 0 for cancelled booking
          { bookingId: "BK005", netPrice: 290, "Billing Currency": "USD", fulfilmentDate: "2024-01-20", ticketId: "TKT-2024-005" },
          { bookingId: "BK006", netPrice: 125, "Billing Currency": "USD", fulfilmentDate: "2024-01-21", ticketId: "TKT-2024-006" },
          { bookingId: "BK007", netPrice: 48, "Billing Currency": "EUR", fulfilmentDate: "2024-01-22", ticketId: "TKT-2024-007" },
          { bookingId: "BK009", netPrice: 215, "Billing Currency": "USD", fulfilmentDate: "2024-01-24", ticketId: "TKT-2024-009" },
          { bookingId: "BK010", netPrice: 85, "Billing Currency": "GBP", fulfilmentDate: "2024-01-25", ticketId: "TKT-2024-010" },
          // BK011 has NO SP row → SP Net = 0 → Cancelled-OK
          { bookingId: "BK012", netPrice: 60, "Billing Currency": "USD", fulfilmentDate: "2024-01-26", ticketId: "TKT-2024-012" }, // SP Net > 0, Insurance=Yes → Cancelled-Insured Booking
          { bookingId: "BK013", netPrice: 40, "Billing Currency": "USD", fulfilmentDate: "2024-01-27", ticketId: "TKT-2024-013" }, // SP Net > 0, chargedLoss=TRUE → Cancelled-DSS policy
          { bookingId: "BK999", netPrice: 500, "Billing Currency": "USD", fulfilmentDate: "2024-01-26", ticketId: "TKT-2024-999" }, // Unmapped
        ],
      };

      // Create an upload record which creates a session in DatabaseStorage
      const fileInfo: UploadedFile = {
        id: randomUUID(),
        name: "Demo Reconciliation - " + new Date().toLocaleString(),
        size: 2048,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sheetNames: ["HO Data", "SP Invoice Report"],
      };
      const uploadRecord = await storage.createUpload(fileInfo, hoData, spData);

      // Run reconciliation
      const result = await runReconciliation(hoData, spData);

      // Store results and update status using the same session/upload ID
      await storage.setRunResult(uploadRecord.id, result);
      await storage.updateRun(uploadRecord.id, {
        status: "done",
        progressStep: "Complete",
        completedAt: new Date().toISOString(),
      });

      res.json({
        runId: uploadRecord.id,
        uploadId: uploadRecord.id,
        ...result,
      });
    } catch (error) {
      console.error("Demo error:", error);
      res.status(500).json({ error: "Failed to run demo" });
    }
  });

  // Refresh FX rates (legacy)
  app.post("/api/fx/refresh", async (req, res) => {
    const refreshedRates = defaultFxRates.map((rate) => ({
      ...rate,
      lastUpdated: new Date().toISOString(),
    }));
    await storage.setFxRates(refreshedRates);
    res.json({ fxRates: refreshedRates });
  });

  /**
   * Export reconciliation results as XLSX with 4 tabs:
   * 1. Payable Summary - SP total and HO total (Primary only)
   * 2. Discrepancy Analysis - Overall summary + TID-level breakdowns
   * 3. SP Invoice Report - Original data + converted values + FX rate
   * 4. HO Report Updated - Original HO data with SP net, Difference, Difference %, Secondary updates
   * GET /api/runs/:runId/export
   */
  app.get("/api/runs/:runId/export", async (req, res) => {
    try {
      const { runId } = req.params;
      const run = await storage.getRun(runId);

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "done") {
        return res.status(400).json({ error: "Run not complete" });
      }

      const result = await storage.getRunResult(runId);
      if (!result) {
        return res.status(404).json({ error: "Results not found" });
      }

      // Get original upload data
      const upload = await storage.getUpload(run.uploadId);
      const originalHoData = upload?.hoData?.rows || [];
      const originalSpData = upload?.spData?.rows || [];

      // Get disputes and vendor corrections for populating HO Report columns
      const allDisputes = await storage.getDisputes(runId);
      const disputesByBooking = new Map<string, typeof allDisputes[0]>();
      for (const d of allDisputes) {
        disputesByBooking.set(d.bookingId, d);
      }
      
      const vendorCorrections = await storage.getVendorCorrections(runId);
      const vendorCorrectionsByBooking = new Map<string, string>();
      for (const vc of vendorCorrections) {
        vendorCorrectionsByBooking.set(vc.bookingId, vc.finalVendorId);
      }
      
      // Create SP ticket ID lookup by booking ID
      const spTicketIdByBooking = new Map<string, string>();
      for (const spRow of originalSpData) {
        const row = spRow as Record<string, unknown>;
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const ticketId = String(row["ticketId"] || row["Ticket ID"] || row["ticket_id"] || row["TicketID"] || "");
        if (bookingId && ticketId) {
          spTicketIdByBooking.set(bookingId, ticketId);
        }
      }

      // Create lookup maps for reconciled rows
      // For HO report, we need to match by bookingId AND fulfillmentIdentifier
      // to correctly handle cases where same bookingId has both Primary and Secondary
      const allRowsMap = new Map<string, typeof result.allRows[0][]>();
      for (const r of result.allRows) {
        const existing = allRowsMap.get(r.bookingId) || [];
        existing.push(r);
        allRowsMap.set(r.bookingId, existing);
      }
      const spFxMap = new Map(result.spFxDebugRows.map(r => [r.bookingId, r]));

      // Create workbook
      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();

      // =====================================================
      // SHEET 1: Payable Summary
      // =====================================================
      // Group totals by currency for accuracy
      const spTotalByCurrency = new Map<string, number>();
      for (const r of result.spFxDebugRows) {
        const ccy = r.spCurrency;
        spTotalByCurrency.set(ccy, (spTotalByCurrency.get(ccy) || 0) + r.spNetOriginal);
      }
      
      const hoTotalByCurrency = new Map<string, number>();
      for (const r of result.primaryRows) {
        const ccy = r.hoCurrency;
        hoTotalByCurrency.set(ccy, (hoTotalByCurrency.get(ccy) || 0) + r.hoNet);
      }
      
      const payableSummaryData: { Description: string; Currency: string; Amount: number; Note: string }[] = [];
      
      // Add SP totals by currency
      Array.from(spTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push({
          "Description": "Payable as per SP",
          "Currency": ccy,
          "Amount": amount,
          "Note": "Sum of SP Invoice",
        });
      });
      
      // Add HO totals by currency
      Array.from(hoTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push({
          "Description": "Payable as per HO",
          "Currency": ccy,
          "Amount": amount,
          "Note": "Sum of HO Net (Primary only)",
        });
      });
      
      const payableSheet = XLSX.utils.json_to_sheet(payableSummaryData);
      payableSheet["!cols"] = [{ wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 30 }];
      payableSheet["!sheetViews"] = [{ showGridLines: false }];
      
      // Apply formatting to Payable Summary (borders, bold header, Indian number format)
      const payableHeaders = ["Description", "Currency", "Amount", "Note"];
      const payableRowCount = payableSummaryData.length + 1; // +1 for header
      const payBorderStyle = { style: "thin", color: { rgb: "000000" } };
      const payBorder = { top: payBorderStyle, bottom: payBorderStyle, left: payBorderStyle, right: payBorderStyle };
      
      for (let r = 0; r < payableRowCount; r++) {
        for (let c = 0; c < payableHeaders.length; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!payableSheet[cellRef]) continue;
          
          payableSheet[cellRef].s = payableSheet[cellRef].s || {};
          payableSheet[cellRef].s.border = payBorder;
          
          if (r === 0) {
            payableSheet[cellRef].s.font = { bold: true };
          }
          
          // Format Amount column with Indian notation
          if (r > 0 && c === 2 && typeof payableSheet[cellRef].v === "number") {
            payableSheet[cellRef].v = formatIndianNumber(payableSheet[cellRef].v);
            payableSheet[cellRef].t = "s";
            payableSheet[cellRef].s.alignment = { horizontal: "right" };
          }
        }
      }
      
      XLSX.utils.book_append_sheet(workbook, payableSheet, getUniqueSheetName("Payable Summary", usedSheetNames));

      // =====================================================
      // SHEET 2: Discrepancy Analysis
      // =====================================================
      // Part A: Overall Summary (excluding Reconciled - applies to both primary and secondary vendor)
      const discrepancySummary = result.overallSummary.filter(r => r.reason !== "Reconciled").map(row => ({
        "Reason": row.reason,
        "Currency": row.currency,
        "Discrepancy (LC)": row.discrepancyLc,
        "Discrepancy (USD)": row.discrepancyUsd,
        "Count BID": row.countBid,
      }));

      // Part B: TID-level breakdown for each reason (excluding Reconciled)
      const discrepancyRows = [...result.primaryRows, ...result.secondaryVendorRows].filter(r => r.reason !== "Reconciled");
      const allPrimaryRows = result.primaryRows;
      
      // Group by REASON + TID (composite key) to preserve all TIDs per reason
      const tidGroups = new Map<string, {
        tid: string;
        currency: string;
        discrepancyLc: number;
        discrepancyUsd: number;
        fulfillmentMethod: string;
        spNetTotal: number;
        hoNetTotal: number;
        dates: string[];
        bookingIds: Set<string>;
        driTeam: string;
        reason: string;
        hoTakeRates: number[];
        actualTakeRates: number[];
        discrepancyPercents: number[];
        headoutSellingPriceTotal: number;
        lossLcTotal: number;
        hasSoldAtLoss: boolean;
      }>();

      for (const row of discrepancyRows) {
        const tid = row.tid || "Unknown";
        // Use composite key: reason + TID to prevent overwriting when same TID appears under different reasons
        const compositeKey = `${row.reason}:${tid}`;
        
        if (!tidGroups.has(compositeKey)) {
          tidGroups.set(compositeKey, {
            tid,
            currency: row.hoCurrency,
            discrepancyLc: 0,
            discrepancyUsd: 0,
            fulfillmentMethod: row.fulfillmentMethod || "Unknown",
            spNetTotal: 0,
            hoNetTotal: 0,
            dates: [],
            bookingIds: new Set(),
            driTeam: row.driTeam || "Unknown",
            reason: row.reason,
            hoTakeRates: [],
            actualTakeRates: [],
            discrepancyPercents: [],
            headoutSellingPriceTotal: 0,
            lossLcTotal: 0,
            hasSoldAtLoss: false,
          });
        }

        const group = tidGroups.get(compositeKey)!;
        group.discrepancyLc += row.differenceLc;
        group.discrepancyUsd += row.differenceUsd;
        group.spNetTotal += row.spNetInHo;
        group.hoNetTotal += row.hoNet;
        if (row.bookingCreationDate) group.dates.push(row.bookingCreationDate);
        group.bookingIds.add(row.bookingId);

        const hsp = row.headoutSellingPrice;
        if (hsp && hsp > 0) {
          group.headoutSellingPriceTotal += hsp;
          const hoTakeRate = (hsp - row.hoNet) / hsp * 100;
          group.hoTakeRates.push(hoTakeRate);
          const actualTakeRate = (hsp - row.spNetInHo) / hsp * 100;
          group.actualTakeRates.push(actualTakeRate);
          if (hsp < row.spNetInHo) {
            group.hasSoldAtLoss = true;
            group.lossLcTotal += hsp - row.spNetInHo;
          }
        }
        if (row.hoNet !== 0) {
          const discPct = ((row.hoNet - row.spNetInHo) / row.hoNet) * 100;
          group.discrepancyPercents.push(discPct);
        }
      }

      // Build TID-level analysis rows
      const tidAnalysisData = Array.from(tidGroups.values()).map(group => {
        const sortedDates = group.dates.sort();
        const startDate = sortedDates.length > 0 ? sortedDates[0] : "";
        const endDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : "";
        const timesCharged = group.hoNetTotal !== 0
          ? (group.spNetTotal / group.hoNetTotal).toFixed(2) + "x"
          : "N/A";
        const countBidWithDiscrepancy = group.bookingIds.size;
        let countBidsInDuration = countBidWithDiscrepancy;
        if (startDate && endDate) {
          countBidsInDuration = allPrimaryRows.filter(r => 
            r.tid === group.tid && r.bookingCreationDate && 
            r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
          ).length;
        }
        const totalBidsInReport = allPrimaryRows.filter(r => r.tid === group.tid).length;
        const discrepancyCoveragePercent = countBidsInDuration > 0
          ? (countBidWithDiscrepancy / countBidsInDuration * 100).toFixed(2) + "%"
          : "0%";
        const frequency = countBidWithDiscrepancy >= 5 ? "Recurring" : "One-Off";

        let discrepancyPercentRange = "";
        let pattern = "";
        if (group.discrepancyPercents.length > 0) {
          const uniquePercents = Array.from(new Set(group.discrepancyPercents.map(p => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePercents.length === 1) {
            discrepancyPercentRange = minPct.toFixed(2) + "%";
            pattern = "Consistent";
          } else {
            discrepancyPercentRange = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
            pattern = "Scattered";
          }
        }

        // Calculate average take rates
        const avgHoTakeRate = group.hoTakeRates.length > 0 
          ? (group.hoTakeRates.reduce((a, b) => a + b, 0) / group.hoTakeRates.length).toFixed(2) + "%"
          : "";
        const avgActualTakeRate = group.actualTakeRates.length > 0
          ? (group.actualTakeRates.reduce((a, b) => a + b, 0) / group.actualTakeRates.length).toFixed(2) + "%"
          : "";
        
        // Approximate Loss USD (using discrepancy USD ratio as proxy)
        const lossUsd = group.hasSoldAtLoss && group.discrepancyLc !== 0
          ? (group.lossLcTotal * group.discrepancyUsd / group.discrepancyLc)
          : "";

        return {
          "Reason": group.reason,
          "TID": group.tid,
          "Currency": group.currency,
          "Discrepancy (LC)": group.discrepancyLc,
          "Discrepancy (USD)": group.discrepancyUsd,
          "Fulfillment Method": group.fulfillmentMethod,
          "Times Charged": timesCharged,
          "Start Date": startDate,
          "End Date": endDate,
          "BID Count": countBidWithDiscrepancy,
          "BIDs in Duration": countBidsInDuration,
          "Total BIDs": totalBidsInReport,
          "Coverage %": discrepancyCoveragePercent,
          "Frequency": frequency,
          "Discrepancy % Range": discrepancyPercentRange,
          "Pattern": pattern,
          "Sold at Loss": group.hasSoldAtLoss ? "Yes" : "No",
          "Loss (LC)": group.hasSoldAtLoss ? group.lossLcTotal : "",
          "Loss (USD)": lossUsd,
          "DRI Team": group.driTeam,
          "HO Take Rate": avgHoTakeRate,
          "Actual Take Rate": avgActualTakeRate,
        };
      });

      // Sort TID analysis by Discrepancy USD: negative highest to positive lowest
      // (most negative first, then ascending through zero to most positive)
      tidAnalysisData.sort((a, b) => {
        const aUsd = typeof a["Discrepancy (USD)"] === "number" ? a["Discrepancy (USD)"] : 0;
        const bUsd = typeof b["Discrepancy (USD)"] === "number" ? b["Discrepancy (USD)"] : 0;
        return aUsd - bUsd; // ascending order puts most negative first
      });

      // Group TID data by reason for separate tables
      const tidByReason = new Map<string, typeof tidAnalysisData>();
      for (const row of tidAnalysisData) {
        const reason = row["Reason"];
        if (!tidByReason.has(reason)) {
          tidByReason.set(reason, []);
        }
        tidByReason.get(reason)!.push(row);
      }

      // Define columns per reason type
      const mtbColumns = [
        "TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment Method", 
        "Times Charged", "Start Date", "End Date", "BID Count", "BIDs in Duration",
        "Total BIDs", "Coverage %", "Frequency", "DRI Team"
      ];
      const npdColumns = [
        "TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "HO Take Rate", 
        "Actual Take Rate", "Start Date", "End Date", "BID Count", "BIDs in Duration",
        "Coverage %", "Discrepancy % Range", "Pattern", "Frequency", "Fulfillment Method",
        "DRI Team", "Sold at Loss", "Loss (LC)", "Loss (USD)"
      ];
      const defaultColumns = [
        "TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment Method",
        "Start Date", "End Date", "BID Count", "Coverage %", "Frequency", "DRI Team"
      ];

      // Helper to get columns for a reason
      const getColumnsForReason = (reason: string): string[] => {
        if (reason.toLowerCase().includes("multiple") || reason === "MTB") return mtbColumns;
        if (reason.toLowerCase().includes("net price") || reason === "NPD") return npdColumns;
        return defaultColumns;
      };

      // Helper to convert value to Excel serial date number
      const toExcelDate = (dateVal: string | number): number | string => {
        if (typeof dateVal === "number" && dateVal > 25000) {
          // Already an Excel serial date
          return dateVal;
        }
        if (typeof dateVal === "string" && dateVal) {
          // Try parsing as date string
          const parsed = new Date(dateVal);
          if (!isNaN(parsed.getTime())) {
            // Convert JS Date to Excel serial (days since Jan 1, 1900)
            return Math.floor((parsed.getTime() / 86400000) + 25569);
          }
        }
        return dateVal; // Return as-is if can't convert
      };

      // Helper to apply cell styles (borders, bold headers) and number/date formats
      const applyTableStyles = (
        sheet: XLSX.WorkSheet,
        startRow: number,
        startCol: number,
        numRows: number,
        numCols: number,
        columns: string[]
      ) => {
        const borderStyle = { style: "thin" as const, color: { rgb: "000000" } };
        const border = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: startRow + r, c: startCol + c });
            if (!sheet[cellRef]) sheet[cellRef] = { v: "", t: "s" };
            
            // Merge into existing style object (preserve any existing properties)
            const existingStyle = sheet[cellRef].s || {};
            sheet[cellRef].s = {
              ...existingStyle,
              border: border,
              alignment: existingStyle.alignment || { vertical: "center" }
            };
            
            // Bold for header row (first row of table)
            if (r === 0) {
              sheet[cellRef].s.font = { ...(sheet[cellRef].s.font || {}), bold: true };
            }
            
            // Left align first column
            if (c === 0) {
              sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "left" };
            }
            
            // Apply number/date formats (skip header row)
            if (r > 0 && columns[c]) {
              const colName = columns[c].toLowerCase();
              
              // Format currency columns with Indian notation (1,00,000.00)
              // Convert to formatted text string since Excel doesn't support Indian format natively
              if (colName.includes("discrepancy") && !colName.includes("%") && !colName.includes("range")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].v = formatIndianNumber(sheet[cellRef].v);
                  sheet[cellRef].t = "s"; // Text type for formatted string
                  sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "right" };
                }
              }
              if (colName.includes("loss") && !colName.includes("?")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].v = formatIndianNumber(sheet[cellRef].v);
                  sheet[cellRef].t = "s";
                  sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "right" };
                }
              }
              if (colName === "amount" || colName.includes("net") || colName.includes("price")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].v = formatIndianNumber(sheet[cellRef].v);
                  sheet[cellRef].t = "s";
                  sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "right" };
                }
              }
              
              // Date format for start/end date columns
              if (colName === "start date" || colName === "end date") {
                const val = sheet[cellRef].v;
                // Convert to formatted date string DD/MM/YYYY
                sheet[cellRef].v = formatDateValue(val);
                sheet[cellRef].t = "s";
              }
            }
          }
        }
      };
      
      // Create Discrepancy Analysis sheet with separate tables per reason
      const discrepancySheet = XLSX.utils.json_to_sheet([]);
      
      // Disable gridlines (set in sheet views)
      discrepancySheet["!sheetViews"] = [{ showGridLines: false }];
      
      // Add header for Overall Summary section
      let currentRow = 0;
      XLSX.utils.sheet_add_aoa(discrepancySheet, [["OVERALL DISCREPANCY SUMMARY"]], { origin: { r: currentRow, c: 0 } });
      
      // Style the section header
      const summaryHeaderCell = XLSX.utils.encode_cell({ r: currentRow, c: 0 });
      discrepancySheet[summaryHeaderCell].s = { font: { bold: true, sz: 14 } };
      currentRow += 1;
      
      // Add summary table (write raw values, let cell formatting handle display)
      const summaryHeaders = Object.keys(discrepancySummary[0] || {});
      XLSX.utils.sheet_add_aoa(discrepancySheet, [summaryHeaders], { origin: { r: currentRow, c: 0 } });
      const summaryData = discrepancySummary.map(row => summaryHeaders.map(h => row[h as keyof typeof row]));
      XLSX.utils.sheet_add_aoa(discrepancySheet, summaryData, { origin: { r: currentRow + 1, c: 0 } });
      applyTableStyles(discrepancySheet, currentRow, 0, discrepancySummary.length + 1, summaryHeaders.length, summaryHeaders);
      currentRow += discrepancySummary.length + 2;
      
      // Add separate table for each reason
      for (const [reason, rows] of Array.from(tidByReason.entries())) {
        if (rows.length === 0) continue;
        
        // Add reason section header
        XLSX.utils.sheet_add_aoa(discrepancySheet, [[`${reason.toUpperCase()} ANALYSIS`]], { origin: { r: currentRow, c: 0 } });
        const reasonHeaderCell = XLSX.utils.encode_cell({ r: currentRow, c: 0 });
        discrepancySheet[reasonHeaderCell].s = { font: { bold: true, sz: 12 } };
        currentRow += 1;
        
        // Get columns for this reason
        const columns = getColumnsForReason(reason);
        
        // Add column headers
        XLSX.utils.sheet_add_aoa(discrepancySheet, [columns], { origin: { r: currentRow, c: 0 } });
        
        // Add data rows (write raw values, cell formatting applied after)
        const tableData = rows.map((row: Record<string, unknown>) => 
          columns.map(col => {
            const value = row[col];
            if (value === undefined) return "";
            
            // Convert dates to Excel serial numbers for proper date formatting
            if (col === "Start Date" || col === "End Date") {
              return toExcelDate(value as string | number);
            }
            
            return value;
          })
        );
        XLSX.utils.sheet_add_aoa(discrepancySheet, tableData, { origin: { r: currentRow + 1, c: 0 } });
        
        // Apply table styling
        applyTableStyles(discrepancySheet, currentRow, 0, rows.length + 1, columns.length, columns);
        
        currentRow += rows.length + 2;
      }
      
      // Set auto column widths for Discrepancy Analysis
      // Calculate max column count across all tables
      const maxColCount = Math.max(
        summaryHeaders.length,
        ...Array.from(tidByReason.values()).map(rows => rows.length > 0 ? getColumnsForReason(rows[0]["Reason"] as string).length : 0)
      );
      discrepancySheet["!cols"] = Array(maxColCount).fill(null).map((_, i) => {
        // Wider columns for TID, Reason, DRI Team, Fulfillment Method
        if (i === 0) return { wch: 15 }; // TID/Reason
        if (i <= 2) return { wch: 12 }; // Currency, numeric
        return { wch: 18 }; // Other columns
      });
      
      XLSX.utils.book_append_sheet(workbook, discrepancySheet, getUniqueSheetName("Discrepancy Analysis", usedSheetNames));

      // =====================================================
      // SHEET 3: SP Invoice Report
      // =====================================================
      // Original SP data + SP Net converted to HO currency + FX rate used
      const spReportData = originalSpData.map((row: Record<string, unknown>) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const spFxRow = spFxMap.get(bookingId);
        
        return {
          ...row,
          "SP Net (HO Currency)": spFxRow?.spNetInHo ?? "",
          "FX Rate Used": spFxRow?.fxRateUsed ?? "",
        };
      });
      const spReportSheet = XLSX.utils.json_to_sheet(spReportData);
      spReportSheet["!sheetViews"] = [{ showGridLines: false }];
      
      // Apply formatting to SP Invoice Report (no fill colors)
      const spRange = XLSX.utils.decode_range(spReportSheet["!ref"] || "A1");
      const spBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
      const spBorder = { top: spBorderStyle, bottom: spBorderStyle, left: spBorderStyle, right: spBorderStyle };
      
      // Get column headers for number/date formatting
      const spHeaders: string[] = [];
      for (let c = 0; c <= spRange.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c });
        spHeaders.push(spReportSheet[cellRef]?.v?.toString().toLowerCase() || "");
      }
      
      for (let r = 0; r <= spRange.e.r; r++) {
        for (let c = 0; c <= spRange.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!spReportSheet[cellRef]) continue;
          
          // Merge into existing style (preserve any existing properties)
          const existingStyle = spReportSheet[cellRef].s || {};
          spReportSheet[cellRef].s = {
            ...existingStyle,
            border: spBorder
          };
          
          if (r === 0) {
            spReportSheet[cellRef].s.font = { ...(spReportSheet[cellRef].s.font || {}), bold: true };
          }
          
          // Apply Indian number format and date format to data rows
          if (r > 0 && spHeaders[c]) {
            const col = spHeaders[c];
            if (col.includes("net") || col.includes("amount") || col.includes("price") || col.includes("fx")) {
              if (typeof spReportSheet[cellRef].v === "number") {
                spReportSheet[cellRef].v = formatIndianNumber(spReportSheet[cellRef].v);
                spReportSheet[cellRef].t = "s";
                spReportSheet[cellRef].s.alignment = { ...(spReportSheet[cellRef].s.alignment || {}), horizontal: "right" };
              }
            }
            if (col.includes("date")) {
              spReportSheet[cellRef].v = formatDateValue(spReportSheet[cellRef].v);
              spReportSheet[cellRef].t = "s";
            }
          }
        }
      }
      
      XLSX.utils.book_append_sheet(workbook, spReportSheet, getUniqueSheetName("SP Invoice Report", usedSheetNames));

      // =====================================================
      // SHEET 4: HO Report Updated
      // =====================================================
      // Original HO data with SP Net, Difference, Difference % inserted before finalNetPrice
      // Update finalNetPrice, errorTeamAttribution, errorBucket, comments based on reason
      
      // Parse date value safely - same logic as reconciliation.ts
      // Handles ISO dates, Excel serial numbers, and DD/MM/YYYY format
      const parseDate = (dateValue: string | number | null | undefined): number => {
        if (dateValue === null || dateValue === undefined || dateValue === "") return 0;
        
        // Handle Excel serial numbers (numeric values)
        if (typeof dateValue === "number" || !isNaN(Number(dateValue))) {
          const numValue = Number(dateValue);
          // Excel dates are days since 1899-12-30
          if (numValue > 40000 && numValue < 60000) {
            const excelEpoch = new Date(1899, 11, 30).getTime();
            const msPerDay = 24 * 60 * 60 * 1000;
            return excelEpoch + numValue * msPerDay;
          }
          if (numValue > 1000000000000) return numValue; // milliseconds timestamp
          if (numValue > 1000000000) return numValue * 1000; // seconds timestamp
        }
        
        // Handle string dates
        const strValue = String(dateValue);
        
        // Try DD/MM/YYYY format first (common in this application)
        const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/);
        if (dmyMatch) {
          const [, day, month, year, time] = dmyMatch;
          const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${time ? 'T' + time : ''}`;
          const parsed2 = new Date(isoStr);
          if (!isNaN(parsed2.getTime())) {
            return parsed2.getTime();
          }
        }
        
        // Try native JS Date parsing
        const parsed = new Date(strValue);
        if (!isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
        
        return 0;
      };
      
      // Build a set of Secondary row indices by analyzing duplicate bookingIds
      // Same logic as reconciliation: Primary = row with max bookingCreationDate
      const secondaryRowIndices = new Set<number>();
      const hoRowsByBookingId = new Map<string, { index: number; row: Record<string, unknown>; date: number }[]>();
      
      originalHoData.forEach((row: Record<string, unknown>, index: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        if (!bookingId) return;
        
        // Parse bookingCreationDate for comparison using robust parseDate function
        const dateValue = row["bookingCreationDate"] || row["Booking Creation Date"] || row["BookingCreationDate"] || "";
        const dateNum = parseDate(dateValue as string | number);
        
        if (!hoRowsByBookingId.has(bookingId)) {
          hoRowsByBookingId.set(bookingId, []);
        }
        hoRowsByBookingId.get(bookingId)!.push({ index, row, date: dateNum });
      });
      
      // For each bookingId with multiple rows, mark non-Primary rows as Secondary
      hoRowsByBookingId.forEach((rows) => {
        if (rows.length <= 1) return;
        
        // Sort by date descending - first one is Primary (max date)
        rows.sort((a, b) => b.date - a.date);
        
        // All except the first are Secondary
        for (let i = 1; i < rows.length; i++) {
          secondaryRowIndices.add(rows[i].index);
        }
      });
      
      const hoReportData = originalHoData.map((row: Record<string, unknown>, rowIndex: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        
        // Get reconciliation row for this bookingId (only Primary exists in recon results)
        const reconRows = allRowsMap.get(bookingId) || [];
        const reconRow = reconRows[0];
        
        // Check if this row is Secondary based on our pre-computed set
        const isSecondary = secondaryRowIndices.has(rowIndex);
        
        // Get original row keys to preserve order and find finalNetPrice position
        const originalKeys = Object.keys(row);
        const finalNetPriceKey = originalKeys.find(k => {
          const kLower = k.toLowerCase();
          return kLower === "finalnetprice" || kLower === "final net price" || 
                 kLower === "finalnet" || kLower === "final net" || kLower === "final payable";
        }) || "finalNetPrice";
        
        // Calculate values
        const spNet = reconRow?.spNetInHo ?? "";
        const hoNet = reconRow?.hoNet ?? 0;
        const difference = reconRow ? hoNet - reconRow.spNetInHo : "";
        const differencePercent = reconRow && hoNet !== 0 
          ? ((hoNet - reconRow.spNetInHo) / hoNet * 100).toFixed(2) + "%" 
          : "";
        
        // Determine finalNetPrice, errorTeamAttribution, errorBucket, comments, chargedLoss based on reason
        let finalNetPrice: number | string = "";
        let errorTeamAttribution = row["errorTeamAttribution"] || row["Error Team Attribution"] || "";
        let errorBucket = row["errorBucket"] || row["Error Bucket"] || "";
        let comments = row["comments"] || row["Comments"] || "";
        // Get chargedLoss from reconRow (reconciliation result) or from original row
        let chargedLoss = reconRow?.chargedLoss || String(row["chargedLoss"] || row["Charged Loss"] || row["charged_loss"] || "FALSE");
        
        const reason = reconRow?.reason || "Reconciled";
        const fulfillmentMethod = String(reconRow?.fulfillmentMethod || row["fulfillmentMethod"] || row["Fulfillment Method"] || "");
        const priceSync = String(row["priceSync"] || row["Price Sync"] || row["PriceSync"] || "");
        
        // Get the comment from reconciliation (for cancellation scenarios)
        const reconComment = reconRow?.comment || "";
        
        // ========== 8 Reconciliation Columns ==========
        // 1. finalVendorId - from vendor ID corrections
        const finalVendorIdValue = vendorCorrectionsByBooking.get(bookingId) || "";
        
        // 2. Ticket ID - from SP Invoice data
        const ticketIdValue = spTicketIdByBooking.get(bookingId) || "";
        
        // 3-6. Dispute-related columns
        const dispute = disputesByBooking.get(bookingId);
        const disputedAmount = dispute?.disputeAmount ?? "";
        const adjustedInTicketId = dispute?.adjustedInTicketId || "";
        const closedByAmount = dispute?.closedByAdjustmentAmount ?? 0;
        const finalDisputeAmount = dispute 
          ? (dispute.disputeAmount - closedByAmount)
          : "";
        
        // 6. Dispute status - OPEN or CLOSED
        const disputeStatus = dispute 
          ? (dispute.closureStatus === "closed" ? "CLOSED" : "OPEN")
          : "";
        
        // 7. Reconciled Net price - HO Net + Final Dispute when CLOSED
        // If dispute is closed, reconciled net = hoNet + finalDisputeAmount
        // If no dispute or dispute is open, leave blank
        const reconciledNetPrice = dispute && dispute.closureStatus === "closed" && typeof finalDisputeAmount === "number"
          ? hoNet + finalDisputeAmount
          : "";
        
        // 8. UTR number - blank for now (manual entry later)
        const utrNumber = "";
        
        if (isSecondary) {
          // Secondary rows: finalNetPrice = 0, comments = "Duplicate Fulfillment"
          finalNetPrice = 0;
          comments = "Duplicate Fulfillment";
        } else if (reason === "Cancelled-SP error") {
          // Cancelled-SP error: finalNetPrice = SP Net, chargedLoss = TRUE
          finalNetPrice = spNet;
          chargedLoss = "TRUE";
          comments = reconComment || "Cancelled-SP error";
          errorBucket = "Cancelled-SP error";
          
          // Same DRI logic as MTB
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          } else if (fulfillmentMethod.toLowerCase().includes("freesale")) {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase().includes("pre") || fulfillmentMethod.toLowerCase().includes("prepurchase")) {
            errorTeamAttribution = "Inventory Ops";
          }
        } else if (reason === "Reconciled") {
          // Reconciled: finalNetPrice = SP Net
          finalNetPrice = spNet;
          // Use cancellation comment if present, otherwise "Reconciled"
          if (reconComment && reconComment.startsWith("Cancelled")) {
            comments = reconComment;
            // Update chargedLoss for cancellation scenarios that require it
            if (reconComment === "Cancelled-Insured Booking" || reconComment === "Cancelled-DSS policy") {
              chargedLoss = "TRUE";
            }
          } else {
            comments = "Reconciled";
          }
        } else if (reason.toLowerCase().includes("multiple") || reason === "MTB") {
          // Multiple Tickets Booked
          finalNetPrice = spNet;
          errorBucket = "Multiple Tickets Booked";
          comments = "Multiple Tickets Booked";
          
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else if (reason.toLowerCase().includes("price") || reason === "NPD") {
          // Price Mismatch / Net Price Difference
          finalNetPrice = spNet;
          errorBucket = "Price Mismatch";
          
          // Determine variance direction
          const varianceComment = hoNet < (reconRow?.spNetInHo || 0) ? "Negative Variance" : "Positive Variance";
          comments = varianceComment;
          
          if ((fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") && 
              priceSync.toLowerCase() === "yes") {
            errorTeamAttribution = "Inventory";
          } else if (fulfillmentMethod.toLowerCase() === "manual" && 
                     (priceSync.toLowerCase() === "no" || priceSync === "")) {
            errorTeamAttribution = "BizOps";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else {
          // Other reasons: finalNetPrice = SP Net
          finalNetPrice = spNet;
        }
        
        // Helper to check if a key is the finalNetPrice column
        const isFinalNetCol = (k: string) => {
          const kLower = k.toLowerCase();
          return kLower === "finalnetprice" || kLower === "final net price" || 
                 kLower === "finalnet" || kLower === "final net" || kLower === "final payable";
        };
        
        // Build new row with SP Net, Difference, Difference % inserted before finalNetPrice
        const newRow: Record<string, unknown> = {};
        for (const key of originalKeys) {
          const keyLower = key.toLowerCase();
          
          // Insert SP Net, Difference, Difference % just before finalNetPrice
          if (isFinalNetCol(key)) {
            newRow["SP Net"] = spNet;
            newRow["Difference"] = difference;
            newRow["Difference %"] = differencePercent;
          }
          
          // Update specific columns
          if (isFinalNetCol(key)) {
            newRow[key] = finalNetPrice;
          } else if (keyLower === "errorteamattribution" || keyLower === "error team attribution") {
            newRow[key] = errorTeamAttribution;
          } else if (keyLower === "errorbucket" || keyLower === "error bucket") {
            newRow[key] = errorBucket;
          } else if (keyLower === "comments" || keyLower === "comment") {
            newRow[key] = comments;
          } else if (keyLower === "chargedloss" || keyLower === "charged_loss" || keyLower === "charged loss") {
            newRow[key] = chargedLoss;
          } 
          // ========== 8 Reconciliation Columns ==========
          else if (keyLower === "finalvendorid" || keyLower === "final vendor id" || keyLower === "final_vendor_id") {
            newRow[key] = finalVendorIdValue;
          } else if (keyLower === "ticketid" || keyLower === "ticket id" || keyLower === "ticket_id") {
            newRow[key] = ticketIdValue;
          } else if (keyLower === "disputedamount" || keyLower === "disputed amount" || keyLower === "disputed_amount") {
            newRow[key] = disputedAmount;
          } else if (keyLower === "adjustedinticketid" || keyLower === "adjusted in ticket id" || keyLower === "adjusted_in_ticket_id") {
            newRow[key] = adjustedInTicketId;
          } else if (keyLower === "finaldisputeamount" || keyLower === "final dispute amount" || keyLower === "final_dispute_amount") {
            newRow[key] = finalDisputeAmount;
          } else if (keyLower === "disputestatus" || keyLower === "dispute status" || keyLower === "dispute_status") {
            newRow[key] = disputeStatus;
          } else if (keyLower === "reconcilednetprice" || keyLower === "reconciled net price" || keyLower === "reconciled_net_price") {
            newRow[key] = reconciledNetPrice;
          } else if (keyLower === "utrnumber" || keyLower === "utr number" || keyLower === "utr_number" || keyLower === "utr") {
            newRow[key] = utrNumber;
          } else {
            newRow[key] = row[key];
          }
        }
        
        // If finalNetPrice/Final Net column wasn't found in original, append the new columns at end
        const hasFinalNetColInOriginal = originalKeys.some(k => isFinalNetCol(k));
        if (!hasFinalNetColInOriginal) {
          newRow["SP Net"] = spNet;
          newRow["Difference"] = difference;
          newRow["Difference %"] = differencePercent;
          newRow["finalNetPrice"] = finalNetPrice;
          newRow["errorTeamAttribution"] = errorTeamAttribution;
          newRow["errorBucket"] = errorBucket;
          newRow["comments"] = comments;
          newRow["chargedLoss"] = chargedLoss;
        }
        
        // Always append the 8 reconciliation columns if not already set (in case they don't exist in original)
        const hasReconCols = (col: string) => {
          const lc = col.toLowerCase();
          return lc === "finalvendorid" || lc === "final vendor id" || lc === "final_vendor_id" ||
                 lc === "ticketid" || lc === "ticket id" || lc === "ticket_id" ||
                 lc === "disputedamount" || lc === "disputed amount" || lc === "disputed_amount" ||
                 lc === "adjustedinticketid" || lc === "adjusted in ticket id" || lc === "adjusted_in_ticket_id" ||
                 lc === "finaldisputeamount" || lc === "final dispute amount" || lc === "final_dispute_amount" ||
                 lc === "disputestatus" || lc === "dispute status" || lc === "dispute_status" ||
                 lc === "reconcilednetprice" || lc === "reconciled net price" || lc === "reconciled_net_price" ||
                 lc === "utrnumber" || lc === "utr number" || lc === "utr_number" || lc === "utr";
        };
        
        // Check if any reconciliation columns exist in original
        const hasAnyReconCol = originalKeys.some(k => hasReconCols(k));
        if (!hasAnyReconCol) {
          // Append all 8 reconciliation columns
          newRow["finalVendorId"] = finalVendorIdValue;
          newRow["Ticket ID"] = ticketIdValue;
          newRow["Disputed amount"] = disputedAmount;
          newRow["Adjusted in Ticket ID"] = adjustedInTicketId;
          newRow["Final Dispute amount"] = finalDisputeAmount;
          newRow["Dispute status"] = disputeStatus;
          newRow["Reconciled Net price"] = reconciledNetPrice;
          newRow["UTR number"] = utrNumber;
        }
        
        return newRow;
      });
      const hoReportSheet = XLSX.utils.json_to_sheet(hoReportData);
      hoReportSheet["!sheetViews"] = [{ showGridLines: false }];
      
      // Apply formatting to HO Report Updated (no fill colors)
      const hoRange = XLSX.utils.decode_range(hoReportSheet["!ref"] || "A1");
      const hoBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
      const hoBorder = { top: hoBorderStyle, bottom: hoBorderStyle, left: hoBorderStyle, right: hoBorderStyle };
      
      // Get column headers for number/date formatting
      const hoHeaders: string[] = [];
      for (let c = 0; c <= hoRange.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c });
        hoHeaders.push(hoReportSheet[cellRef]?.v?.toString().toLowerCase() || "");
      }
      
      for (let r = 0; r <= hoRange.e.r; r++) {
        for (let c = 0; c <= hoRange.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!hoReportSheet[cellRef]) continue;
          
          // Merge into existing style (preserve any existing properties)
          const existingStyle = hoReportSheet[cellRef].s || {};
          hoReportSheet[cellRef].s = {
            ...existingStyle,
            border: hoBorder
          };
          
          if (r === 0) {
            hoReportSheet[cellRef].s.font = { ...(hoReportSheet[cellRef].s.font || {}), bold: true };
          }
          
          // Apply Indian number format and date format to data rows
          if (r > 0 && hoHeaders[c]) {
            const col = hoHeaders[c];
            if (col.includes("net") || col.includes("amount") || col.includes("price") || 
                col.includes("difference") || col.includes("sp net") || col.includes("ho net")) {
              // Skip percentage columns
              if (!col.includes("%")) {
                if (typeof hoReportSheet[cellRef].v === "number") {
                  hoReportSheet[cellRef].v = formatIndianNumber(hoReportSheet[cellRef].v);
                  hoReportSheet[cellRef].t = "s";
                  hoReportSheet[cellRef].s.alignment = { ...(hoReportSheet[cellRef].s.alignment || {}), horizontal: "right" };
                }
              }
            }
            if (col.includes("date")) {
              hoReportSheet[cellRef].v = formatDateValue(hoReportSheet[cellRef].v);
              hoReportSheet[cellRef].t = "s";
            }
          }
        }
      }
      
      XLSX.utils.book_append_sheet(workbook, hoReportSheet, getUniqueSheetName("HO Report Updated", usedSheetNames));

      // =====================================================
      // SHEET 5: Draft Messages
      // =====================================================
      // Get billing entity name from first HO row (all rows in a file typically share the same billing entity)
      const firstHoRow = originalHoData[0] as Record<string, unknown> | undefined;
      const billingEntityName = firstHoRow 
        ? String(firstHoRow["billingEntityName"] || firstHoRow["beId"] || firstHoRow["be_id"] || firstHoRow["billing_entity_id"] || "[Billing Entity]")
        : "[Billing Entity]";
      
      // Build TID summary groups for each DRI + reason combo
      type TidSummary = {
        tid: string;
        discrepancyLc: number;
        discrepancyUsd: number;
        currency: string;
        startDate: string;
        endDate: string;
        countBidWithDiscrepancy: number;
        countBidsInDuration: number;
        discrepancyPercent: string;
        pattern: string;
        frequency: string;
        fulfillmentMethod: string;
        timesCharged: string;
        hoTakeRate: string;
        actualTakeRate: string;
        soldAtLoss: boolean;
        lossUsd: number;
        hoNetPerPax: number;
        spChargedPerPax: number;
      };
      
      const driReasonGroups = new Map<string, TidSummary[]>();
      
      for (const group of Array.from(tidGroups.values())) {
        const key = `${group.driTeam}:${group.reason}`;
        if (!driReasonGroups.has(key)) {
          driReasonGroups.set(key, []);
        }
        
        const sortedDates = group.dates.sort();
        const startDate = sortedDates.length > 0 ? sortedDates[0] : "";
        const endDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : "";
        const countBidWithDiscrepancy = group.bookingIds.size;
        
        let countBidsInDuration = countBidWithDiscrepancy;
        if (startDate && endDate) {
          countBidsInDuration = allPrimaryRows.filter(r => 
            r.tid === group.tid && r.bookingCreationDate && 
            r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
          ).length;
        }
        
        const timesCharged = group.hoNetTotal !== 0
          ? (group.spNetTotal / group.hoNetTotal).toFixed(2) + "x"
          : "N/A";
        
        let discrepancyPercent = "";
        let pattern = "";
        if (group.discrepancyPercents.length > 0) {
          const uniquePercents = Array.from(new Set(group.discrepancyPercents.map((p: number) => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePercents.length === 1) {
            discrepancyPercent = minPct.toFixed(4);
            pattern = "Consistent";
          } else {
            discrepancyPercent = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
            pattern = "Scattered";
          }
        }
        
        const frequency = countBidWithDiscrepancy >= 5 ? "Recurring" : "One-off";
        
        const avgHoTakeRate = group.hoTakeRates.length > 0 
          ? (group.hoTakeRates.reduce((a: number, b: number) => a + b, 0) / group.hoTakeRates.length).toFixed(2) + "%"
          : "N/A";
        const avgActualTakeRate = group.actualTakeRates.length > 0
          ? (group.actualTakeRates.reduce((a: number, b: number) => a + b, 0) / group.actualTakeRates.length).toFixed(2) + "%"
          : "N/A";
        
        const lossUsd = group.hasSoldAtLoss && group.discrepancyLc !== 0
          ? Math.abs(group.lossLcTotal * group.discrepancyUsd / group.discrepancyLc)
          : 0;
        
        const hoNetPerPax = countBidWithDiscrepancy > 0 ? group.hoNetTotal / countBidWithDiscrepancy : 0;
        const spChargedPerPax = countBidWithDiscrepancy > 0 ? group.spNetTotal / countBidWithDiscrepancy : 0;
        
        driReasonGroups.get(key)!.push({
          tid: group.tid,
          discrepancyLc: group.discrepancyLc,
          discrepancyUsd: group.discrepancyUsd,
          currency: group.currency,
          startDate,
          endDate,
          countBidWithDiscrepancy,
          countBidsInDuration,
          discrepancyPercent,
          pattern,
          frequency,
          fulfillmentMethod: group.fulfillmentMethod,
          timesCharged,
          hoTakeRate: avgHoTakeRate,
          actualTakeRate: avgActualTakeRate,
          soldAtLoss: group.hasSoldAtLoss,
          lossUsd,
          hoNetPerPax,
          spChargedPerPax,
        });
      }
      
      // Build the sheet as array of arrays for custom layout
      const draftRows: (string | number | Date | null)[][] = [];
      
      // Track table regions for styling: { startRow, endRow, numCols }
      const tableRegions: { startRow: number; endRow: number; numCols: number; type: 'header' | 'tid' | 'dri' }[] = [];
      
      // Helper to convert date string to Excel serial number (same formula as Discrepancy Analysis)
      const dateToExcelSerial = (dateStr: string): number | string => {
        if (!dateStr) return "";
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        // Convert JS Date to Excel serial (days since Jan 1, 1900) - same formula as toExcelDate
        return Math.floor((date.getTime() / 86400000) + 25569);
      };
      
      // Helper to format date for display in message text (handles both string dates and Excel serial numbers)
      const formatDateForMessage = (dateVal: string | number): string => {
        if (!dateVal && dateVal !== 0) return "";
        
        // If it's an Excel serial number (numeric and > 25000)
        if (typeof dateVal === "number" || (typeof dateVal === "string" && !isNaN(parseFloat(dateVal)) && parseFloat(dateVal) > 25000)) {
          const serial = typeof dateVal === "number" ? dateVal : parseFloat(dateVal);
          // Convert Excel serial to JS Date: (serial - 25569) * 86400000
          const jsDate = new Date((serial - 25569) * 86400000);
          if (!isNaN(jsDate.getTime())) {
            return jsDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
          }
        }
        
        // Try parsing as regular date string
        const date = new Date(String(dateVal));
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        }
        
        return String(dateVal);
      };
      
      // Helper to add a DRI message block with optional TID table
      const addNpdBlock = (driTeam: string, tids: TidSummary[]) => {
        if (tids.length === 0) return;
        
        // Sort by discrepancy USD lowest to highest
        const sortedTids = [...tids].sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
        
        // Calculate aggregates
        const allDates = sortedTids.flatMap(t => [t.startDate, t.endDate]).filter(d => d).sort();
        const overallStart = allDates.length > 0 ? allDates[0] : "";
        const overallEnd = allDates.length > 0 ? allDates[allDates.length - 1] : "";
        const totalDiscrepancyUsd = sortedTids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
        const totalBidCount = sortedTids.reduce((sum, t) => sum + t.countBidWithDiscrepancy, 0);
        const totalBidsInDuration = sortedTids.reduce((sum, t) => sum + t.countBidsInDuration, 0);
        const discCoverage = totalBidsInDuration > 0 
          ? ((totalBidCount / totalBidsInDuration) * 100).toFixed(2) + "%"
          : "N/A";
        
        let message = "";
        if (driTeam === "BizOps" || driTeam === "Biz Ops") {
          message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Total discrepancy: ${totalDiscrepancyUsd.toFixed(2)} USD. Can you please share with RCA what went wrong here?\n\nSummary screenshot is attached; booking-level details are in the Google Sheet.`;
        } else if (driTeam === "Inventory Ops") {
          message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Total discrepancy: ${totalDiscrepancyUsd.toFixed(2)} USD. Since these are API products, can you confirm the price-sync status for the TIDs listed?\n\nSummary screenshot is attached; booking-level details are in the Google Sheet.`;
        } else {
          message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Total discrepancy: ${totalDiscrepancyUsd.toFixed(2)} USD. Can you please investigate and provide an RCA?\n\nSummary screenshot is attached; booking-level details are in the Google Sheet.`;
        }
        
        // DRI header row
        const driHeaderRow = draftRows.length;
        draftRows.push(["DRI team", "Slack draft"]);
        tableRegions.push({ startRow: driHeaderRow, endRow: driHeaderRow, numCols: 2, type: 'dri' });
        
        // DRI data row
        draftRows.push([driTeam, message]);
        tableRegions.push({ startRow: driHeaderRow + 1, endRow: driHeaderRow + 1, numCols: 2, type: 'dri' });
        
        // TID table header
        const tidHeaderRow = draftRows.length;
        draftRows.push(["TID", "Discrepancy USD", "Start Date", "End date", "Count of BID with discrepancy", "Count BIDs in duration", "Discrepancy %", "Pattern", "Frequency", "Fulfillment method"]);
        
        // TID table rows
        for (const t of sortedTids) {
          draftRows.push([
            t.tid,
            t.discrepancyUsd,
            dateToExcelSerial(t.startDate),
            dateToExcelSerial(t.endDate),
            t.countBidWithDiscrepancy,
            t.countBidsInDuration,
            t.discrepancyPercent,
            t.pattern,
            t.frequency,
            t.fulfillmentMethod
          ]);
        }
        tableRegions.push({ startRow: tidHeaderRow, endRow: draftRows.length - 1, numCols: 10, type: 'tid' });
        
        // Single empty row between blocks
        draftRows.push([]);
      };
      
      const addMtbBlock = (driTeam: string, tids: TidSummary[]) => {
        if (tids.length === 0) return;
        
        // Sort by discrepancy USD lowest to highest
        const sortedTids = [...tids].sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
        
        // Calculate aggregates
        const allDates = sortedTids.flatMap(t => [t.startDate, t.endDate]).filter(d => d).sort();
        const overallStart = allDates.length > 0 ? allDates[0] : "";
        const overallEnd = allDates.length > 0 ? allDates[allDates.length - 1] : "";
        const totalDiscrepancyUsd = sortedTids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
        const tidList = sortedTids.map(t => t.tid).join(", ");
        const totalBidCount = sortedTids.reduce((sum, t) => sum + t.countBidWithDiscrepancy, 0);
        const totalBidsInDuration = sortedTids.reduce((sum, t) => sum + t.countBidsInDuration, 0);
        const discCoverage = totalBidsInDuration > 0 
          ? ((totalBidCount / totalBidsInDuration) * 100).toFixed(2) + "%"
          : "N/A";
        
        let message = "";
        if (driTeam === "Tech" || driTeam === "Tech (BAR)") {
          message = `Hey @bar, we have observed multiple tickets booked for products on API. The TIDs involved here are ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). The booking level data has been attached below. Can you check the issue and share RCA and fix for this?`;
        } else if (driTeam === "Reservation Ops") {
          message = `Hey Reservation Ops - We have observed multiple tickets booked for TIDs ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please confirm what went wrong here?`;
        } else if (driTeam === "Selenium") {
          message = `Hey Selenium Team - We have observed multiple tickets booked for TIDs ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please investigate?`;
        } else if (driTeam === "Inventory Ops") {
          message = `Hey Inventory Ops - We have observed multiple tickets booked for TIDs ${tidList} (Pre Purchase). The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please check the inventory allocation?`;
        } else {
          message = `Hey ${driTeam} - We have observed multiple tickets booked for TIDs ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please investigate?`;
        }
        
        // DRI header row
        const driHeaderRow = draftRows.length;
        draftRows.push(["DRI team", "Slack draft"]);
        tableRegions.push({ startRow: driHeaderRow, endRow: driHeaderRow, numCols: 2, type: 'dri' });
        
        // DRI data row
        draftRows.push([driTeam, message]);
        tableRegions.push({ startRow: driHeaderRow + 1, endRow: driHeaderRow + 1, numCols: 2, type: 'dri' });
        
        // Single empty row between blocks
        draftRows.push([]);
      };
      
      // Section: Multiple Tickets Booked
      // Find ALL DRI teams that have MTB entries (dynamic discovery)
      const mtbKeys = Array.from(driReasonGroups.keys()).filter(k => k.endsWith(":Multiple Tickets Booked"));
      const hasMtb = mtbKeys.length > 0;
      
      if (hasMtb) {
        const sectionHeaderRow = draftRows.length;
        draftRows.push(["Draft messages - Multiple Tickets Booked"]);
        tableRegions.push({ startRow: sectionHeaderRow, endRow: sectionHeaderRow, numCols: 1, type: 'header' });
        
        // Tech MTB section
        const techMtbTids = driReasonGroups.get("Tech:Multiple Tickets Booked") || [];
        if (techMtbTids.length > 0) {
          const subHeaderRow = draftRows.length;
          draftRows.push(["Draft messages - Tech (MTB)"]);
          tableRegions.push({ startRow: subHeaderRow, endRow: subHeaderRow, numCols: 1, type: 'header' });
          addMtbBlock("Tech (BAR)", techMtbTids);
        }
        
        // Other specific MTB teams
        for (const dri of ["Reservation Ops", "Selenium", "Inventory Ops"]) {
          const tids = driReasonGroups.get(`${dri}:Multiple Tickets Booked`) || [];
          addMtbBlock(dri, tids);
        }
        
        // Catch any other/unknown DRI teams (not already handled above)
        const handledMtbTeams = new Set(["Tech", "Reservation Ops", "Selenium", "Inventory Ops"]);
        for (const key of mtbKeys) {
          const dri = key.replace(":Multiple Tickets Booked", "");
          if (!handledMtbTeams.has(dri)) {
            const tids = driReasonGroups.get(key) || [];
            addMtbBlock(dri, tids);
          }
        }
      }
      
      // Section: Net Price Discrepancy
      // Find ALL DRI teams that have NPD entries (dynamic discovery)
      const npdKeys = Array.from(driReasonGroups.keys()).filter(k => k.endsWith(":Net Price Discrepancy"));
      const hasNpd = npdKeys.length > 0;
      
      if (hasNpd) {
        const sectionHeaderRow = draftRows.length;
        draftRows.push(["Draft messages - Net Price Discrepancy"]);
        tableRegions.push({ startRow: sectionHeaderRow, endRow: sectionHeaderRow, numCols: 1, type: 'header' });
        
        // BizOps NPD
        const bizOpsNpdTids = driReasonGroups.get("Biz Ops:Net Price Discrepancy") || [];
        addNpdBlock("BizOps", bizOpsNpdTids);
        
        // Inventory Ops NPD
        const inventoryOpsNpdTids = driReasonGroups.get("Inventory Ops:Net Price Discrepancy") || [];
        addNpdBlock("Inventory Ops", inventoryOpsNpdTids);
        
        // Selenium NPD
        const seleniumNpdTids = driReasonGroups.get("Selenium:Net Price Discrepancy") || [];
        addNpdBlock("Selenium", seleniumNpdTids);
        
        // Tech NPD
        const techNpdTids = driReasonGroups.get("Tech:Net Price Discrepancy") || [];
        addNpdBlock("Tech", techNpdTids);
        
        // Catch any other/unknown DRI teams (not already handled above)
        const handledNpdTeams = new Set(["Biz Ops", "Inventory Ops", "Selenium", "Tech"]);
        for (const key of npdKeys) {
          const dri = key.replace(":Net Price Discrepancy", "");
          if (!handledNpdTeams.has(dri)) {
            const tids = driReasonGroups.get(key) || [];
            addNpdBlock(dri, tids);
          }
        }
      }
      
      const draftMessagesSheet = XLSX.utils.aoa_to_sheet(draftRows);
      
      // Apply styling: borders, number/date formats (no fill colors)
      const draftBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
      const draftBorder = { top: draftBorderStyle, bottom: draftBorderStyle, left: draftBorderStyle, right: draftBorderStyle };
      
      for (const region of tableRegions) {
        for (let r = region.startRow; r <= region.endRow; r++) {
          for (let c = 0; c < region.numCols; c++) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (!draftMessagesSheet[cellRef]) draftMessagesSheet[cellRef] = { v: "", t: "s" };
            
            // Merge into existing style (preserve any existing properties)
            const existingStyle = draftMessagesSheet[cellRef].s || {};
            draftMessagesSheet[cellRef].s = {
              ...existingStyle,
              border: draftBorder,
              alignment: existingStyle.alignment || {}
            };
            
            // Bold for headers
            if (region.type === 'header' || (region.type === 'tid' && r === region.startRow) || (region.type === 'dri' && r === region.startRow)) {
              draftMessagesSheet[cellRef].s.font = { ...(draftMessagesSheet[cellRef].s.font || {}), bold: true };
            }
            
            // Indian number format for Discrepancy USD (column 1 in TID table, index 1)
            if (region.type === 'tid' && c === 1 && r > region.startRow) {
              if (typeof draftMessagesSheet[cellRef].v === "number") {
                draftMessagesSheet[cellRef].v = formatIndianNumber(draftMessagesSheet[cellRef].v);
                draftMessagesSheet[cellRef].t = "s";
                draftMessagesSheet[cellRef].s.alignment = { ...(draftMessagesSheet[cellRef].s.alignment || {}), horizontal: "right" };
              }
            }
            
            // Date format for Start Date (col 2) and End Date (col 3) in TID table
            if (region.type === 'tid' && (c === 2 || c === 3) && r > region.startRow) {
              const val = draftMessagesSheet[cellRef].v;
              // Convert to formatted date string DD/MM/YYYY
              draftMessagesSheet[cellRef].v = formatDateValue(val);
              draftMessagesSheet[cellRef].t = "s";
            }
          }
        }
      }
      
      // Remove gridlines
      draftMessagesSheet["!sheetViews"] = [{ showGridLines: false }];
      
      // Column widths - Column B (Slack draft) limited to 30 characters wide
      draftMessagesSheet["!cols"] = [
        { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, 
        { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 18 }
      ];
      
      // Apply wrapText to column B (Slack draft column, index 1) - MUST be done after table styling
      const range = XLSX.utils.decode_range(draftMessagesSheet["!ref"] || "A1");
      for (let r = 0; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 1 });
        if (draftMessagesSheet[cellRef]) {
          // Preserve existing style properties while adding wrap text
          draftMessagesSheet[cellRef].s = draftMessagesSheet[cellRef].s || {};
          draftMessagesSheet[cellRef].s.alignment = { 
            ...draftMessagesSheet[cellRef].s.alignment,
            wrapText: true, 
            vertical: "top" 
          };
        }
      }
      XLSX.utils.book_append_sheet(workbook, draftMessagesSheet, getUniqueSheetName("Draft Messages", usedSheetNames));

      // =====================================================
      // DRI TEAM TABS - One sheet per DRI + Reason combination
      // =====================================================
      // Group discrepancy rows by DRI team + reason
      const driReasonRowGroups = new Map<string, typeof discrepancyRows>();
      for (const row of discrepancyRows) {
        const key = `${row.driTeam || "Unknown"}_${row.reason}`;
        if (!driReasonRowGroups.has(key)) {
          driReasonRowGroups.set(key, []);
        }
        driReasonRowGroups.get(key)!.push(row);
      }
      
      // Create a lookup map from bookingId to original HO data for additional fields
      const hoDataLookup = new Map<string, Record<string, unknown>>();
      for (const hoRow of originalHoData as Record<string, unknown>[]) {
        const bookingId = String(hoRow["bookingId"] || hoRow["Booking ID"] || hoRow["booking_id"] || "");
        if (bookingId) {
          hoDataLookup.set(bookingId, hoRow);
        }
      }
      
      // Helper to get value from original HO row with multiple aliases
      const getHoValue = (hoRow: Record<string, unknown> | undefined, ...aliases: string[]): unknown => {
        if (!hoRow) return "";
        for (const alias of aliases) {
          if (hoRow[alias] !== undefined && hoRow[alias] !== null) {
            return hoRow[alias];
          }
        }
        return "";
      };
      
      // Create a sheet for each DRI + reason group
      for (const [key, rows] of Array.from(driReasonRowGroups.entries())) {
        const [driTeam, reason] = key.split("_");
        
        // Build sheet data with required columns
        const sheetData = rows.map((row: typeof discrepancyRows[0]) => {
          const hoRow = hoDataLookup.get(row.bookingId);
          
          // Calculate take rates
          const hoSp = row.headoutSellingPrice || 0;
          const hoTakeRate = hoSp > 0 ? ((hoSp - row.hoNet) / hoSp * 100).toFixed(2) + "%" : "";
          const actualTakeRate = hoSp > 0 ? ((hoSp - row.spNetInHo) / hoSp * 100).toFixed(2) + "%" : "";
          
          // Determine comments based on reason
          let comments = "";
          if (row.reason === "Multiple Tickets Booked") {
            comments = "MTB";
          } else if (row.reason === "Net Price Discrepancy") {
            comments = "NPD";
          }
          
          return {
            "Booking ID": row.bookingId,
            "Creation Date": row.bookingCreationDate || "",
            "Experience Date": getHoValue(hoRow, "experienceDate", "Experience Date", "experience_date", "tourDate", "Tour Date"),
            "TGID": getHoValue(hoRow, "tgid", "TGID", "tourGroupId", "Tour Group ID"),
            "Experience Name": row.experienceName || "",
            "TID": row.tid || "",
            "VID": getHoValue(hoRow, "vid", "VID", "variantId", "Variant ID", "variant_id"),
            "Currency": row.hoCurrency,
            "Vendor Name": row.supplierName || "",
            "Billing Entity Name": getHoValue(hoRow, "billingEntityName", "beId", "be_id", "billing_entity_id", "Billing Entity"),
            "Booking Status": row.bookingStatus || "",
            "FF Method": row.fulfillmentMethod || "",
            "Payment Method": getHoValue(hoRow, "paymentMethod", "Payment Method", "payment_method"),
            "HO SP": hoSp || "",
            "HO Net": row.hoNet,
            "HO Take Rate": hoTakeRate,
            "SP Net": row.spNetInHo,
            "Actual Take Rate": actualTakeRate,
            "Difference LC": row.differenceLc,
            "Difference %": ((row.differencePct || 0) * 100).toFixed(2) + "%",
            "Difference USD": row.differenceUsd,
            "Comments": comments,
          };
        });
        
        if (sheetData.length === 0) continue;
        
        const driSheet = XLSX.utils.json_to_sheet(sheetData);
        
        // Apply formatting with borders and no fill colors
        const driRange = XLSX.utils.decode_range(driSheet["!ref"] || "A1");
        const driBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
        const driBorder = { top: driBorderStyle, bottom: driBorderStyle, left: driBorderStyle, right: driBorderStyle };
        
        for (let r = 0; r <= driRange.e.r; r++) {
          for (let c = 0; c <= driRange.e.c; c++) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (!driSheet[cellRef]) continue;
            
            // Merge into existing style (preserve any existing properties)
            const existingStyle = driSheet[cellRef].s || {};
            driSheet[cellRef].s = {
              ...existingStyle,
              border: driBorder
            };
            
            // Bold header row
            if (r === 0) {
              driSheet[cellRef].s.font = { ...(driSheet[cellRef].s.font || {}), bold: true };
            }
            
            // Date format for Creation Date (col 1) and Experience Date (col 2) in data rows
            if (r > 0 && (c === 1 || c === 2)) {
              const val = driSheet[cellRef].v;
              if (val) {
                driSheet[cellRef].v = formatDateValue(val);
                driSheet[cellRef].t = "s";
              }
            }
            
            // Indian number format for numeric columns in data rows
            const numericCols = [13, 14, 16, 18, 20]; // HO SP, HO Net, SP Net, Difference LC, Difference USD
            if (r > 0 && numericCols.includes(c)) {
              if (typeof driSheet[cellRef].v === "number") {
                driSheet[cellRef].v = formatIndianNumber(driSheet[cellRef].v);
                driSheet[cellRef].t = "s";
                driSheet[cellRef].s.alignment = { ...(driSheet[cellRef].s.alignment || {}), horizontal: "right" };
              }
            }
          }
        }
        
        // Set column widths
        driSheet["!cols"] = [
          { wch: 15 }, // Booking ID
          { wch: 12 }, // Creation Date
          { wch: 12 }, // Experience Date
          { wch: 10 }, // TGID
          { wch: 30 }, // Experience Name
          { wch: 10 }, // TID
          { wch: 10 }, // VID
          { wch: 10 }, // Currency
          { wch: 20 }, // Vendor Name
          { wch: 20 }, // Billing Entity Name
          { wch: 15 }, // Booking Status
          { wch: 12 }, // FF Method
          { wch: 15 }, // Payment Method
          { wch: 12 }, // HO SP
          { wch: 12 }, // HO Net
          { wch: 12 }, // HO Take Rate
          { wch: 12 }, // SP Net
          { wch: 12 }, // Actual Take Rate
          { wch: 12 }, // Difference LC
          { wch: 12 }, // Difference %
          { wch: 12 }, // Difference USD
          { wch: 15 }, // Comments
        ];
        
        // Remove gridlines
        driSheet["!sheetViews"] = [{ showGridLines: false }];
        
        // Create sheet name (Excel limits to 31 chars, sanitize illegal characters, ensure uniqueness)
        const shortReason = reason === "Multiple Tickets Booked" ? "MTB" : reason === "Net Price Discrepancy" ? "NPD" : reason.substring(0, 10);
        const rawSheetName = `${driTeam.substring(0, 20)}_${shortReason}`;
        const sheetName = getUniqueSheetName(rawSheetName, usedSheetNames);
        
        XLSX.utils.book_append_sheet(workbook, driSheet, sheetName);
      }

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // Set response headers
      const filename = `reconciliation_export_${runId.substring(0, 8)}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export results" });
    }
  });

  /**
   * POST /api/runs/:runId/export-gsheet
   * Export reconciliation results to Google Sheets
   */
  app.post("/api/runs/:runId/export-gsheet", async (req, res) => {
    try {
      const { runId } = req.params;
      const run = await storage.getRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "done") {
        return res.status(400).json({ error: "Run not complete" });
      }

      const result = await storage.getRunResult(runId);
      if (!result) {
        return res.status(404).json({ error: "Results not found" });
      }

      // Get original upload data for enriched export
      const upload = await storage.getUpload(run.uploadId);
      const originalHoData = upload?.hoData?.rows || [];
      const originalSpData = upload?.spData?.rows || [];

      // Build lookup maps
      const allRowsMap = new Map<string, typeof result.allRows[0][]>();
      for (const r of result.allRows) {
        const existing = allRowsMap.get(r.bookingId) || [];
        existing.push(r);
        allRowsMap.set(r.bookingId, existing);
      }
      const spFxMap = new Map(result.spFxDebugRows.map(r => [r.bookingId, r]));

      // Get Google Sheets client
      const sheets = await getUncachableGoogleSheetClient();

      // Collect DRI sheets dynamically
      const discrepancyRows = [...result.primaryRows, ...result.secondaryVendorRows].filter(r => r.reason !== "Reconciled");
      const driReasonRowGroups = new Map<string, typeof discrepancyRows>();
      for (const row of discrepancyRows) {
        const key = `${row.driTeam || "Unknown"}_${row.reason}`;
        if (!driReasonRowGroups.has(key)) {
          driReasonRowGroups.set(key, []);
        }
        driReasonRowGroups.get(key)!.push(row);
      }

      // Build sheet definitions - main sheets + DRI sheets
      const sheetDefs: { properties: { title: string } }[] = [
        { properties: { title: "Payable Summary" } },
        { properties: { title: "Discrepancy Analysis" } },
        { properties: { title: "SP Invoice Report" } },
        { properties: { title: "HO Report Updated" } },
        { properties: { title: "Draft Messages" } },
      ];

      // Add DRI sheets
      const driSheetNames: string[] = [];
      for (const key of Array.from(driReasonRowGroups.keys())) {
        const [driTeam, reason] = key.split("_");
        const shortReason = reason === "Multiple Tickets Booked" ? "MTB" : reason === "Net Price Discrepancy" ? "NPD" : reason.substring(0, 10);
        const sheetName = `${driTeam.substring(0, 20)}_${shortReason}`.substring(0, 31);
        driSheetNames.push(sheetName);
        sheetDefs.push({ properties: { title: sheetName } });
      }

      // Create spreadsheet with all sheets
      const spreadsheetTitle = `Reconciliation Export - ${new Date().toISOString().split("T")[0]}`;
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: spreadsheetTitle },
          sheets: sheetDefs,
        },
      });

      const spreadsheetId = createResponse.data.spreadsheetId;
      const spreadsheetUrl = createResponse.data.spreadsheetUrl;

      if (!spreadsheetId) {
        throw new Error("Failed to create spreadsheet");
      }

      // ===== Sheet 1: Payable Summary =====
      const spTotalByCurrency = new Map<string, number>();
      for (const r of result.spFxDebugRows) {
        spTotalByCurrency.set(r.spCurrency, (spTotalByCurrency.get(r.spCurrency) || 0) + r.spNetOriginal);
      }
      const hoTotalByCurrency = new Map<string, number>();
      for (const r of result.primaryRows) {
        hoTotalByCurrency.set(r.hoCurrency, (hoTotalByCurrency.get(r.hoCurrency) || 0) + r.hoNet);
      }

      const payableSummaryData: (string | number)[][] = [["Description", "Currency", "Amount", "Note"]];
      Array.from(spTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push(["Payable as per SP", ccy, formatIndianNumber(amount), "Sum of SP Invoice"]);
      });
      Array.from(hoTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push(["Payable as per HO", ccy, formatIndianNumber(amount), "Sum of HO Net (Primary only)"]);
      });

      // ===== Sheet 2: Discrepancy Analysis (with TID breakdown) =====
      // Combine primary and secondary vendor summaries, excluding Reconciled
      const discrepancySummary = [...result.overallSummary, ...result.secondaryVendorSummary].filter(r => r.reason !== "Reconciled");
      const allPrimaryRows = result.primaryRows;

      // Group by REASON + TID (with full fields matching Excel)
      const tidGroups = new Map<string, {
        tid: string; currency: string; discrepancyLc: number; discrepancyUsd: number;
        fulfillmentMethod: string; spNetTotal: number; hoNetTotal: number;
        dates: string[]; bookingIds: Set<string>; driTeam: string; reason: string;
        hoTakeRates: number[]; actualTakeRates: number[]; discrepancyPercents: number[];
        hasSoldAtLoss: boolean; lossLcTotal: number;
      }>();

      for (const row of discrepancyRows) {
        const tid = row.tid || "Unknown";
        const compositeKey = `${row.reason}:${tid}`;
        if (!tidGroups.has(compositeKey)) {
          tidGroups.set(compositeKey, {
            tid, currency: row.hoCurrency, discrepancyLc: 0, discrepancyUsd: 0,
            fulfillmentMethod: row.fulfillmentMethod || "Unknown", spNetTotal: 0, hoNetTotal: 0,
            dates: [], bookingIds: new Set(), driTeam: row.driTeam || "Unknown", reason: row.reason,
            hoTakeRates: [], actualTakeRates: [], discrepancyPercents: [],
            hasSoldAtLoss: false, lossLcTotal: 0,
          });
        }
        const group = tidGroups.get(compositeKey)!;
        group.discrepancyLc += row.differenceLc;
        group.discrepancyUsd += row.differenceUsd;
        group.spNetTotal += row.spNetInHo;
        group.hoNetTotal += row.hoNet;
        if (row.bookingCreationDate) group.dates.push(row.bookingCreationDate);
        group.bookingIds.add(row.bookingId);
        const hsp = row.headoutSellingPrice;
        if (hsp && hsp > 0) {
          group.hoTakeRates.push((hsp - row.hoNet) / hsp * 100);
          group.actualTakeRates.push((hsp - row.spNetInHo) / hsp * 100);
          // Check sold at loss (actual take rate < 0)
          if ((hsp - row.spNetInHo) / hsp < 0) {
            group.hasSoldAtLoss = true;
            group.lossLcTotal += row.differenceLc;
          }
        }
        if (row.hoNet !== 0) {
          group.discrepancyPercents.push(((row.hoNet - row.spNetInHo) / row.hoNet) * 100);
        }
      }
      
      // Get total BIDs in report for coverage calculations
      const totalBidsInReport = allPrimaryRows.length;

      // Build discrepancy analysis data with Indian number format
      const discrepancyData: (string | number)[][] = [
        ["OVERALL DISCREPANCY SUMMARY"],
        ["Reason", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Count BID"],
      ];
      discrepancySummary.forEach(row => {
        discrepancyData.push([
          row.reason, 
          row.currency, 
          formatIndianNumber(row.discrepancyLc), 
          formatIndianNumber(row.discrepancyUsd), 
          row.countBid
        ]);
      });
      discrepancyData.push([]);

      // Add TID-level analysis
      const tidByReason = new Map<string, typeof tidGroups extends Map<string, infer V> ? V[] : never>();
      for (const [, group] of Array.from(tidGroups.entries())) {
        if (!tidByReason.has(group.reason)) tidByReason.set(group.reason, []);
        tidByReason.get(group.reason)!.push(group);
      }
      
      // Sort groups by Discrepancy USD (negative highest to positive lowest)
      for (const [, groupList] of Array.from(tidByReason.entries())) {
        groupList.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
      }

      for (const [reason, groups] of Array.from(tidByReason.entries())) {
        discrepancyData.push([`${reason.toUpperCase()} ANALYSIS`]);
        
        // Use reason-specific columns matching Excel
        const isMtb = reason.toLowerCase().includes("multiple") || reason === "MTB";
        const isNpd = reason.toLowerCase().includes("price") || reason === "NPD";
        
        if (isMtb) {
          discrepancyData.push(["TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment", "Times Charged", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Total BIDs", "Coverage %", "Frequency", "DRI Team"]);
        } else if (isNpd) {
          discrepancyData.push(["TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "HO Take Rate", "Actual Take Rate", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Coverage %", "Discrepancy % Range", "Pattern", "Frequency", "Fulfillment", "DRI Team", "Sold at Loss", "Loss (LC)", "Loss (USD)"]);
        } else {
          discrepancyData.push(["TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment", "Start Date", "End Date", "BID Count", "Total BIDs", "Coverage %", "Frequency", "DRI Team"]);
        }
        
        for (const g of groups) {
          const sortedDates = g.dates.sort();
          const startDate = sortedDates[0] || "";
          const endDate = sortedDates[sortedDates.length - 1] || "";
          const timesCharged = g.hoNetTotal !== 0 ? (g.spNetTotal / g.hoNetTotal).toFixed(2) + "x" : "N/A";
          const frequency = g.bookingIds.size >= 5 ? "Recurring" : "One-Off";
          const bidCount = g.bookingIds.size;
          
          // Calculate BIDs in duration (bookings for this TID within date range)
          let bidsInDuration = bidCount;
          if (startDate && endDate) {
            bidsInDuration = allPrimaryRows.filter(r =>
              r.tid === g.tid && r.bookingCreationDate &&
              r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
            ).length;
          }
          const coveragePct = bidsInDuration > 0 ? ((bidCount / bidsInDuration) * 100).toFixed(2) + "%" : "N/A";
          
          // Calculate take rates and pattern
          const avgHoTakeRate = g.hoTakeRates.length > 0
            ? (g.hoTakeRates.reduce((a, b) => a + b, 0) / g.hoTakeRates.length).toFixed(2) + "%"
            : "N/A";
          const avgActualTakeRate = g.actualTakeRates.length > 0
            ? (g.actualTakeRates.reduce((a, b) => a + b, 0) / g.actualTakeRates.length).toFixed(2) + "%"
            : "N/A";
          
          let discPctRange = "";
          let pattern = "";
          if (g.discrepancyPercents.length > 0) {
            const uniquePcts = Array.from(new Set(g.discrepancyPercents.map(p => Math.round(p * 100) / 100)));
            const minPct = Math.min(...g.discrepancyPercents);
            const maxPct = Math.max(...g.discrepancyPercents);
            if (uniquePcts.length === 1) {
              discPctRange = minPct.toFixed(2) + "%";
              pattern = "Consistent";
            } else {
              discPctRange = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
              pattern = "Scattered";
            }
          }
          
          // Calculate loss USD
          const lossUsd = g.hasSoldAtLoss && g.discrepancyLc !== 0
            ? Math.abs(g.lossLcTotal * g.discrepancyUsd / g.discrepancyLc)
            : 0;
          
          // Apply Indian number format and date format
          const formattedDiscLc = formatIndianNumber(g.discrepancyLc);
          const formattedDiscUsd = formatIndianNumber(g.discrepancyUsd);
          const formattedStartDate = formatDateValue(startDate);
          const formattedEndDate = formatDateValue(endDate);
          const formattedLossLc = g.hasSoldAtLoss ? formatIndianNumber(g.lossLcTotal) : "";
          const formattedLossUsd = g.hasSoldAtLoss ? formatIndianNumber(lossUsd) : "";
          
          if (isMtb) {
            discrepancyData.push([
              g.tid, g.currency, formattedDiscLc, formattedDiscUsd, g.fulfillmentMethod,
              timesCharged, formattedStartDate, formattedEndDate, bidCount, bidsInDuration, totalBidsInReport, coveragePct, frequency, g.driTeam
            ]);
          } else if (isNpd) {
            discrepancyData.push([
              g.tid, g.currency, formattedDiscLc, formattedDiscUsd, avgHoTakeRate, avgActualTakeRate,
              formattedStartDate, formattedEndDate, bidCount, bidsInDuration, coveragePct, discPctRange, pattern, frequency, g.fulfillmentMethod, g.driTeam,
              g.hasSoldAtLoss ? "Yes" : "No", formattedLossLc, formattedLossUsd
            ]);
          } else {
            discrepancyData.push([
              g.tid, g.currency, formattedDiscLc, formattedDiscUsd, g.fulfillmentMethod,
              formattedStartDate, formattedEndDate, bidCount, totalBidsInReport, coveragePct, frequency, g.driTeam
            ]);
          }
        }
        discrepancyData.push([]);
      }

      // ===== Sheet 3: SP Invoice Report (enriched) =====
      // Match Excel: include ALL original columns + SP Net (HO Currency) + FX Rate Used
      const spReportData: (string | number | null)[][] = [];
      
      // Get headers from first row of original data
      const firstSpRow = originalSpData[0] as Record<string, unknown> | undefined;
      const spOriginalHeaders = firstSpRow ? Object.keys(firstSpRow) : [];
      const spAllHeaders = [...spOriginalHeaders, "SP Net (HO Currency)", "FX Rate Used"];
      spReportData.push(spAllHeaders);
      
      for (const row of originalSpData as Record<string, unknown>[]) {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const spFxRow = spFxMap.get(bookingId);
        
        // Build row with all original columns + enriched columns
        const dataRow: (string | number | null)[] = spOriginalHeaders.map(header => {
          const val = row[header];
          const headerLower = header.toLowerCase();
          
          // Format numbers with Indian notation
          if ((headerLower.includes("net") || headerLower.includes("amount") || headerLower.includes("price")) && typeof val === "number") {
            return formatIndianNumber(val);
          }
          // Format dates
          if (headerLower.includes("date")) {
            return formatDateValue(val as string | number);
          }
          
          return val as string | number | null ?? "";
        });
        
        // Add enriched columns with Indian number format
        dataRow.push(spFxRow?.spNetInHo !== undefined ? formatIndianNumber(spFxRow.spNetInHo) : "");
        dataRow.push(spFxRow?.fxRateUsed ?? "");
        
        spReportData.push(dataRow);
      }

      // ===== Sheet 4: HO Report Updated (enriched) - matching Excel format =====
      // Uses original HO data with SP Net, Difference, Difference % inserted before finalNetPrice
      // Updates finalNetPrice, errorTeamAttribution, errorBucket, comments based on reason
      
      // Parse date value safely - same logic as Excel export
      const gsParseDate = (dateValue: string | number | null | undefined): number => {
        if (dateValue === null || dateValue === undefined || dateValue === "") return 0;
        if (typeof dateValue === "number" || !isNaN(Number(dateValue))) {
          const numValue = Number(dateValue);
          if (numValue > 40000 && numValue < 60000) {
            const excelEpoch = new Date(1899, 11, 30).getTime();
            const msPerDay = 24 * 60 * 60 * 1000;
            return excelEpoch + numValue * msPerDay;
          }
          if (numValue > 1000000000000) return numValue;
          if (numValue > 1000000000) return numValue * 1000;
        }
        const strValue = String(dateValue);
        const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/);
        if (dmyMatch) {
          const [, day, month, year, time] = dmyMatch;
          const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${time ? 'T' + time : ''}`;
          const parsed2 = new Date(isoStr);
          if (!isNaN(parsed2.getTime())) return parsed2.getTime();
        }
        const parsed = new Date(strValue);
        if (!isNaN(parsed.getTime())) return parsed.getTime();
        return 0;
      };
      
      // Build set of Secondary row indices by analyzing duplicate bookingIds
      const gsSecondaryRowIndices = new Set<number>();
      const gsHoRowsByBookingId = new Map<string, { index: number; row: Record<string, unknown>; date: number }[]>();
      
      originalHoData.forEach((row: Record<string, unknown>, index: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        if (!bookingId) return;
        const dateValue = row["bookingCreationDate"] || row["Booking Creation Date"] || row["BookingCreationDate"] || "";
        const dateNum = gsParseDate(dateValue as string | number);
        if (!gsHoRowsByBookingId.has(bookingId)) gsHoRowsByBookingId.set(bookingId, []);
        gsHoRowsByBookingId.get(bookingId)!.push({ index, row, date: dateNum });
      });
      
      gsHoRowsByBookingId.forEach((rows) => {
        if (rows.length <= 1) return;
        rows.sort((a, b) => b.date - a.date);
        for (let i = 1; i < rows.length; i++) {
          gsSecondaryRowIndices.add(rows[i].index);
        }
      });
      
      // Helper to check if a key is the finalNetPrice column
      const gsIsFinalNetCol = (k: string) => {
        const kLower = k.toLowerCase();
        return kLower === "finalnetprice" || kLower === "final net price" || 
               kLower === "finalnet" || kLower === "final net" || kLower === "final payable";
      };
      
      // Get headers from original data
      const gsOriginalKeys = originalHoData.length > 0 ? Object.keys(originalHoData[0] as Record<string, unknown>) : [];
      
      // Build header row with SP Net, Difference, Difference % inserted before finalNetPrice
      const gsHeaderRow: string[] = [];
      let gsInsertedNewCols = false;
      for (const key of gsOriginalKeys) {
        if (gsIsFinalNetCol(key) && !gsInsertedNewCols) {
          gsHeaderRow.push("SP Net", "Difference", "Difference %");
          gsInsertedNewCols = true;
        }
        gsHeaderRow.push(key);
      }
      if (!gsInsertedNewCols) {
        gsHeaderRow.push("SP Net", "Difference", "Difference %", "finalNetPrice", "errorTeamAttribution", "errorBucket", "comments", "chargedLoss");
      }
      
      const hoReportData: (string | number | null)[][] = [gsHeaderRow];
      
      // Process each row from original HO data
      originalHoData.forEach((row: Record<string, unknown>, rowIndex: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const reconRows = allRowsMap.get(bookingId) || [];
        const reconRow = reconRows[0];
        const isSecondary = gsSecondaryRowIndices.has(rowIndex);
        
        // Calculate values
        const spNet = reconRow?.spNetInHo ?? "";
        const hoNet = reconRow?.hoNet ?? 0;
        const difference = reconRow ? hoNet - reconRow.spNetInHo : "";
        const differencePercent = reconRow && hoNet !== 0 
          ? ((hoNet - reconRow.spNetInHo) / hoNet * 100).toFixed(2) + "%" 
          : "";
        
        // Determine finalNetPrice, errorTeamAttribution, errorBucket, comments, chargedLoss based on reason
        let finalNetPrice: number | string = "";
        let errorTeamAttribution = row["errorTeamAttribution"] || row["Error Team Attribution"] || "";
        let errorBucket = row["errorBucket"] || row["Error Bucket"] || "";
        let comments = row["comments"] || row["Comments"] || "";
        // Get chargedLoss from reconRow (reconciliation result) or from original row
        let chargedLoss = reconRow?.chargedLoss || String(row["chargedLoss"] || row["Charged Loss"] || row["charged_loss"] || "FALSE");
        
        const reason = reconRow?.reason || "Reconciled";
        const fulfillmentMethod = String(reconRow?.fulfillmentMethod || row["fulfillmentMethod"] || row["Fulfillment Method"] || "");
        const priceSync = String(row["priceSync"] || row["Price Sync"] || row["PriceSync"] || "");
        
        // Get the comment from reconciliation (for cancellation scenarios)
        const reconComment = reconRow?.comment || "";
        
        if (isSecondary) {
          finalNetPrice = 0;
          comments = "Duplicate Fulfillment";
        } else if (reason === "Cancelled-SP error") {
          // Cancelled-SP error: finalNetPrice = SP Net, chargedLoss = TRUE
          finalNetPrice = spNet;
          chargedLoss = "TRUE";
          comments = reconComment || "Cancelled-SP error";
          errorBucket = "Cancelled-SP error";
          
          // Same DRI logic as MTB
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          } else if (fulfillmentMethod.toLowerCase().includes("freesale")) {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase().includes("pre") || fulfillmentMethod.toLowerCase().includes("prepurchase")) {
            errorTeamAttribution = "Inventory Ops";
          }
        } else if (reason === "Reconciled") {
          finalNetPrice = spNet;
          // Use cancellation comment if present, otherwise "Reconciled"
          if (reconComment && reconComment.startsWith("Cancelled")) {
            comments = reconComment;
            // Update chargedLoss for cancellation scenarios that require it
            if (reconComment === "Cancelled-Insured Booking" || reconComment === "Cancelled-DSS policy") {
              chargedLoss = "TRUE";
            }
          } else {
            comments = "Reconciled";
          }
        } else if (reason.toLowerCase().includes("multiple") || reason === "MTB") {
          finalNetPrice = spNet;
          errorBucket = "Multiple Tickets Booked";
          comments = "Multiple Tickets Booked";
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else if (reason.toLowerCase().includes("price") || reason === "NPD") {
          finalNetPrice = spNet;
          errorBucket = "Price Mismatch";
          const varianceComment = hoNet < (reconRow?.spNetInHo || 0) ? "Negative Variance" : "Positive Variance";
          comments = varianceComment;
          if ((fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") && 
              priceSync.toLowerCase() === "yes") {
            errorTeamAttribution = "Inventory";
          } else if (fulfillmentMethod.toLowerCase() === "manual" && 
                     (priceSync.toLowerCase() === "no" || priceSync === "")) {
            errorTeamAttribution = "BizOps";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else {
          finalNetPrice = spNet;
        }
        
        // Build data row matching header order
        const dataRow: (string | number | null)[] = [];
        let insertedNewCols = false;
        
        for (const key of gsOriginalKeys) {
          const keyLower = key.toLowerCase();
          
          // Insert SP Net, Difference, Difference % before finalNetPrice
          if (gsIsFinalNetCol(key) && !insertedNewCols) {
            dataRow.push(typeof spNet === "number" ? formatIndianNumber(spNet) : spNet);
            dataRow.push(typeof difference === "number" ? formatIndianNumber(difference) : difference);
            dataRow.push(differencePercent);
            insertedNewCols = true;
          }
          
          // Format value based on column type
          let value: string | number | null = row[key] as string | number | null;
          
          if (gsIsFinalNetCol(key)) {
            value = typeof finalNetPrice === "number" ? formatIndianNumber(finalNetPrice) : finalNetPrice;
          } else if (keyLower === "errorteamattribution" || keyLower === "error team attribution") {
            value = String(errorTeamAttribution);
          } else if (keyLower === "errorbucket" || keyLower === "error bucket") {
            value = String(errorBucket);
          } else if (keyLower === "comments" || keyLower === "comment") {
            value = String(comments);
          } else if (keyLower === "chargedloss" || keyLower === "charged_loss" || keyLower === "charged loss") {
            value = String(chargedLoss);
          } else if (keyLower === "honet" || keyLower === "ho net" || keyLower === "ho_net") {
            value = typeof value === "number" ? formatIndianNumber(value) : value;
          } else if (keyLower.includes("date") && value) {
            value = formatDateValue(value);
          }
          
          dataRow.push(value);
        }
        
        // If finalNetPrice column wasn't in original, append new columns at end
        if (!insertedNewCols) {
          dataRow.push(typeof spNet === "number" ? formatIndianNumber(spNet) : spNet);
          dataRow.push(typeof difference === "number" ? formatIndianNumber(difference) : difference);
          dataRow.push(differencePercent);
          dataRow.push(typeof finalNetPrice === "number" ? formatIndianNumber(finalNetPrice) : finalNetPrice);
          dataRow.push(String(errorTeamAttribution));
          dataRow.push(String(errorBucket));
          dataRow.push(String(comments));
          dataRow.push(String(chargedLoss));
        }
        
        hoReportData.push(dataRow);
      });

      // ===== Sheet 5: Draft Messages (with TID tables matching Excel) =====
      const firstHoRow = originalHoData[0] as Record<string, unknown> | undefined;
      const billingEntityName = firstHoRow 
        ? String(firstHoRow["billingEntityName"] || firstHoRow["beId"] || "[Billing Entity]")
        : "[Billing Entity]";

      const draftMessagesData: (string | number)[][] = [];
      
      // Build enhanced TID summary for draft messages (matching Excel structure)
      type DraftTidSummary = {
        tid: string; discrepancyUsd: number; discrepancyLc: number; currency: string;
        dates: string[]; bidCount: number; bidsInDuration: number; discPctRange: string;
        pattern: string; frequency: string; fulfillmentMethod: string; timesCharged: string;
        hasSoldAtLoss: boolean; lossLcTotal: number;
      };
      
      const driReasonTids = new Map<string, DraftTidSummary[]>();
      for (const [, group] of Array.from(tidGroups.entries())) {
        const key = `${group.driTeam}:${group.reason}`;
        if (!driReasonTids.has(key)) driReasonTids.set(key, []);
        const sortedDates = group.dates.sort();
        const startDate = sortedDates[0] || "";
        const endDate = sortedDates[sortedDates.length - 1] || "";
        const bidCount = group.bookingIds.size;
        
        let bidsInDuration = bidCount;
        if (startDate && endDate) {
          bidsInDuration = allPrimaryRows.filter(r =>
            r.tid === group.tid && r.bookingCreationDate &&
            r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
          ).length;
        }
        
        const timesCharged = group.hoNetTotal !== 0 ? (group.spNetTotal / group.hoNetTotal).toFixed(2) + "x" : "N/A";
        const frequency = bidCount >= 5 ? "Recurring" : "One-Off";
        
        let discPctRange = "";
        let pattern = "";
        if (group.discrepancyPercents.length > 0) {
          const uniquePcts = Array.from(new Set(group.discrepancyPercents.map(p => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePcts.length === 1) {
            discPctRange = minPct.toFixed(2) + "%";
            pattern = "Consistent";
          } else {
            discPctRange = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
            pattern = "Scattered";
          }
        }
        
        driReasonTids.get(key)!.push({
          tid: group.tid,
          discrepancyUsd: group.discrepancyUsd,
          discrepancyLc: group.discrepancyLc,
          currency: group.currency,
          dates: sortedDates,
          bidCount,
          bidsInDuration,
          discPctRange,
          pattern,
          frequency,
          fulfillmentMethod: group.fulfillmentMethod,
          timesCharged,
          hasSoldAtLoss: group.hasSoldAtLoss,
          lossLcTotal: group.lossLcTotal,
        });
      }

      // MTB section
      const mtbKeys = Array.from(driReasonTids.keys()).filter(k => k.endsWith(":Multiple Tickets Booked"));
      if (mtbKeys.length > 0) {
        draftMessagesData.push(["Draft messages - Multiple Tickets Booked"]);
        draftMessagesData.push([]);
        
        for (const key of mtbKeys) {
          const [driTeam] = key.split(":");
          const tids = driReasonTids.get(key) || [];
          if (tids.length === 0) continue;
          
          const allDates = tids.flatMap(t => t.dates).filter(d => d).sort();
          const overallStart = allDates[0] || "";
          const overallEnd = allDates[allDates.length - 1] || "";
          const totalDiscrepancy = tids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
          const totalBidCount = tids.reduce((sum, t) => sum + t.bidCount, 0);
          const totalBidsInDuration = tids.reduce((sum, t) => sum + t.bidsInDuration, 0);
          const coveragePct = totalBidsInDuration > 0 ? ((totalBidCount / totalBidsInDuration) * 100).toFixed(2) + "%" : "N/A";
          const tidList = tids.map(t => t.tid).join(", ");

          let message = "";
          if (driTeam === "Tech" || driTeam === "Tech (BAR)") {
            message = `Hey @bar, we have observed multiple tickets booked for products on API. The TIDs involved here are ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancy.toFixed(2)}. Period - ${overallStart} to ${overallEnd}. Bookings impacted - ${totalBidCount}/${totalBidsInDuration} (${coveragePct}).`;
          } else if (driTeam === "Reservation Ops") {
            message = `Hey Reservation Ops - We have observed multiple tickets booked for TIDs ${tidList}. Discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Period: ${overallStart} to ${overallEnd}. Bookings: ${totalBidCount}/${totalBidsInDuration} (${coveragePct}).`;
          } else {
            message = `Hey ${driTeam} - Multiple tickets booked for TIDs ${tidList}. Discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Period: ${overallStart} to ${overallEnd}. Bookings: ${totalBidCount}/${totalBidsInDuration} (${coveragePct}).`;
          }

          draftMessagesData.push([`Draft messages - ${driTeam} (MTB)`]);
          draftMessagesData.push(["DRI Team", "Slack Draft"]);
          draftMessagesData.push([driTeam, message]);
          
          // Add TID table for MTB (matching Excel structure) with Indian number and date format
          draftMessagesData.push(["TID", "Discrepancy USD", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Times Charged", "Fulfillment"]);
          for (const t of tids.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd)) {
            const startDate = formatDateValue(t.dates[0] || "");
            const endDate = formatDateValue(t.dates[t.dates.length - 1] || "");
            draftMessagesData.push([t.tid, formatIndianNumber(t.discrepancyUsd), startDate, endDate, t.bidCount, t.bidsInDuration, t.timesCharged, t.fulfillmentMethod]);
          }
          draftMessagesData.push([]);
        }
      }

      // NPD section
      const npdKeys = Array.from(driReasonTids.keys()).filter(k => k.endsWith(":Net Price Discrepancy"));
      if (npdKeys.length > 0) {
        draftMessagesData.push(["Draft messages - Net Price Discrepancy"]);
        draftMessagesData.push([]);
        
        for (const key of npdKeys) {
          const [driTeam] = key.split(":");
          const tids = driReasonTids.get(key) || [];
          if (tids.length === 0) continue;
          
          const allDates = tids.flatMap(t => t.dates).filter(d => d).sort();
          const overallStart = allDates[0] || "";
          const overallEnd = allDates[allDates.length - 1] || "";
          const totalDiscrepancy = tids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
          const totalBidCount = tids.reduce((sum, t) => sum + t.bidCount, 0);

          let message = "";
          if (driTeam === "BizOps" || driTeam === "Biz Ops") {
            message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${overallStart} to ${overallEnd}. Total discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Can you please share with RCA what went wrong here?`;
          } else if (driTeam === "Inventory Ops") {
            message = `Please review price discrepancies for ${billingEntityName} during ${overallStart} to ${overallEnd}. Total discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Since these are API products, can you confirm the price-sync status?`;
          } else {
            message = `Please review price discrepancies for ${billingEntityName} during ${overallStart} to ${overallEnd}. Total discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Please investigate and provide RCA.`;
          }

          draftMessagesData.push([`Draft messages - ${driTeam} (NPD)`]);
          draftMessagesData.push(["DRI Team", "Slack Draft"]);
          draftMessagesData.push([driTeam, message]);
          
          // Add TID table for NPD with Indian number and date format
          draftMessagesData.push(["TID", "Discrepancy USD", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Discrepancy %", "Pattern", "Frequency", "Fulfillment"]);
          for (const t of tids.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd)) {
            const startDate = formatDateValue(t.dates[0] || "");
            const endDate = formatDateValue(t.dates[t.dates.length - 1] || "");
            draftMessagesData.push([t.tid, formatIndianNumber(t.discrepancyUsd), startDate, endDate, t.bidCount, t.bidsInDuration, t.discPctRange, t.pattern, t.frequency, t.fulfillmentMethod]);
          }
          draftMessagesData.push([]);
        }
      }

      // ===== DRI Sheets =====
      const hoDataLookup = new Map<string, Record<string, unknown>>();
      for (const hoRow of originalHoData as Record<string, unknown>[]) {
        const bookingId = String(hoRow["bookingId"] || hoRow["Booking ID"] || "");
        if (bookingId) hoDataLookup.set(bookingId, hoRow);
      }

      const getHoValue = (hoRow: Record<string, unknown> | undefined, ...aliases: string[]): unknown => {
        if (!hoRow) return "";
        for (const alias of aliases) {
          if (hoRow[alias] !== undefined && hoRow[alias] !== null) return hoRow[alias];
        }
        return "";
      };

      const driSheetDataList: { sheetName: string; data: (string | number | null)[][] }[] = [];
      let sheetIndex = 0;
      for (const [key, rows] of Array.from(driReasonRowGroups.entries())) {
        const sheetName = driSheetNames[sheetIndex++];
        const [, reason] = key.split("_");
        
        // Determine comments based on reason
        let defaultComment = "";
        if (reason === "Multiple Tickets Booked") defaultComment = "MTB";
        else if (reason === "Net Price Discrepancy") defaultComment = "NPD";
        
        const sheetData: (string | number | null)[][] = [
          ["Booking ID", "Creation Date", "Experience Date", "TGID", "Experience Name", "TID", "VID", "Currency", 
           "Vendor Name", "Billing Entity", "Booking Status", "FF Method", "Payment Method", 
           "HO SP", "HO Net", "HO Take Rate", "SP Net", "Actual Take Rate", 
           "Difference LC", "Difference %", "Difference USD", "Comments"],
        ];
        
        // Sort by Discrepancy USD (negative highest to positive lowest)
        const sortedRows = [...rows].sort((a, b) => a.differenceUsd - b.differenceUsd);
        
        for (const row of sortedRows) {
          const hoRow = hoDataLookup.get(row.bookingId);
          const hoSp = row.headoutSellingPrice || 0;
          const hoTakeRate = hoSp > 0 ? ((hoSp - row.hoNet) / hoSp * 100).toFixed(2) + "%" : "";
          const actualTakeRate = hoSp > 0 ? ((hoSp - row.spNetInHo) / hoSp * 100).toFixed(2) + "%" : "";
          
          // Format dates
          const creationDate = formatDateValue(row.bookingCreationDate || "");
          const experienceDate = formatDateValue(getHoValue(hoRow, "experienceDate", "Experience Date", "experience_date", "tourDate") as string);
          
          sheetData.push([
            row.bookingId,
            creationDate,
            experienceDate,
            getHoValue(hoRow, "tgid", "TGID", "tourGroupId") as string || "",
            row.experienceName || "",
            row.tid || "",
            getHoValue(hoRow, "vid", "VID", "variantId", "Variant ID") as string || "",
            row.hoCurrency,
            row.supplierName || "",
            getHoValue(hoRow, "billingEntityName", "beId", "billing_entity_id") as string || "",
            row.bookingStatus || "",
            row.fulfillmentMethod || "",
            getHoValue(hoRow, "paymentMethod", "Payment Method") as string || "",
            hoSp ? formatIndianNumber(hoSp) : "",
            formatIndianNumber(row.hoNet),
            hoTakeRate,
            formatIndianNumber(row.spNetInHo),
            actualTakeRate,
            formatIndianNumber(row.differenceLc),
            row.differencePct !== null ? `${(row.differencePct * 100).toFixed(2)}%` : "",
            formatIndianNumber(row.differenceUsd),
            defaultComment,
          ]);
        }
        
        driSheetDataList.push({ sheetName, data: sheetData });
      }

      // Write all data to sheets
      const batchData = [
        { range: "Payable Summary!A1", values: payableSummaryData },
        { range: "Discrepancy Analysis!A1", values: discrepancyData },
        { range: "SP Invoice Report!A1", values: spReportData },
        { range: "HO Report Updated!A1", values: hoReportData },
        { range: "Draft Messages!A1", values: draftMessagesData },
      ];

      for (const { sheetName, data } of driSheetDataList) {
        batchData.push({ range: `'${sheetName}'!A1`, values: data });
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: batchData,
        },
      });

      // Get sheet IDs for formatting
      const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetIdMap = new Map<string, number>();
      for (const sheet of spreadsheetInfo.data.sheets || []) {
        const title = sheet.properties?.title;
        const sheetId = sheet.properties?.sheetId;
        if (title && sheetId !== undefined && sheetId !== null) {
          sheetIdMap.set(title, sheetId);
        }
      }

      // Build formatting requests for consistent styling matching Excel
      const formatRequests: any[] = [];
      
      // Header style: bold text only (no background color - matching Excel)
      const headerStyle = {
        textFormat: { bold: true },
        horizontalAlignment: "CENTER",
      };
      // Black borders to match Excel
      const borderStyle = { style: "SOLID", color: { red: 0, green: 0, blue: 0 } };

      // Helper to add standard sheet formatting (single table)
      const addSheetFormatting = (sheetId: number, rowCount: number, colCount: number, headerRowIndices: number[] = [0]) => {
        // Format all identified header rows (bold only, no background)
        for (const rowIdx of headerRowIndices) {
          formatRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: colCount },
              cell: { userEnteredFormat: headerStyle },
              fields: "userEnteredFormat(textFormat,horizontalAlignment)",
            },
          });
        }
        
        // Freeze first header row
        if (headerRowIndices.includes(0)) {
          formatRequests.push({
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          });
        }
        
        // Auto-resize all columns
        formatRequests.push({
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: colCount },
          },
        });
        
        // Borders around all data (black borders)
        formatRequests.push({
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: colCount },
            top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle,
            innerHorizontal: borderStyle, innerVertical: borderStyle,
          },
        });
      };
      
      // Helper to add borders around a specific table range
      const addTableBorders = (sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) => {
        formatRequests.push({
          updateBorders: {
            range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
            top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle,
            innerHorizontal: borderStyle, innerVertical: borderStyle,
          },
        });
      };
      
      // Helper to bold a header row
      const addHeaderFormatting = (sheetId: number, rowIdx: number, colCount: number) => {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: { userEnteredFormat: headerStyle },
            fields: "userEnteredFormat(textFormat,horizontalAlignment)",
          },
        });
      };

      // Payable Summary (simple table with header at row 0)
      const payableSheetId = sheetIdMap.get("Payable Summary");
      if (payableSheetId !== undefined) {
        addSheetFormatting(payableSheetId, payableSummaryData.length, 4, [0]);
      }

      // Discrepancy Analysis - identify each table separately and apply individual borders
      // Data structure: Section Header -> (optional spacer) -> Table Header -> Data rows -> Empty row (separator)
      const discSheetId = sheetIdMap.get("Discrepancy Analysis");
      if (discSheetId !== undefined) {
        type TableInfo = { sectionHeaderRow: number; tableHeaderRow: number; lastDataRow: number; colCount: number; };
        const tables: TableInfo[] = [];
        
        // Scan through data to find tables
        for (let idx = 0; idx < discrepancyData.length; idx++) {
          const row = discrepancyData[idx];
          const firstCell = String(row[0] || "");
          
          // Look for section headers (single cell with SUMMARY or ANALYSIS)
          const isSectionHeader = row.length === 1 && (firstCell.includes("SUMMARY") || firstCell.includes("ANALYSIS"));
          
          if (isSectionHeader) {
            // Scan forward to find the table header row (may have spacer rows)
            let tableHeaderRow = -1;
            let scanLimit = Math.min(idx + 5, discrepancyData.length); // Look up to 5 rows ahead
            
            for (let k = idx + 1; k < scanLimit; k++) {
              const candidateRow = discrepancyData[k];
              const candidateFirstCell = String(candidateRow[0] || "");
              
              // Table header starts with "Reason" or "TID" and has multiple columns
              if (candidateRow.length > 1 && (candidateFirstCell === "Reason" || candidateFirstCell === "TID")) {
                tableHeaderRow = k;
                break;
              }
              
              // Stop if we hit another section or empty row that's not immediately after
              const isAnotherSection = candidateRow.length === 1 && (candidateFirstCell.includes("SUMMARY") || candidateFirstCell.includes("ANALYSIS"));
              if (isAnotherSection) break;
            }
            
            if (tableHeaderRow >= 0) {
              const headerRow = discrepancyData[tableHeaderRow];
              let lastDataRow = tableHeaderRow;
              let colCount = headerRow.length;
              
              // Find the end of this table (look for empty row or next section)
              for (let j = tableHeaderRow + 1; j < discrepancyData.length; j++) {
                const dataRow = discrepancyData[j];
                const dataFirstCell = String(dataRow[0] || "");
                const isEmptyRow = dataRow.length === 0 || (dataRow.length === 1 && !dataFirstCell);
                const isNextSection = dataRow.length === 1 && (dataFirstCell.includes("SUMMARY") || dataFirstCell.includes("ANALYSIS"));
                
                if (isEmptyRow || isNextSection) {
                  break;
                }
                lastDataRow = j;
                colCount = Math.max(colCount, dataRow.length);
              }
              
              tables.push({
                sectionHeaderRow: idx,
                tableHeaderRow: tableHeaderRow,
                lastDataRow: lastDataRow,
                colCount: colCount,
              });
            }
          }
        }
        
        // Auto-resize all columns
        let maxCols = 1;
        discrepancyData.forEach(row => { maxCols = Math.max(maxCols, row.length); });
        formatRequests.push({
          autoResizeDimensions: {
            dimensions: { sheetId: discSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: maxCols },
          },
        });
        
        // Apply formatting to each table separately
        for (const table of tables) {
          // Bold the section header row
          addHeaderFormatting(discSheetId, table.sectionHeaderRow, table.colCount);
          
          // Bold the table header row (Reason/TID row)
          addHeaderFormatting(discSheetId, table.tableHeaderRow, table.colCount);
          
          // Add borders around the table data (from table header to last data row)
          // endRowIndex is exclusive, so we add 1 to lastDataRow
          addTableBorders(discSheetId, table.tableHeaderRow, table.lastDataRow + 1, 0, table.colCount);
        }
      }

      // SP Invoice Report - use header row (first row) length
      const spSheetId = sheetIdMap.get("SP Invoice Report");
      if (spSheetId !== undefined) {
        // spReportData is 2D array with header at row 0
        const spCols = spReportData.length > 0 && Array.isArray(spReportData[0]) ? spReportData[0].length : 5;
        addSheetFormatting(spSheetId, spReportData.length, spCols, [0]);
      }

      // HO Report Updated - use header row (first row) length
      const hoSheetId = sheetIdMap.get("HO Report Updated");
      if (hoSheetId !== undefined) {
        // hoReportData is 2D array with header at row 0
        const hoCols = hoReportData.length > 0 && Array.isArray(hoReportData[0]) ? hoReportData[0].length : 11;
        addSheetFormatting(hoSheetId, hoReportData.length, hoCols, [0]);
      }

      // Draft Messages - identify each table separately and apply individual borders
      // Structure: Main section header -> empty -> DRI header -> DRI table (2 rows) -> TID table -> empty
      const draftSheetId = sheetIdMap.get("Draft Messages");
      if (draftSheetId !== undefined) {
        type DraftTableInfo = { headerRow: number; lastDataRow: number; colCount: number; };
        const draftTables: DraftTableInfo[] = [];
        const sectionHeaders: number[] = []; // For main section headers like "Draft messages - MTB"
        
        // Find all table headers (DRI Team or TID)
        for (let idx = 0; idx < draftMessagesData.length; idx++) {
          const row = draftMessagesData[idx];
          const firstCell = String(row[0] || "");
          
          // Track main section headers for bold formatting
          if (firstCell.startsWith("Draft messages")) {
            sectionHeaders.push(idx);
            continue;
          }
          
          // Look for table headers
          const isTableHeader = row.length > 1 && (firstCell === "DRI Team" || firstCell === "TID");
          
          if (isTableHeader) {
            const tableHeaderRow = idx;
            let lastDataRow = tableHeaderRow;
            let colCount = row.length;
            
            // Find the end of this table (look for empty row, next table header, or section header)
            for (let j = tableHeaderRow + 1; j < draftMessagesData.length; j++) {
              const dataRow = draftMessagesData[j];
              const dataFirstCell = String(dataRow[0] || "");
              const isEmptyRow = dataRow.length === 0 || (dataRow.length === 1 && !dataFirstCell);
              const isNextHeader = dataRow.length > 1 && (dataFirstCell === "DRI Team" || dataFirstCell === "TID");
              const isNextSection = dataFirstCell.startsWith("Draft messages");
              
              if (isEmptyRow || isNextHeader || isNextSection) {
                break;
              }
              lastDataRow = j;
              colCount = Math.max(colCount, dataRow.length);
            }
            
            draftTables.push({
              headerRow: tableHeaderRow,
              lastDataRow: lastDataRow,
              colCount: colCount,
            });
          }
        }
        
        // Auto-resize all columns
        let maxCols = 1;
        draftMessagesData.forEach(row => { maxCols = Math.max(maxCols, row.length); });
        formatRequests.push({
          autoResizeDimensions: {
            dimensions: { sheetId: draftSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: maxCols },
          },
        });
        
        // Bold section headers
        for (const sectionRow of sectionHeaders) {
          addHeaderFormatting(draftSheetId, sectionRow, maxCols);
        }
        
        // Apply formatting to each table separately
        for (const table of draftTables) {
          // Bold the table header row
          addHeaderFormatting(draftSheetId, table.headerRow, table.colCount);
          
          // Add borders around the table (from header to last data row)
          addTableBorders(draftSheetId, table.headerRow, table.lastDataRow + 1, 0, table.colCount);
        }
      }

      // DRI Views - simple tables with header at row 0
      for (let i = 0; i < driSheetNames.length; i++) {
        const sheetName = driSheetNames[i];
        const sheetId = sheetIdMap.get(sheetName);
        if (sheetId === undefined) continue;
        
        const driData = driSheetDataList[i]?.data || [];
        const rowCount = driData.length;
        const colCount = driData.length > 0 ? driData[0].length : 22;
        addSheetFormatting(sheetId, rowCount, colCount, [0]);
      }
      
      // Apply all formatting in one batch
      if (formatRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: formatRequests },
        });
      }

      res.json({
        success: true,
        spreadsheetId,
        spreadsheetUrl,
        message: `Exported to Google Sheets: ${spreadsheetTitle}`,
      });
    } catch (error) {
      console.error("Google Sheets export error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to export to Google Sheets";
      res.status(500).json({ error: errorMessage });
    }
  });

  /**
   * GET /api/runs/:runId/discrepancy-analysis/:reason?
   * Get discrepancy analysis grouped by TID for all reasons except "Reconciled"
   * Reason can be passed as path param or query param
   */
  app.get("/api/runs/:runId/discrepancy-analysis/:reason?", async (req, res) => {
    try {
      const { runId, reason: pathReason } = req.params;
      const { reason: queryReason } = req.query;
      const reason = pathReason || queryReason; // Support both path and query param
      
      const run = await storage.getRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "done") {
        return res.status(400).json({ error: "Run not complete" });
      }

      const result = await storage.getRunResult(runId);
      if (!result) {
        return res.status(404).json({ error: "Results not found" });
      }

      // Filter to discrepancy rows (exclude "Reconciled") and optionally by reason
      // Include both primary and secondary vendor rows
      let discrepancyRows = [...result.primaryRows, ...result.secondaryVendorRows].filter(r => r.reason !== "Reconciled");
      if (reason && typeof reason === "string") {
        discrepancyRows = discrepancyRows.filter(r => r.reason === reason);
      }

      // Get all primary rows for counting total BIDs per TID
      const allPrimaryRows = result.primaryRows;

      // Group by TID
      const tidGroups = new Map<string, {
        tid: string;
        currency: string;
        discrepancyLc: number;
        discrepancyUsd: number;
        fulfillmentMethod: string;
        spNetTotal: number;
        hoNetTotal: number;
        dates: string[];
        bookingIds: Set<string>;
        driTeam: string;
        reason: string;
        // NPD-specific tracking
        hoTakeRates: number[];
        actualTakeRates: number[];
        discrepancyPercents: number[];
        headoutSellingPriceTotal: number;
        lossLcTotal: number;
        hasSoldAtLoss: boolean;
      }>();

      for (const row of discrepancyRows) {
        const tid = row.tid || "Unknown";
        
        if (!tidGroups.has(tid)) {
          tidGroups.set(tid, {
            tid,
            currency: row.hoCurrency,
            discrepancyLc: 0,
            discrepancyUsd: 0,
            fulfillmentMethod: row.fulfillmentMethod || "Unknown",
            spNetTotal: 0,
            hoNetTotal: 0,
            dates: [],
            bookingIds: new Set(),
            driTeam: row.driTeam || "Unknown",
            reason: row.reason,
            hoTakeRates: [],
            actualTakeRates: [],
            discrepancyPercents: [],
            headoutSellingPriceTotal: 0,
            lossLcTotal: 0,
            hasSoldAtLoss: false,
          });
        }

        const group = tidGroups.get(tid)!;
        group.discrepancyLc += row.differenceLc;
        group.discrepancyUsd += row.differenceUsd;
        group.spNetTotal += row.spNetInHo;
        group.hoNetTotal += row.hoNet;
        if (row.bookingCreationDate) {
          group.dates.push(row.bookingCreationDate);
        }
        group.bookingIds.add(row.bookingId);

        // NPD-specific calculations
        const hsp = row.headoutSellingPrice;
        if (hsp && hsp > 0) {
          group.headoutSellingPriceTotal += hsp;
          // HO take rate: (hsp - hoNet) / hsp
          const hoTakeRate = (hsp - row.hoNet) / hsp * 100;
          group.hoTakeRates.push(hoTakeRate);
          // Actual take rate: (hsp - spNet) / hsp
          const actualTakeRate = (hsp - row.spNetInHo) / hsp * 100;
          group.actualTakeRates.push(actualTakeRate);
          // Check if sold at loss
          if (hsp < row.spNetInHo) {
            group.hasSoldAtLoss = true;
            group.lossLcTotal += hsp - row.spNetInHo;
          }
        }
        // Discrepancy %: (hoNet - spNet) / hoNet
        if (row.hoNet !== 0) {
          const discPct = ((row.hoNet - row.spNetInHo) / row.hoNet) * 100;
          group.discrepancyPercents.push(discPct);
        }
      }

      // Build analysis rows
      const analysisRows = Array.from(tidGroups.values()).map(group => {
        // Sort dates to find start and end
        const sortedDates = group.dates.sort();
        const startDate = sortedDates.length > 0 ? sortedDates[0] : null;
        const endDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null;

        // Calculate times charged
        const timesCharged = group.hoNetTotal !== 0
          ? Math.round((group.spNetTotal / group.hoNetTotal) * 100) / 100 + "x"
          : "N/A";

        // Count of BIDs with this discrepancy
        const countBidWithDiscrepancy = group.bookingIds.size;

        // Count BIDs in duration (all primary rows for this TID between start and end date)
        let countBidsInDuration = 0;
        if (startDate && endDate) {
          countBidsInDuration = allPrimaryRows.filter(r => {
            if (r.tid !== group.tid) return false;
            if (!r.bookingCreationDate) return false;
            return r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate;
          }).length;
        } else {
          countBidsInDuration = countBidWithDiscrepancy;
        }

        // Total BIDs in report for this TID
        const totalBidsInReport = allPrimaryRows.filter(r => r.tid === group.tid).length;

        // Discrepancy coverage
        const discrepancyCoveragePercent = countBidsInDuration > 0
          ? Math.round((countBidWithDiscrepancy / countBidsInDuration) * 10000) / 100
          : 0;

        // Frequency classification
        const frequency = countBidWithDiscrepancy >= 5 ? "Recurring" : "One-Off";

        // NPD-specific metrics
        const hoTakeRatePercent = group.hoTakeRates.length > 0
          ? Math.round(group.hoTakeRates.reduce((a, b) => a + b, 0) / group.hoTakeRates.length * 100) / 100
          : undefined;
        
        const actualTakeRatePercent = group.actualTakeRates.length > 0
          ? Math.round(group.actualTakeRates.reduce((a, b) => a + b, 0) / group.actualTakeRates.length * 100) / 100
          : undefined;

        // Discrepancy % range
        let discrepancyPercentRange: string | undefined;
        let pattern: "Consistent" | "Scattered" | undefined;
        if (group.discrepancyPercents.length > 0) {
          const uniquePercents = Array.from(new Set(group.discrepancyPercents.map(p => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePercents.length === 1) {
            discrepancyPercentRange = `${minPct.toFixed(2)}%`;
            pattern = "Consistent";
          } else {
            discrepancyPercentRange = `${minPct.toFixed(2)}% to ${maxPct.toFixed(2)}%`;
            pattern = "Scattered";
          }
        }

        // Loss calculations (only if sold at loss)
        const soldAtLoss = group.hasSoldAtLoss ? "Yes" as const : "No" as const;
        const lossLc = group.hasSoldAtLoss ? group.lossLcTotal : undefined;
        // Convert loss to USD using the same FX logic
        const lossUsd = lossLc !== undefined && result.fx?.usdToCcy?.[group.currency]
          ? lossLc / result.fx.usdToCcy[group.currency]
          : undefined;

        return {
          tid: group.tid,
          currency: group.currency,
          discrepancyLc: group.discrepancyLc,
          discrepancyUsd: group.discrepancyUsd,
          fulfillmentMethod: group.fulfillmentMethod,
          timesCharged,
          startDate,
          endDate,
          countBidWithDiscrepancy,
          countBidsInDuration,
          totalBidsInReport,
          discrepancyCoveragePercent,
          frequency,
          driTeam: group.driTeam,
          reason: group.reason,
          // NPD-specific fields
          hoTakeRatePercent,
          actualTakeRatePercent,
          discrepancyPercentRange,
          pattern,
          soldAtLoss,
          lossLc,
          lossUsd,
        };
      });

      // Get unique reasons for filtering (from both primary and secondary vendor rows)
      const allRows = [...result.primaryRows, ...result.secondaryVendorRows];
      const reasonsSet = new Set(allRows.filter(r => r.reason !== "Reconciled").map(r => r.reason));
      const reasons = Array.from(reasonsSet);

      res.json({
        analysisRows,
        reasons,
      });
    } catch (error) {
      console.error("Discrepancy analysis error:", error);
      res.status(500).json({ error: "Failed to compute discrepancy analysis" });
    }
  });

  // Dispute Tracker endpoints
  app.get("/api/disputes/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const disputes = await storage.getDisputes(runId);
      res.json({ disputes });
    } catch (error) {
      console.error("Get disputes error:", error);
      res.status(500).json({ error: "Failed to fetch disputes" });
    }
  });

  app.post("/api/disputes", async (req, res) => {
    try {
      const { runId, bookingId, billingEntityId, billingEntityName, ticketId, tid, currency, disputeAmount, maxDisputeAmount, reconciledNet } = req.body;
      
      // Check if dispute already exists for this booking
      const existing = await storage.getDisputeByBooking(runId, bookingId);
      if (existing) {
        // Update existing dispute
        const updated = await storage.updateDispute(existing.disputeId, {
          disputeAmount,
          billingEntityId,
          billingEntityName,
          ticketId,
          tid,
          reconciledNet,
        });
        return res.json({ dispute: updated });
      }
      
      const dispute = await storage.createDispute({
        runId,
        bookingId,
        billingEntityId: billingEntityId || "",
        billingEntityName: billingEntityName || "",
        ticketId: ticketId || "",
        tid: tid || "",
        currency: currency || "USD",
        disputeAmount: disputeAmount || 0,
        maxDisputeAmount: maxDisputeAmount || 0,
        reconciledNet: reconciledNet || 0,
        status: "pending",
        closureStatus: "open",
      });
      res.json({ dispute });
    } catch (error) {
      console.error("Create dispute error:", error);
      res.status(500).json({ error: "Failed to create dispute" });
    }
  });

  // Get dispute details for multiple dispute IDs
  // NOTE: This route MUST come before /api/disputes/:runId to avoid being matched as a runId
  app.post("/api/disputes/details", async (req, res) => {
    try {
      const { disputeIds, runId } = req.body;
      
      if (!disputeIds || !Array.isArray(disputeIds) || disputeIds.length === 0) {
        return res.status(400).json({ error: "disputeIds array is required" });
      }
      
      const disputes = await Promise.all(
        disputeIds.map(async (id: string) => {
          return await storage.getDisputeById(id);
        })
      );
      
      // Filter to valid disputes that are open and optionally match runId
      const validDisputes = disputes.filter(d => {
        if (!d) return false;
        if (d.closureStatus !== "open") return false;
        if (runId && d.runId !== runId) return false;
        return true;
      });
      
      res.json({ disputes: validDisputes });
    } catch (error) {
      console.error("Get dispute details error:", error);
      res.status(500).json({ error: "Failed to fetch dispute details" });
    }
  });

  // Close bookings with individual amounts and closure types
  // NOTE: This route MUST come before /api/disputes/:runId to avoid being matched as a runId
  app.post("/api/disputes/close-bookings", async (req, res) => {
    try {
      const { closures, runId } = req.body;
      
      if (!runId) {
        return res.status(400).json({ error: "runId is required" });
      }
      
      if (!closures || !Array.isArray(closures) || closures.length === 0) {
        return res.status(400).json({ error: "closures array is required" });
      }
      
      const closedDisputes = [];
      const hoErrorDisputeIds: string[] = [];
      const errors: Array<{ disputeId: string; error: string }> = [];
      
      for (const closure of closures) {
        const { disputeId, adjustmentAmount, closureType } = closure;
        
        // Validate required fields
        if (!disputeId) {
          errors.push({ disputeId: "unknown", error: "Missing disputeId" });
          continue;
        }
        
        if (adjustmentAmount === undefined || typeof adjustmentAmount !== "number") {
          errors.push({ disputeId, error: "Invalid or missing adjustmentAmount" });
          continue;
        }
        
        if (adjustmentAmount < 0) {
          errors.push({ disputeId, error: "Adjustment amount cannot be negative" });
          continue;
        }
        
        if (!closureType || !["sp_error", "ho_error"].includes(closureType)) {
          errors.push({ disputeId, error: "Invalid closureType (must be sp_error or ho_error)" });
          continue;
        }
        
        const dispute = await storage.getDisputeById(disputeId);
        
        if (!dispute) {
          errors.push({ disputeId, error: "Dispute not found" });
          continue;
        }
        
        if (dispute.closureStatus !== "open") {
          errors.push({ disputeId, error: "Dispute is already closed" });
          continue;
        }
        
        // Verify runId matches
        if (dispute.runId !== runId) {
          errors.push({ disputeId, error: "Dispute does not belong to this run" });
          continue;
        }
        
        // Validate adjustment amount doesn't exceed original dispute amount
        if (adjustmentAmount > dispute.disputeAmount) {
          errors.push({ disputeId, error: `Adjustment amount (${adjustmentAmount}) exceeds dispute amount (${dispute.disputeAmount})` });
          continue;
        }
        
        const updated = await storage.updateDispute(disputeId, {
          closureStatus: "closed",
          closureType: closureType === "ho_error" ? "accept_ho_error" : "sp_error",
          closedByAdjustmentAmount: adjustmentAmount,
          closedAt: new Date().toISOString(),
        });
        
        if (updated) {
          closedDisputes.push(updated);
          if (closureType === "ho_error") {
            hoErrorDisputeIds.push(disputeId);
          }
        }
      }
      
      res.json({ 
        success: closedDisputes.length > 0, 
        closedDisputes,
        hoErrorDisputeIds,
        errors: errors.length > 0 ? errors : undefined,
        message: `${closedDisputes.length} booking(s) closed successfully${errors.length > 0 ? `, ${errors.length} failed` : ""}`
      });
    } catch (error) {
      console.error("Close bookings error:", error);
      res.status(500).json({ error: "Failed to close bookings" });
    }
  });

  // Accept HO Error - close disputes and mark as HO error
  // NOTE: This route MUST come before /api/disputes/:runId to avoid being matched as a runId
  app.post("/api/disputes/accept-ho-error", async (req, res) => {
    try {
      const { disputeIds, customAmount } = req.body;
      
      if (!disputeIds || !Array.isArray(disputeIds) || disputeIds.length === 0) {
        return res.status(400).json({ error: "disputeIds array is required" });
      }
      
      // customAmount only applies to single-dispute closures
      const useCustomAmount = customAmount !== undefined && disputeIds.length === 1;
      
      // Close each dispute with accept_ho_error type
      const closedDisputes = [];
      for (const disputeId of disputeIds) {
        const dispute = await storage.getDisputeById(disputeId);
        if (dispute && dispute.closureStatus === "open") {
          const updated = await storage.updateDispute(disputeId, {
            closureStatus: "closed",
            closureType: "accept_ho_error",
            closedAt: new Date().toISOString(),
            closedByAdjustmentAmount: useCustomAmount ? customAmount : dispute.disputeAmount,
          });
          if (updated) closedDisputes.push(updated);
        }
      }
      
      res.json({ 
        success: true, 
        closedDisputes,
        message: `${closedDisputes.length} dispute(s) closed as HO Error`
      });
    } catch (error) {
      console.error("Accept HO error:", error);
      res.status(500).json({ error: "Failed to close disputes" });
    }
  });

  // Generate Excel report for Accept HO Error closure
  // NOTE: This route MUST come before /api/disputes/:runId to avoid being matched as a runId
  app.post("/api/disputes/accept-ho-error/download", async (req, res) => {
    try {
      const { disputeIds, customAmount } = req.body;
      
      if (!disputeIds || !Array.isArray(disputeIds) || disputeIds.length === 0) {
        return res.status(400).json({ error: "disputeIds array is required" });
      }
      
      // Get dispute details
      const disputes = await Promise.all(
        disputeIds.map(async (id: string) => {
          return await storage.getDisputeById(id);
        })
      );
      
      const validDisputes = disputes.filter(d => d !== undefined);
      
      // Build Excel data with Booking ID and Final Reconciled Net Price
      // Apply Indian number formatting to the final reconciled net price
      // Use customAmount only for single-dispute downloads
      const useCustomAmount = customAmount !== undefined && validDisputes.length === 1;
      const reportData = validDisputes.map(d => {
        const disputeAmount = useCustomAmount ? customAmount : (d!.closedByAdjustmentAmount ?? d!.disputeAmount ?? 0);
        return {
          "Booking ID": d!.bookingId,
          "Final Reconciled Net Price": formatIndianNumber(disputeAmount + (d!.reconciledNet || 0)),
        };
      });
      
      // Create Excel workbook
      const xlsx = await import("xlsx");
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(reportData);
      
      // Apply column widths for better readability
      const colWidths = [{ wch: 25 }, { wch: 30 }];
      ws["!cols"] = colWidths;
      
      xlsx.utils.book_append_sheet(wb, ws, "HO Error Closure");
      
      const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=HO_Error_Closure.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Download HO error report:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Close disputes as SP Error (Supplier Error - no Excel download needed)
  // NOTE: This route MUST come before /api/disputes/:runId to avoid being matched as a runId
  app.post("/api/disputes/close-sp-error", async (req, res) => {
    try {
      const { disputeIds, customAmount } = req.body;
      
      if (!disputeIds || !Array.isArray(disputeIds) || disputeIds.length === 0) {
        return res.status(400).json({ error: "disputeIds array is required" });
      }
      
      // customAmount only applies to single-dispute closures
      const useCustomAmount = customAmount !== undefined && disputeIds.length === 1;
      
      // Close each dispute with sp_error type
      const closedDisputes = [];
      for (const disputeId of disputeIds) {
        const dispute = await storage.getDisputeById(disputeId);
        if (dispute && dispute.closureStatus === "open") {
          const updated = await storage.updateDispute(disputeId, {
            closureStatus: "closed",
            closureType: "sp_error",
            closedAt: new Date().toISOString(),
            closedByAdjustmentAmount: useCustomAmount ? customAmount : dispute.disputeAmount,
          });
          if (updated) closedDisputes.push(updated);
        }
      }
      
      res.json({ 
        success: true, 
        closedDisputes,
        message: `${closedDisputes.length} dispute(s) closed as SP Error`
      });
    } catch (error) {
      console.error("Close SP error:", error);
      res.status(500).json({ error: "Failed to close disputes" });
    }
  });

  // Reopen a closed dispute
  // NOTE: This route MUST come before /api/disputes/:runId to avoid being matched as a runId
  app.post("/api/disputes/reopen", async (req, res) => {
    try {
      const { disputeId } = req.body;
      
      if (!disputeId) {
        return res.status(400).json({ error: "disputeId is required" });
      }
      
      const dispute = await storage.getDisputeById(disputeId);
      if (!dispute) {
        return res.status(404).json({ error: "Dispute not found" });
      }
      
      if (dispute.closureStatus === "open") {
        return res.status(400).json({ error: "Dispute is already open" });
      }
      
      // Reopen the dispute by clearing closure fields
      const updated = await storage.updateDispute(disputeId, {
        closureStatus: "open",
        closureType: undefined,
        closedAt: undefined,
        closedByAdjustmentAmount: undefined,
      });
      
      if (updated) {
        res.json({ 
          success: true, 
          dispute: updated,
          message: "Dispute reopened successfully"
        });
      } else {
        res.status(500).json({ error: "Failed to reopen dispute" });
      }
    } catch (error) {
      console.error("Reopen dispute error:", error);
      res.status(500).json({ error: "Failed to reopen dispute" });
    }
  });

  // NOTE: These routes MUST come before /api/disputes/:runId to avoid being matched as a runId
  // Close disputes when used in post-recon adjustments (SP Error - auto-close)
  app.post("/api/disputes/close", async (req, res) => {
    try {
      const { disputeIds, adjustmentAmount } = req.body;
      
      if (!disputeIds || !Array.isArray(disputeIds) || disputeIds.length === 0) {
        return res.status(400).json({ error: "disputeIds array is required" });
      }
      
      if (typeof adjustmentAmount !== "number" || adjustmentAmount <= 0) {
        return res.status(400).json({ error: "Valid adjustmentAmount is required" });
      }
      
      // Get all disputes to validate amounts match
      const allDisputes = await Promise.all(
        disputeIds.map(async (id: string) => {
          const dispute = await storage.getDisputeById(id);
          return dispute;
        })
      );
      
      // Calculate total dispute amount from selected DIDs
      const validDisputes = allDisputes.filter(d => d !== undefined);
      const totalDisputeAmount = validDisputes.reduce((sum, d) => sum + (d?.disputeAmount || 0), 0);
      
      // Round for comparison (avoid floating point issues)
      const roundedAdjustment = Math.round(adjustmentAmount * 100) / 100;
      const roundedTotal = Math.round(totalDisputeAmount * 100) / 100;
      
      // Check if amounts match (required for closure)
      if (roundedAdjustment !== roundedTotal) {
        return res.status(400).json({ 
          error: "Adjustment amount must match total dispute amount for closure",
          adjustmentAmount: roundedAdjustment,
          totalDisputeAmount: roundedTotal
        });
      }
      
      // Close the disputes as SP Error
      const closedDisputes = await storage.closeDisputes(disputeIds, adjustmentAmount);
      res.json({ 
        success: true, 
        closedDisputes,
        message: `${closedDisputes.length} dispute(s) closed successfully`
      });
    } catch (error) {
      console.error("Close disputes error:", error);
      res.status(500).json({ error: "Failed to close disputes" });
    }
  });

  // Manual close (write off) disputes
  app.post("/api/disputes/manual-close", async (req, res) => {
    try {
      const { disputeIds, note } = req.body;
      
      if (!disputeIds || !Array.isArray(disputeIds) || disputeIds.length === 0) {
        return res.status(400).json({ error: "disputeIds array is required" });
      }
      
      // Validate all disputes exist and are open
      const existingDisputes = await Promise.all(
        disputeIds.map(async (id: string) => {
          const dispute = await storage.getDisputeById(id);
          return dispute;
        })
      );
      
      const validDisputes = existingDisputes.filter(d => d !== undefined && d.closureStatus === "open");
      
      if (validDisputes.length === 0) {
        return res.status(400).json({ error: "No valid open disputes found" });
      }
      
      // Close the disputes with manual write-off type
      const closedDisputes = await storage.manualCloseDisputes(disputeIds, note);
      res.json({ 
        success: true, 
        closedDisputes,
        message: `${closedDisputes.length} dispute(s) written off successfully`
      });
    } catch (error) {
      console.error("Manual close disputes error:", error);
      res.status(500).json({ error: "Failed to write off disputes" });
    }
  });

  // Batch create/update disputes for a run
  app.post("/api/disputes/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const { disputes } = req.body;
      
      if (!Array.isArray(disputes)) {
        return res.status(400).json({ error: "disputes must be an array" });
      }
      
      const results = [];
      for (const d of disputes) {
        const { bookingId, disputeAmount, currency, billingEntityId, billingEntityName, ticketId, tid, reconciledNet } = d;
        
        // Check if dispute already exists for this booking
        const existing = await storage.getDisputeByBooking(runId, bookingId);
        if (existing) {
          // Update existing dispute
          const updated = await storage.updateDispute(existing.disputeId, {
            disputeAmount,
            billingEntityId,
            billingEntityName,
            ticketId,
            tid,
            reconciledNet,
          });
          if (updated) results.push(updated);
        } else {
          // Create new dispute
          const dispute = await storage.createDispute({
            runId,
            bookingId,
            billingEntityId: billingEntityId || "",
            billingEntityName: billingEntityName || "",
            ticketId: ticketId || "",
            tid: tid || "",
            currency: currency || "USD",
            disputeAmount: disputeAmount || 0,
            maxDisputeAmount: disputeAmount || 0,
            reconciledNet: reconciledNet || 0,
            status: "pending",
            closureStatus: "open",
          });
          results.push(dispute);
        }
      }
      
      res.json({ disputes: results });
    } catch (error) {
      console.error("Batch create disputes error:", error);
      res.status(500).json({ error: "Failed to create disputes" });
    }
  });

  // Update closure amount for a closed dispute
  // NOTE: This specific route must come before the generic :disputeId route
  app.patch("/api/disputes/:disputeId/update-closure", async (req, res) => {
    try {
      const { disputeId } = req.params;
      const { closedByAdjustmentAmount } = req.body;
      
      if (closedByAdjustmentAmount === undefined) {
        return res.status(400).json({ error: "closedByAdjustmentAmount is required" });
      }
      
      const existing = await storage.getDisputeById(disputeId);
      if (!existing) {
        return res.status(404).json({ error: "Dispute not found" });
      }
      
      if (existing.closureStatus !== "closed") {
        return res.status(400).json({ error: "Can only update closure amount for closed disputes" });
      }
      
      // Validate amount doesn't exceed original dispute amount
      if (closedByAdjustmentAmount > existing.disputeAmount) {
        return res.status(400).json({ error: "Amount cannot exceed original dispute amount" });
      }
      
      const updated = await storage.updateDispute(disputeId, {
        closedByAdjustmentAmount,
      });
      
      if (!updated) {
        return res.status(500).json({ error: "Failed to update dispute" });
      }
      
      res.json({ dispute: updated });
    } catch (error) {
      console.error("Update closure amount error:", error);
      res.status(500).json({ error: "Failed to update closure amount" });
    }
  });

  app.patch("/api/disputes/:disputeId", async (req, res) => {
    try {
      const { disputeId } = req.params;
      const updates = req.body;
      const dispute = await storage.updateDispute(disputeId, updates);
      if (!dispute) {
        return res.status(404).json({ error: "Dispute not found" });
      }
      res.json({ dispute });
    } catch (error) {
      console.error("Update dispute error:", error);
      res.status(500).json({ error: "Failed to update dispute" });
    }
  });

  app.delete("/api/disputes/:disputeId", async (req, res) => {
    try {
      const { disputeId } = req.params;
      const deleted = await storage.deleteDispute(disputeId);
      if (!deleted) {
        return res.status(404).json({ error: "Dispute not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete dispute error:", error);
      res.status(500).json({ error: "Failed to delete dispute" });
    }
  });

  // Delete dispute by runId and bookingId
  app.delete("/api/disputes/:runId/:bookingId", async (req, res) => {
    try {
      const { runId, bookingId } = req.params;
      const existing = await storage.getDisputeByBooking(runId, bookingId);
      if (!existing) {
        return res.json({ success: true }); // Already deleted or never existed
      }
      await storage.deleteDispute(existing.disputeId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete dispute by booking error:", error);
      res.status(500).json({ error: "Failed to delete dispute" });
    }
  });

  // Get only open disputes for a run (for Amount Payable Calculator dropdown)
  app.get("/api/disputes/:runId/open", async (req, res) => {
    try {
      const { runId } = req.params;
      const disputes = await storage.getOpenDisputes(runId);
      res.json({ disputes });
    } catch (error) {
      console.error("Get open disputes error:", error);
      res.status(500).json({ error: "Failed to fetch open disputes" });
    }
  });

  // ========== Issue Tracker Endpoints ==========

  // Get all issues for a run
  app.get("/api/issues/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const issues = await storage.getIssues(runId);
      res.json({ issues });
    } catch (error) {
      console.error("Get issues error:", error);
      res.status(500).json({ error: "Failed to fetch issues" });
    }
  });

  // Create a new issue
  app.post("/api/issues", async (req, res) => {
    try {
      const { runId, billingEntityId, billingEntityName, currency, discrepancyLocal, discrepancyUsd, reason, driTeam, bookingIds } = req.body;
      
      if (!runId || !billingEntityId || !reason || !driTeam) {
        res.status(400).json({ error: "Missing required fields: runId, billingEntityId, reason, driTeam" });
        return;
      }

      const issue = await storage.createIssue({
        runId,
        billingEntityId,
        billingEntityName: billingEntityName || billingEntityId,
        currency: currency || "USD",
        discrepancyLocal: discrepancyLocal || 0,
        discrepancyUsd: discrepancyUsd || 0,
        reason,
        driTeam,
        bookingIds: bookingIds || [],
      });

      res.json({ issue });
    } catch (error) {
      console.error("Create issue error:", error);
      res.status(500).json({ error: "Failed to create issue" });
    }
  });

  // Delete an issue
  app.delete("/api/issues/:issueId", async (req, res) => {
    try {
      const { issueId } = req.params;
      const deleted = await storage.deleteIssue(issueId);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Issue not found" });
      }
    } catch (error) {
      console.error("Delete issue error:", error);
      res.status(500).json({ error: "Failed to delete issue" });
    }
  });

  // ========== Vendor Correction Endpoints ==========

  // Get all vendor corrections for a run
  app.get("/api/vendor-corrections/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const corrections = await storage.getVendorCorrections(runId);
      res.json({ corrections });
    } catch (error) {
      console.error("Get vendor corrections error:", error);
      res.status(500).json({ error: "Failed to fetch vendor corrections" });
    }
  });

  // Set a single vendor correction
  app.post("/api/vendor-corrections/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const { bookingId, finalVendorId } = req.body;
      
      if (!bookingId || !finalVendorId) {
        return res.status(400).json({ error: "Missing required fields: bookingId, finalVendorId" });
      }

      const correction = await storage.setVendorCorrection(runId, bookingId, finalVendorId);
      res.json({ correction });
    } catch (error) {
      console.error("Set vendor correction error:", error);
      res.status(500).json({ error: "Failed to set vendor correction" });
    }
  });

  // Bulk set vendor corrections
  app.post("/api/vendor-corrections/:runId/bulk", async (req, res) => {
    try {
      const { runId } = req.params;
      const { corrections } = req.body;
      
      if (!Array.isArray(corrections)) {
        return res.status(400).json({ error: "corrections must be an array" });
      }

      const results = await storage.bulkSetVendorCorrections(runId, corrections);
      res.json({ corrections: results });
    } catch (error) {
      console.error("Bulk set vendor corrections error:", error);
      res.status(500).json({ error: "Failed to set vendor corrections" });
    }
  });

  // Delete a vendor correction
  app.delete("/api/vendor-corrections/:runId/:bookingId", async (req, res) => {
    try {
      const { runId, bookingId } = req.params;
      const deleted = await storage.deleteVendorCorrection(runId, bookingId);
      res.json({ success: deleted });
    } catch (error) {
      console.error("Delete vendor correction error:", error);
      res.status(500).json({ error: "Failed to delete vendor correction" });
    }
  });

  // ========== Vendor Balances Endpoints (Purchase Reconciliation) ==========

  // Get all vendor balances
  app.get("/api/vendor-balances", async (req, res) => {
    try {
      const balances = await storage.getVendorBalances();
      res.json({ balances });
    } catch (error) {
      console.error("Get vendor balances error:", error);
      res.status(500).json({ error: "Failed to fetch vendor balances" });
    }
  });

  // Get vendor balance by BE ID
  app.get("/api/vendor-balances/:beId", async (req, res) => {
    try {
      const { beId } = req.params;
      const balance = await storage.getVendorBalance(beId);
      if (!balance) {
        return res.json({ balance: null });
      }
      res.json({ balance });
    } catch (error) {
      console.error("Get vendor balance error:", error);
      res.status(500).json({ error: "Failed to fetch vendor balance" });
    }
  });

  // Create or update vendor balance
  app.post("/api/vendor-balances", async (req, res) => {
    try {
      const { beId, openingBalance, reloads, closingBalance, currency } = req.body;
      
      if (!beId || openingBalance === undefined || reloads === undefined || closingBalance === undefined || !currency) {
        return res.status(400).json({ error: "Missing required fields: beId, openingBalance, reloads, closingBalance, currency" });
      }

      const balance = await storage.upsertVendorBalance({
        beId,
        openingBalance: Number(openingBalance),
        reloads: Number(reloads),
        closingBalance: Number(closingBalance),
        currency,
      });
      
      res.json({ balance });
    } catch (error) {
      console.error("Upsert vendor balance error:", error);
      res.status(500).json({ error: "Failed to save vendor balance" });
    }
  });

  // Delete vendor balance
  app.delete("/api/vendor-balances/:beId", async (req, res) => {
    try {
      const { beId } = req.params;
      const deleted = await storage.deleteVendorBalance(beId);
      res.json({ success: deleted });
    } catch (error) {
      console.error("Delete vendor balance error:", error);
      res.status(500).json({ error: "Failed to delete vendor balance" });
    }
  });

  // ========== Session Management Endpoints ==========

  // Get all sessions
  app.get("/api/sessions", async (req, res) => {
    try {
      const sessions = await sessionStorage.getSessions();
      res.json({ sessions });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  // Get a specific session
  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const session = await sessionStorage.getSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ session });
    } catch (error) {
      console.error("Get session error:", error);
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  // Create a new session
  app.post("/api/sessions", async (req, res) => {
    try {
      const { name } = req.body;
      const session = await sessionStorage.createSession(name || "New Session");
      res.json({ session });
    } catch (error) {
      console.error("Create session error:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  // Update session data (files, results)
  app.put("/api/sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const data = req.body;
      const session = await sessionStorage.saveSessionData(id, data);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ session });
    } catch (error) {
      console.error("Update session error:", error);
      res.status(500).json({ error: "Failed to update session" });
    }
  });

  // Delete a session
  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await sessionStorage.deleteSession(id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Session not found" });
      }
    } catch (error) {
      console.error("Delete session error:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // Rename a session
  app.patch("/api/sessions/:id/rename", async (req, res) => {
    try {
      const { id } = req.params;
      const { name } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }
      
      const session = await sessionStorage.updateSession(id, { name });
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ session });
    } catch (error) {
      console.error("Rename session error:", error);
      res.status(500).json({ error: "Failed to rename session" });
    }
  });

  return httpServer;
}

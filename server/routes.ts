import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, sessionStorage } from "./storage";
import { randomUUID } from "crypto";
import multer from "multer";
import XLSX from "xlsx-js-style";
import path from "path";
import fs from "fs";
import type { UploadedFile, SheetData, FxRate } from "@shared/schema";
import { errorBucketRcaMapping, errorBucketOptions } from "@shared/schema";
import { runReconciliation } from "./reconciliation";
import { registerExportRoutes, generateIssueWorkingsSheet } from "./export-routes";
import { formatIndianNumber } from "./export-utils";

// Temporary download route for documentation (no auth required)
function registerDownloadRoute(app: Express) {
  app.get("/download/reconciliation-doc", (_req: Request, res: Response) => {
    const filePath = path.resolve("Reconciliation_Logic_Documentation.docx");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", "attachment; filename=Reconciliation_Logic_Documentation.docx");
      res.sendFile(filePath);
    } else {
      res.status(404).send("File not found");
    }
  });
}

// Auth middleware — protects all /api/* routes except /api/auth/*
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/auth/")) return next();
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Unauthorized" });
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
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
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
  // Register download route (before auth middleware)
  registerDownloadRoute(app);

  // Initialize FX rates
  await storage.setFxRates(defaultFxRates);

  // ==========================================
  // AUTH ENDPOINTS (no auth required)
  // ==========================================

  app.get("/api/auth/status", (req, res) => {
    res.set("Cache-Control", "no-store").json({ authenticated: !!req.session?.authenticated });
  });

  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body;
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) {
      return res.status(500).json({ error: "APP_PASSWORD is not configured" });
    }
    if (password === appPassword) {
      req.session.authenticated = true;
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session error" });
        res.json({ success: true });
      });
    } else {
      res.status(401).json({ error: "Incorrect password" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // Apply auth middleware to all subsequent /api/* routes
  app.use("/api", requireAuth);

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

      // Find RECONCILIATION_REPORT and SP_INVOICE_REPORT tabs (with backward compat for old names)
      let hoData: SheetData | null = null;
      let spData: SheetData | null = null;

      Array.from(sheets.entries()).forEach(([name, data]) => {
        const normalizedName = name.toLowerCase().trim();
        if (normalizedName === "reconciliation_report" || normalizedName.includes("ho data") || normalizedName === "ho data") {
          hoData = data;
        } else if (
          normalizedName === "sp_invoice_report" ||
          normalizedName.includes("sp invoice") ||
          normalizedName === "sp invoice report"
        ) {
          spData = data;
        }
      });

      if (!hoData) {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          error: 'Missing required sheet "RECONCILIATION_REPORT". Please check your file.',
        });
      }

      if (!spData) {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          error: 'Missing required sheet "SP_INVOICE_REPORT". Please check your file.',
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

      // Validate: no booking ID should appear more than once in the SP Invoice Report
      const spBookingIdCounts = new Map<string, number>();
      for (const row of upload.spData.rows) {
        const bid = String(
          row["bookingId"] ?? row["Booking ID"] ?? row["booking_id"] ?? ""
        ).trim();
        if (bid) {
          spBookingIdCounts.set(bid, (spBookingIdCounts.get(bid) ?? 0) + 1);
        }
      }
      const duplicateSpBids = [...spBookingIdCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([bid]) => bid);
      if (duplicateSpBids.length > 0) {
        return res.status(400).json({
          error: "Multiple Booking ids found in the report, Please reupload",
          duplicateBookingIds: duplicateSpBids,
        });
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

        // Return the runId, FX data, and full results after reconciliation is complete
        res.json({ 
          runId, 
          fx: result.fx,
          overallSummary: result.overallSummary,
          secondaryVendorSummary: result.secondaryVendorSummary,
          primaryRows: result.primaryRows,
          secondaryVendorRows: result.secondaryVendorRows,
          unmappedRows: result.unmappedRows
        });
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
        name: "RECONCILIATION_REPORT",
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
        name: "SP_INVOICE_REPORT",
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
        sheetNames: ["RECONCILIATION_REPORT", "SP_INVOICE_REPORT"],
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


  // Register split export endpoints (analysis + financial for both Excel and GSheets)
  registerExportRoutes(app);


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

  app.post("/api/dispute-overrides", async (req, res) => {
    try {
      const { runId, overrides } = req.body;
      if (!runId || !overrides || typeof overrides !== "object") {
        return res.status(400).json({ error: "runId and overrides required" });
      }
      await storage.setDisputeOverrides(runId, overrides);
      res.json({ success: true });
    } catch (error) {
      console.error("Set dispute overrides error:", error);
      res.status(500).json({ error: "Failed to save dispute overrides" });
    }
  });

  app.post("/api/price-overrides", async (req, res) => {
    try {
      const { runId, overrides } = req.body;
      if (!runId || !overrides || typeof overrides !== "object") {
        return res.status(400).json({ error: "runId and overrides required" });
      }
      await storage.setPriceOverrides(runId, overrides);
      res.json({ success: true });
    } catch (error) {
      console.error("Set price overrides error:", error);
      res.status(500).json({ error: "Failed to save price overrides" });
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

  // Bulk delete disputes by runId and bookingIds
  app.delete("/api/disputes/:runId/bulk", async (req, res) => {
    try {
      const { runId } = req.params;
      const { bookingIds } = req.body;
      
      if (!Array.isArray(bookingIds)) {
        return res.status(400).json({ error: "bookingIds must be an array" });
      }
      
      for (const bookingId of bookingIds) {
        const existing = await storage.getDisputeByBooking(runId, bookingId);
        if (existing) {
          await storage.deleteDispute(existing.disputeId);
        }
      }
      
      res.json({ success: true, deletedCount: bookingIds.length });
    } catch (error) {
      console.error("Bulk delete disputes error:", error);
      res.status(500).json({ error: "Failed to bulk delete disputes" });
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
      const { runId, billingEntityId, billingEntityName, currency, discrepancyLocal, discrepancyUsd, reason, driTeam, bookingIds,
        paymentMethod, period, assignee, errorBucket, rca, slackLink, workingsLink, issueStatus } = req.body;
      
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
        paymentMethod,
        period,
        assignee,
        errorBucket,
        rca,
        slackLink,
        workingsLink,
        issueStatus,
      });

      if (!workingsLink && issue.issueId) {
        generateIssueWorkingsSheet({
          issueId: issue.issueId,
          runId,
          reason,
          driTeam,
          bookingIds: bookingIds || [],
          billingEntityName: billingEntityName || billingEntityId,
          currency: currency || "USD",
          discrepancyLocal: discrepancyLocal || 0,
          discrepancyUsd: discrepancyUsd || 0,
        }).then(async (sheetUrl) => {
          if (sheetUrl) {
            await storage.updateIssue(issue.issueId, { workingsLink: sheetUrl });
          }
        }).catch((err) => {
          console.error("Background workings sheet generation failed:", err);
        });
      }

      res.json({ issue });
    } catch (error) {
      console.error("Create issue error:", error);
      res.status(500).json({ error: "Failed to create issue" });
    }
  });

  app.post("/api/issues/:issueId/generate-workings", async (req, res) => {
    try {
      const { issueId } = req.params;
      const issue = await storage.getIssueById(issueId);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }

      const bookingIds = (issue.bookingIds as string[]) || [];
      if (bookingIds.length === 0) {
        res.status(400).json({ error: "No booking IDs associated with this issue. Cannot generate workings sheet." });
        return;
      }

      const sheetUrl = await generateIssueWorkingsSheet({
        issueId: issue.issueId,
        runId: issue.runId,
        reason: issue.reason,
        driTeam: issue.driTeam,
        bookingIds,
        billingEntityName: issue.billingEntityName,
        currency: issue.currency,
        discrepancyLocal: issue.discrepancyLocal,
        discrepancyUsd: issue.discrepancyUsd,
      });

      if (sheetUrl) {
        await storage.updateIssue(issue.issueId, { workingsLink: sheetUrl });
        res.json({ success: true, workingsLink: sheetUrl });
      } else {
        res.status(500).json({ error: "Failed to generate workings sheet. Ensure the reconciliation run is complete and bookings exist." });
      }
    } catch (error) {
      console.error("Generate workings error:", error);
      res.status(500).json({ error: "Failed to generate workings sheet" });
    }
  });

  // Update an issue (inline editing)
  app.patch("/api/issues/:issueId", async (req, res) => {
    try {
      const { issueId } = req.params;
      const updates = req.body;

      if (updates.errorBucket !== undefined) {
        const validBuckets = [...errorBucketOptions] as string[];
        if (updates.errorBucket && !validBuckets.includes(updates.errorBucket)) {
          res.status(400).json({ error: `Invalid Error Bucket: ${updates.errorBucket}` });
          return;
        }
        if (!updates.rca) {
          updates.rca = null;
        }
      }

      if (updates.rca !== undefined && updates.rca !== null) {
        const existing = await storage.getIssueById(issueId);
        const bucket = updates.errorBucket || existing?.errorBucket;
        if (bucket) {
          const allowed = errorBucketRcaMapping[bucket] || [];
          if (!allowed.includes(updates.rca)) {
            res.status(400).json({ error: `Invalid RCA '${updates.rca}' for Error Bucket '${bucket}'` });
            return;
          }
        }
      }

      const updated = await storage.updateIssue(issueId, updates);
      if (updated) {
        res.json({ issue: updated });
      } else {
        res.status(404).json({ error: "Issue not found" });
      }
    } catch (error) {
      console.error("Update issue error:", error);
      res.status(500).json({ error: "Failed to update issue" });
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
      const { beId, openingBalance, closingBalance, currency } = req.body;
      
      if (!beId || openingBalance === undefined || closingBalance === undefined || !currency) {
        return res.status(400).json({ error: "Missing required fields: beId, openingBalance, closingBalance, currency" });
      }

      const balance = await storage.upsertVendorBalance({
        beId,
        openingBalance: Number(openingBalance),
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

  // ========== Pax Types Endpoints ==========

  app.get("/api/pax-types", async (req, res) => {
    try {
      const paxTypes = await storage.getPaxTypes();
      res.json({ paxTypes });
    } catch (error) {
      console.error("Get pax types error:", error);
      res.status(500).json({ error: "Failed to fetch pax types" });
    }
  });

  app.post("/api/pax-types", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      const paxType = await storage.createPaxType({ name: name.trim().toLowerCase() });
      res.json({ paxType });
    } catch (error) {
      console.error("Create pax type error:", error);
      res.status(500).json({ error: "Failed to create pax type" });
    }
  });

  app.post("/api/pax-types/bulk", async (req, res) => {
    try {
      const { names } = req.body;
      if (!Array.isArray(names) || names.length === 0) {
        return res.status(400).json({ error: "Missing required field: names (array of strings)" });
      }
      const cleanedNames = names
        .map((n: unknown) => (typeof n === "string" ? n.trim().toLowerCase() : ""))
        .filter((n: string) => n.length > 0);
      if (cleanedNames.length === 0) {
        return res.status(400).json({ error: "No valid pax type names provided" });
      }
      const paxTypes = await storage.bulkCreatePaxTypes(cleanedNames);
      res.json({ paxTypes, count: paxTypes.length });
    } catch (error) {
      console.error("Bulk create pax types error:", error);
      res.status(500).json({ error: "Failed to bulk create pax types" });
    }
  });

  app.delete("/api/pax-types/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid pax type ID" });
      }
      const deleted = await storage.deletePaxType(id);
      res.json({ success: deleted });
    } catch (error) {
      console.error("Delete pax type error:", error);
      res.status(500).json({ error: "Failed to delete pax type" });
    }
  });

  app.delete("/api/pax-types", async (req, res) => {
    try {
      const deleted = await storage.deleteAllPaxTypes();
      res.json({ success: deleted });
    } catch (error) {
      console.error("Delete all pax types error:", error);
      res.status(500).json({ error: "Failed to delete all pax types" });
    }
  });

  // ========== Portal Reloads Endpoints ==========

  app.get("/api/portal-reloads", async (req, res) => {
    try {
      const reloads = await storage.getPortalReloads();
      res.json({ reloads });
    } catch (error) {
      console.error("Get portal reloads error:", error);
      res.status(500).json({ error: "Failed to fetch portal reloads" });
    }
  });

  app.get("/api/portal-reloads/:beId", async (req, res) => {
    try {
      const { beId } = req.params;
      const total = await storage.getPortalReloadTotal(beId);
      const reloads = await storage.getPortalReloadsByBeId(beId);
      const adjustments = await storage.getReloadAdjustmentsByBeId(beId);
      const adjustmentTotal = adjustments.reduce((sum, a) => {
        return sum + (a.adjustmentType === "add" ? a.paidAmount : -a.paidAmount);
      }, 0);
      const adjustedTotal = total + adjustmentTotal;
      res.json({ total, reloads, adjustments, adjustedTotal });
    } catch (error) {
      console.error("Get portal reloads by beId error:", error);
      res.status(500).json({ error: "Failed to fetch portal reloads" });
    }
  });

  app.post("/api/portal-reloads/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = fs.readFileSync(req.file.path);
      const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

      if (rawRows.length === 0) {
        return res.status(400).json({ error: "File is empty" });
      }

      const headers = Object.keys(rawRows[0]);

      const partnerIdCol = headers.find(h =>
        h.toLowerCase().includes("portal partner id") ||
        h.toLowerCase().includes("partner id")
      );
      const paidAmountCol = headers.find(h =>
        h.toLowerCase().includes("paid amount") ||
        h.toLowerCase().includes("tickets paid amount")
      );

      if (!partnerIdCol || !paidAmountCol) {
        return res.status(400).json({
          error: `Required columns not found. Looking for "Finance Zendesk Tickets Portal Partner ID" and "Finance Zendesk Tickets Paid Amount". Found columns: ${headers.join(", ")}`,
        });
      }

      const remainingHeaders = headers.filter(h => h !== partnerIdCol && h !== paidAmountCol);
      const zendeskIdCol = remainingHeaders.find(h => {
        const lc = h.toLowerCase();
        return (lc.includes("zendesk") && lc.includes("id") && !lc.includes("partner")) ||
          lc.includes("ticket id") ||
          lc.includes("ticket number");
      });
      const dateCol = remainingHeaders.find(h => {
        const lc = h.toLowerCase();
        return (lc.includes("date") && (lc.includes("payment") || lc.includes("paid") || lc.includes("created"))) ||
          lc === "date" || lc === "date of payment";
      });
      const amountLoadedCol = remainingHeaders.find(h => {
        const lc = h.toLowerCase();
        return lc.includes("amount loaded") || lc.includes("loaded at date") || lc.includes("reload amount");
      });
      console.log("Portal reloads column detection:", { partnerIdCol, paidAmountCol, zendeskIdCol: zendeskIdCol || "(not found)", dateCol: dateCol || "(not found)", amountLoadedCol: amountLoadedCol || "(not found)", allHeaders: headers });

      const parsed: { beId: string; paidAmount: number; zendeskId?: string; dateOfPayment?: string; amountLoadedAtDate?: string; rawRow: Record<string, unknown> }[] = [];
      for (const row of rawRows) {
        const beId = String(row[partnerIdCol] || "").trim();
        const rawAmount = row[paidAmountCol];
        const paidAmount = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount).replace(/,/g, "")) || 0;

        if (beId && paidAmount !== 0) {
          const zendeskId = zendeskIdCol ? String(row[zendeskIdCol] || "").trim() || undefined : undefined;
          let dateOfPayment: string | undefined;
          if (dateCol) {
            const rawDate = row[dateCol];
            if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
              const dd = String(rawDate.getDate()).padStart(2, "0");
              const mm = String(rawDate.getMonth() + 1).padStart(2, "0");
              const yyyy = rawDate.getFullYear();
              dateOfPayment = `${dd}/${mm}/${yyyy}`;
            } else if (typeof rawDate === "number") {
              const excelEpoch = new Date(1899, 11, 30);
              const parsed = new Date(excelEpoch.getTime() + rawDate * 86400000);
              if (!isNaN(parsed.getTime())) {
                const dd = String(parsed.getDate()).padStart(2, "0");
                const mm = String(parsed.getMonth() + 1).padStart(2, "0");
                const yyyy = parsed.getFullYear();
                dateOfPayment = `${dd}/${mm}/${yyyy}`;
              }
            } else {
              dateOfPayment = String(rawDate || "").trim() || undefined;
            }
          }
          let amountLoadedAtDate: string | undefined;
          if (amountLoadedCol) {
            const rawLoaded = row[amountLoadedCol];
            if (rawLoaded instanceof Date && !isNaN(rawLoaded.getTime())) {
              const dd = String(rawLoaded.getDate()).padStart(2, "0");
              const mm = String(rawLoaded.getMonth() + 1).padStart(2, "0");
              const yyyy = rawLoaded.getFullYear();
              amountLoadedAtDate = `${dd}/${mm}/${yyyy}`;
            } else if (typeof rawLoaded === "number") {
              const excelEpoch = new Date(1899, 11, 30);
              const parsed = new Date(excelEpoch.getTime() + rawLoaded * 86400000);
              if (!isNaN(parsed.getTime())) {
                const dd = String(parsed.getDate()).padStart(2, "0");
                const mm = String(parsed.getMonth() + 1).padStart(2, "0");
                const yyyy = parsed.getFullYear();
                amountLoadedAtDate = `${dd}/${mm}/${yyyy}`;
              }
            } else {
              amountLoadedAtDate = String(rawLoaded || "").trim() || undefined;
            }
          }
          parsed.push({ beId, paidAmount, zendeskId, dateOfPayment, amountLoadedAtDate, rawRow: row as Record<string, unknown> });
        }
      }

      if (parsed.length === 0) {
        return res.status(400).json({ error: "No valid reload entries found in the file" });
      }

      res.json({
        parsed,
        count: parsed.length,
        headers,
        columns: { partnerIdCol, paidAmountCol },
      });
    } catch (error) {
      console.error("Parse portal reloads file error:", error);
      res.status(500).json({ error: "Failed to parse reloads file" });
    }
  });

  app.post("/api/portal-reloads/save", async (req, res) => {
    try {
      const { reloads } = req.body;
      if (!Array.isArray(reloads) || reloads.length === 0) {
        return res.status(400).json({ error: "Missing required field: reloads (array)" });
      }

      const validReloads = reloads
        .filter((r: any) => r.beId && typeof r.paidAmount === "number")
        .map((r: any) => ({
          beId: String(r.beId).trim(),
          paidAmount: r.paidAmount,
          zendeskId: r.zendeskId || null,
          dateOfPayment: r.dateOfPayment || null,
          amountLoadedAtDate: r.amountLoadedAtDate || null,
        }));

      if (validReloads.length === 0) {
        return res.status(400).json({ error: "No valid reload entries" });
      }

      const saved = await storage.bulkCreatePortalReloads(validReloads);
      res.json({ reloads: saved, count: saved.length });
    } catch (error) {
      console.error("Save portal reloads error:", error);
      res.status(500).json({ error: "Failed to save portal reloads" });
    }
  });

  app.delete("/api/portal-reloads", async (req, res) => {
    try {
      const deleted = await storage.deleteAllPortalReloads();
      res.json({ success: deleted });
    } catch (error) {
      console.error("Delete portal reloads error:", error);
      res.status(500).json({ error: "Failed to delete portal reloads" });
    }
  });

  // ========== Reload Adjustments ==========

  app.get("/api/reload-adjustments/:beId", async (req, res) => {
    try {
      const { beId } = req.params;
      const adjustments = await storage.getReloadAdjustmentsByBeId(beId);
      res.json({ adjustments });
    } catch (error) {
      console.error("Get reload adjustments error:", error);
      res.status(500).json({ error: "Failed to fetch reload adjustments" });
    }
  });

  app.post("/api/reload-adjustments", async (req, res) => {
    try {
      const { beId, zendeskId, dateOfPayment, amountLoadedAtDate, paidAmount, adjustmentType } = req.body;
      if (!beId || typeof paidAmount !== "number" || !["add", "less"].includes(adjustmentType)) {
        return res.status(400).json({ error: "Missing required fields: beId, paidAmount, adjustmentType (add/less)" });
      }
      const adjustment = await storage.createReloadAdjustment({
        beId: String(beId).trim(),
        zendeskId: zendeskId || null,
        dateOfPayment: dateOfPayment || null,
        amountLoadedAtDate: amountLoadedAtDate || null,
        paidAmount,
        adjustmentType,
      });
      res.json({ adjustment });
    } catch (error) {
      console.error("Create reload adjustment error:", error);
      res.status(500).json({ error: "Failed to create reload adjustment" });
    }
  });

  app.delete("/api/reload-adjustments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const deleted = await storage.deleteReloadAdjustment(id);
      res.json({ success: deleted });
    } catch (error) {
      console.error("Delete reload adjustment error:", error);
      res.status(500).json({ error: "Failed to delete reload adjustment" });
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

  // =====================================================================
  // FINANCIAL EXPORT VALIDATION
  // GET /api/runs/:runId/validate-financial
  // Runs all data integrity checks before allowing financial export
  // =====================================================================
  app.get("/api/runs/:runId/validate-financial", async (req, res) => {
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
      
      const allDisputes = await storage.getDisputes(runId);
      const priceOverrides = await storage.getPriceOverrides(runId);
      const vendorCorrections = await storage.getVendorCorrections(runId);
      
      const allRows = [...result.primaryRows, ...result.secondaryVendorRows];
      const discrepancyRows = allRows.filter((r: any) => r.reason !== "Reconciled");
      const reconciledRows = allRows.filter((r: any) => r.reason === "Reconciled");
      const cancellationRows = allRows.filter((r: any) => 
        r.reason?.toLowerCase().includes("cancell") || 
        r.reason === "Cancelled-Refund OK"
      );
      
      interface ValidationCheck {
        id: string;
        name: string;
        category: string;
        severity: "critical" | "warning";
        status: "pass" | "fail" | "warning";
        message: string;
        details?: any;
      }
      
      const checks: ValidationCheck[] = [];
      
      // CHECK 1: Booking count integrity
      // Count primary rows only for category breakdown (secondary vendor counted separately)
      const primaryOnly = result.primaryRows;
      const totalBookings = allRows.length;
      const secondaryVendorCount = result.secondaryVendorRows.length;
      const primaryReconciledCount = primaryOnly.filter((r: any) => r.reason === "Reconciled").length;
      const primaryCancellationCount = primaryOnly.filter((r: any) => 
        r.reason?.toLowerCase().includes("cancell") || r.reason === "Cancelled-Refund OK"
      ).length;
      const primaryAlreadyReconciledCount = primaryOnly.filter((r: any) => r.reason === "Already Reconciled").length;
      const primaryDiscrepancyCount = primaryOnly.filter((r: any) => 
        r.reason !== "Reconciled" &&
        !(r.reason?.toLowerCase().includes("cancell") || r.reason === "Cancelled-Refund OK") &&
        r.reason !== "Already Reconciled"
      ).length;
      const categorizedTotal = primaryReconciledCount + primaryDiscrepancyCount + primaryCancellationCount + primaryAlreadyReconciledCount + secondaryVendorCount;
      
      checks.push({
        id: "booking_count",
        name: "Booking count integrity",
        category: "Data Integrity",
        severity: "critical",
        status: totalBookings === categorizedTotal ? "pass" : "fail",
        message: totalBookings === categorizedTotal 
          ? `All ${totalBookings} bookings accounted for across categories`
          : `Mismatch: ${totalBookings} total bookings but ${categorizedTotal} categorized (Reconciled: ${primaryReconciledCount}, Discrepancy: ${primaryDiscrepancyCount}, Cancellation: ${primaryCancellationCount}, Already Reconciled: ${primaryAlreadyReconciledCount}, Secondary Vendor: ${secondaryVendorCount})`,
        details: { totalBookings, primaryReconciledCount, primaryDiscrepancyCount, primaryCancellationCount, primaryAlreadyReconciledCount, secondaryVendorCount },
      });
      
      // CHECK 2: All bookings have prices
      const missingPriceBookings = allRows.filter((r: any) => 
        r.spNetInHo === null || r.spNetInHo === undefined
      );
      checks.push({
        id: "all_prices_set",
        name: "All bookings have SP Net price",
        category: "Data Completeness",
        severity: "critical",
        status: missingPriceBookings.length === 0 ? "pass" : "fail",
        message: missingPriceBookings.length === 0 
          ? "All bookings have SP Net prices set"
          : `${missingPriceBookings.length} booking(s) missing SP Net price`,
        details: { missingCount: missingPriceBookings.length, bookingIds: missingPriceBookings.slice(0, 5).map((r: any) => r.bookingId) },
      });
      
      // CHECK 3: No zero Final Net Price on non-cancelled active bookings
      const zeroActiveBookings = allRows.filter((r: any) => {
        const isCancelled = r.reason?.toLowerCase().includes("cancell") || r.reason === "Cancelled-Refund OK";
        const isNegativeSp = r.reason === "Negative SP - Partial Refund";
        return !isCancelled && !isNegativeSp && r.reason !== "Reconciled" && 
               (r.spNetInHo === 0 || r.hoNet === 0) && r.spNetInHo !== null && r.hoNet !== null;
      });
      checks.push({
        id: "no_zero_active",
        name: "No zero prices on active bookings",
        category: "Data Integrity",
        severity: "warning",
        status: zeroActiveBookings.length === 0 ? "pass" : "warning",
        message: zeroActiveBookings.length === 0 
          ? "No active bookings have zero prices"
          : `${zeroActiveBookings.length} active booking(s) have zero HO or SP Net price`,
        details: { count: zeroActiveBookings.length, bookingIds: zeroActiveBookings.slice(0, 5).map((r: any) => r.bookingId) },
      });
      
      // CHECK 4: No unexpected negative prices
      const unexpectedNegatives = allRows.filter((r: any) => {
        const isCancelled = r.reason?.toLowerCase().includes("cancell") || r.reason === "Cancelled-Refund OK";
        const isNegativeSp = r.reason === "Negative SP - Partial Refund";
        return !isCancelled && !isNegativeSp && (r.spNetInHo < 0 || (r.hoNet < 0 && r.hoNet !== 0));
      });
      checks.push({
        id: "no_unexpected_negatives",
        name: "No unexpected negative prices",
        category: "Data Integrity",
        severity: "warning",
        status: unexpectedNegatives.length === 0 ? "pass" : "warning",
        message: unexpectedNegatives.length === 0 
          ? "No unexpected negative prices found"
          : `${unexpectedNegatives.length} booking(s) have unexpected negative prices`,
        details: { count: unexpectedNegatives.length, bookingIds: unexpectedNegatives.slice(0, 5).map((r: any) => r.bookingId) },
      });
      
      // CHECK 5: Payment method mismatches resolved (vendor corrections exist)
      const paymentMismatchRows = allRows.filter((r: any) => r.reason === "Payment Method Mismatch");
      const vendorCorrectionMap = new Map<string, string>();
      for (const vc of vendorCorrections) {
        vendorCorrectionMap.set(vc.bookingId, vc.finalVendorId);
      }
      const unresolvedMismatches = paymentMismatchRows.filter((r: any) => !vendorCorrectionMap.has(r.bookingId));
      checks.push({
        id: "payment_mismatches_resolved",
        name: "Payment method mismatches resolved",
        category: "Data Completeness",
        severity: paymentMismatchRows.length > 0 ? "warning" : "critical",
        status: unresolvedMismatches.length === 0 ? "pass" : (paymentMismatchRows.length > 0 ? "warning" : "pass"),
        message: paymentMismatchRows.length === 0 
          ? "No payment method mismatches found"
          : unresolvedMismatches.length === 0 
            ? `All ${paymentMismatchRows.length} mismatches have Final Vendor ID assigned`
            : `${unresolvedMismatches.length} of ${paymentMismatchRows.length} mismatches missing Final Vendor ID`,
        details: { total: paymentMismatchRows.length, unresolved: unresolvedMismatches.length },
      });
      
      // CHECK 6: FX rate validation
      const fx = result.fx;
      const currencies = new Set(allRows.map((r: any) => r.hoCurrency).filter(Boolean));
      const missingFxCurrencies: string[] = [];
      const suspiciousFxRates: { currency: string; rate: number }[] = [];
      if (fx?.usdToCcy) {
        for (const ccy of currencies) {
          if (ccy === "USD") continue;
          const rate = fx.usdToCcy[ccy];
          if (!rate) {
            missingFxCurrencies.push(ccy);
          } else if (rate < 0.001 || rate > 100000) {
            suspiciousFxRates.push({ currency: ccy, rate });
          }
        }
      }
      const fxOk = missingFxCurrencies.length === 0 && suspiciousFxRates.length === 0;
      checks.push({
        id: "fx_rate_validation",
        name: "FX rate validation",
        category: "Data Integrity",
        severity: missingFxCurrencies.length > 0 ? "critical" : "warning",
        status: fxOk ? "pass" : (missingFxCurrencies.length > 0 ? "fail" : "warning"),
        message: fxOk 
          ? `FX rates valid for ${currencies.size} currencies`
          : missingFxCurrencies.length > 0 
            ? `Missing FX rates for: ${missingFxCurrencies.join(", ")}`
            : `Suspicious FX rates detected for: ${suspiciousFxRates.map(r => `${r.currency}=${r.rate}`).join(", ")}`,
        details: { currencies: Array.from(currencies), missingFxCurrencies, suspiciousFxRates },
      });
      
      // CHECK 7: Price overrides summary (manual edits)
      const overrideEntries = priceOverrides ? Object.entries(priceOverrides) : [];
      const manualEditCount = overrideEntries.length;
      let totalValueImpact = 0;
      for (const [bookingId, override] of overrideEntries) {
        const originalRow = allRows.find((r: any) => r.bookingId === bookingId);
        if (originalRow) {
          const originalPrice = originalRow.spNetInHo || 0;
          const overridePrice = typeof override === "number" ? override : (override as any)?.finalPrice || 0;
          totalValueImpact += Math.abs(overridePrice - originalPrice);
        }
      }
      checks.push({
        id: "manual_edits_summary",
        name: "Manual edits summary",
        category: "Review Completeness",
        severity: "warning",
        status: manualEditCount === 0 ? "pass" : "warning",
        message: manualEditCount === 0 
          ? "No manual price overrides applied"
          : `${manualEditCount} booking(s) have manual price overrides (total value impact: ${formatIndianNumber(totalValueImpact)})`,
        details: { manualEditCount, totalValueImpact, bookingIds: overrideEntries.slice(0, 5).map(([id]) => id) },
      });
      
      // CHECK 8: Open disputes check
      const openDisputes = allDisputes.filter((d: any) => d.closureStatus === "open");
      checks.push({
        id: "open_disputes",
        name: "Open disputes check",
        category: "Review Completeness",
        severity: "warning",
        status: openDisputes.length === 0 ? "pass" : "warning",
        message: openDisputes.length === 0 
          ? "No open disputes remaining"
          : `${openDisputes.length} dispute(s) still open`,
        details: { 
          openCount: openDisputes.length, 
          totalDisputeValue: openDisputes.reduce((sum: number, d: any) => sum + (d.disputeAmount || 0), 0),
          bookingIds: openDisputes.slice(0, 5).map((d: any) => d.bookingId),
        },
      });
      
      // CHECK 9: Grand total variance (SP total vs HO total)
      const spTotal = allRows.reduce((sum: number, r: any) => sum + (r.spNetInHo || 0), 0);
      const hoTotal = allRows.reduce((sum: number, r: any) => sum + (r.hoNet || 0), 0);
      const totalDifference = Math.abs(spTotal - hoTotal);
      const variancePercent = spTotal !== 0 ? (totalDifference / Math.abs(spTotal)) * 100 : 0;
      checks.push({
        id: "grand_total_variance",
        name: "Grand total variance",
        category: "Financial Sanity",
        severity: "warning",
        status: variancePercent <= 10 ? "pass" : "warning",
        message: variancePercent <= 10 
          ? `Variance within threshold (${variancePercent.toFixed(1)}% difference between SP and HO totals)`
          : `High variance: ${variancePercent.toFixed(1)}% difference between SP total (${formatIndianNumber(spTotal)}) and HO total (${formatIndianNumber(hoTotal)})`,
        details: { spTotal, hoTotal, totalDifference, variancePercent: Math.round(variancePercent * 10) / 10 },
      });
      
      // CHECK 10: Amount Paid reconciliation
      const amountPaidBookings = allRows.filter((r: any) => r.amountPaid && r.amountPaid !== 0);
      const totalAmountPaid = amountPaidBookings.reduce((sum: number, r: any) => sum + (r.amountPaid || 0), 0);
      checks.push({
        id: "amount_paid_reconciliation",
        name: "Amount Paid reconciliation",
        category: "Financial Sanity",
        severity: "warning",
        status: "pass",
        message: amountPaidBookings.length === 0 
          ? "No Amount Paid entries found"
          : `${amountPaidBookings.length} booking(s) with Amount Paid totalling ${formatIndianNumber(totalAmountPaid)}`,
        details: { bookingCount: amountPaidBookings.length, totalAmountPaid },
      });
      
      // CHECK 11: Vendor corrections completeness (for secondary vendor bookings)
      const svBookings = result.secondaryVendorRows || [];
      const svWithoutCorrection = svBookings.filter((r: any) => !vendorCorrectionMap.has(r.bookingId));
      checks.push({
        id: "vendor_corrections",
        name: "Secondary vendor assignments",
        category: "Data Completeness",
        severity: "warning",
        status: svWithoutCorrection.length === 0 ? "pass" : "warning",
        message: svBookings.length === 0 
          ? "No secondary vendor bookings"
          : svWithoutCorrection.length === 0 
            ? `All ${svBookings.length} secondary vendor bookings have vendor corrections`
            : `${svWithoutCorrection.length} of ${svBookings.length} secondary vendor bookings need vendor assignment`,
        details: { total: svBookings.length, unresolved: svWithoutCorrection.length },
      });
      
      // CHECK 12: Data source verification (use result row counts instead of loading full upload)
      const hoBookingCount = result.primaryRows.length + result.secondaryVendorRows.length;
      const spFxCount = result.spFxDebugRows?.length || 0;
      checks.push({
        id: "data_source_verification",
        name: "Data source verification",
        category: "Data Completeness",
        severity: "critical",
        status: hoBookingCount > 0 && spFxCount > 0 ? "pass" : "fail",
        message: hoBookingCount > 0 && spFxCount > 0
          ? `Source data verified: ${hoBookingCount} reconciled bookings, ${spFxCount} SP invoice rows`
          : `Missing source data: ${hoBookingCount === 0 ? "No HO bookings" : ""} ${spFxCount === 0 ? "No SP invoice rows" : ""}`,
        details: { hoBookingCount, spFxCount },
      });
      
      const criticalFails = checks.filter(c => c.severity === "critical" && c.status === "fail");
      const warnings = checks.filter(c => c.status === "warning");
      const passed = checks.filter(c => c.status === "pass");
      
      res.json({
        checks,
        summary: {
          total: checks.length,
          passed: passed.length,
          warnings: warnings.length,
          criticalFails: criticalFails.length,
          canProceed: criticalFails.length === 0,
        },
      });
    } catch (error) {
      console.error("Validation error:", error);
      res.status(500).json({ error: "Failed to run validation checks" });
    }
  });

  // Unmapped Resolutions
  app.get("/api/unmapped-resolutions/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const resolutions = await storage.getUnmappedResolutions(runId);
      res.json(resolutions);
    } catch (error) {
      console.error("Get unmapped resolutions error:", error);
      res.status(500).json({ error: "Failed to get unmapped resolutions" });
    }
  });

  app.post("/api/unmapped-resolutions", async (req, res) => {
    try {
      const { runId, bookingId, resolutionType, referenceNumber, amountPaid, note } = req.body;
      if (!runId || !bookingId || !["prepurchase", "other"].includes(resolutionType)) {
        return res.status(400).json({ error: "Missing required fields: runId, bookingId, resolutionType (prepurchase/other)" });
      }
      const resolution = await storage.upsertUnmappedResolution({
        runId: String(runId).trim(),
        bookingId: String(bookingId).trim(),
        resolutionType,
        referenceNumber: referenceNumber || null,
        amountPaid: typeof amountPaid === "number" ? amountPaid : null,
        note: note || null,
      });
      res.json({ resolution });
    } catch (error) {
      console.error("Create unmapped resolution error:", error);
      res.status(500).json({ error: "Failed to save unmapped resolution" });
    }
  });

  app.delete("/api/unmapped-resolutions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const deleted = await storage.deleteUnmappedResolution(id);
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete unmapped resolution error:", error);
      res.status(500).json({ error: "Failed to delete unmapped resolution" });
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

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomUUID } from "crypto";
import multer from "multer";
import XLSX from "xlsx-js-style";
import path from "path";
import fs from "fs";
import type { UploadedFile, SheetData, FxRate } from "@shared/schema";
import { runReconciliation } from "./reconciliation";

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
   * Create a new run from an uploaded file and start reconciliation
   */
  app.post("/api/runs/from-upload", async (req, res) => {
    try {
      const { uploadId } = req.body;

      if (!uploadId) {
        return res.status(400).json({ error: "Missing uploadId" });
      }

      // Get upload record
      const upload = await storage.getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      if (!upload.hoData || !upload.spData) {
        return res.status(400).json({ error: "Upload missing required data sheets" });
      }

      // Create run record
      const run = await storage.createRun({
        uploadId,
        status: "processing",
        progressStep: "Fetching FX rates",
        createdAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      });

      // Start reconciliation in background
      (async () => {
        try {
          await storage.updateRun(run.id, { progressStep: "Processing HO Data" });
          await storage.updateRun(run.id, { progressStep: "Processing SP Data" });
          await storage.updateRun(run.id, { progressStep: "Computing reconciliation" });

          const result = await runReconciliation(upload.hoData!, upload.spData!);

          await storage.setRunResult(run.id, result);
          await storage.updateRun(run.id, {
            status: "done",
            progressStep: "Complete",
            completedAt: new Date().toISOString(),
          });
        } catch (error) {
          console.error("Reconciliation error:", error);
          await storage.updateRun(run.id, {
            status: "error",
            progressStep: "Failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      })();

      res.json({ runId: run.id });
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
      const hoData: SheetData = {
        name: "HO Data",
        headers: ["bookingId", "netPrice", "currency", "bookingCreationDate", "bookingStatus", "Cancellable", "Cancellation Insurance"],
        rows: [
          { bookingId: "BK001", netPrice: 100, currency: "USD", bookingCreationDate: "2024-01-15", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No" },
          { bookingId: "BK001", netPrice: 50, currency: "USD", bookingCreationDate: "2024-01-10", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No" }, // Duplicate - Secondary
          { bookingId: "BK002", netPrice: 150, currency: "EUR", bookingCreationDate: "2024-01-16", bookingStatus: "CONFIRMED", Cancellable: "No", "Cancellation Insurance": "Yes" },
          { bookingId: "BK003", netPrice: 200, currency: "USD", bookingCreationDate: "2024-01-17", bookingStatus: "CANCELLED", Cancellable: "Yes", "Cancellation Insurance": "No" },
          { bookingId: "BK004", netPrice: 75, currency: "GBP", bookingCreationDate: "2024-01-18", bookingStatus: "CANCELLED", Cancellable: "No", "Cancellation Insurance": "No" },
          { bookingId: "BK005", netPrice: 300, currency: "USD", bookingCreationDate: "2024-01-19", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No" },
          { bookingId: "BK006", netPrice: 125, currency: "USD", bookingCreationDate: "2024-01-20", bookingStatus: "CONFIRMED", Cancellable: "No", "Cancellation Insurance": "No" },
          { bookingId: "BK007", netPrice: 50, currency: "EUR", bookingCreationDate: "2024-01-21", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "Yes" },
          { bookingId: "BK008", netPrice: 180, currency: "USD", bookingCreationDate: "2024-01-22", bookingStatus: "PENDING", Cancellable: "No", "Cancellation Insurance": "No" },
          { bookingId: "BK009", netPrice: 220, currency: "USD", bookingCreationDate: "2024-01-23", bookingStatus: "CONFIRMED", Cancellable: "Yes", "Cancellation Insurance": "No" },
          { bookingId: "BK010", netPrice: 90, currency: "GBP", bookingCreationDate: "2024-01-24", bookingStatus: "CONFIRMED", Cancellable: "No", "Cancellation Insurance": "Yes" },
        ],
      };

      const spData: SheetData = {
        name: "SP Invoice Report",
        headers: ["bookingId", "netPrice", "Billing Currency", "fulfilmentDate"],
        rows: [
          { bookingId: "BK001", netPrice: 95, "Billing Currency": "USD", fulfilmentDate: "2024-01-16" },
          { bookingId: "BK002", netPrice: 150, "Billing Currency": "EUR", fulfilmentDate: "2024-01-17" },
          { bookingId: "BK003", netPrice: 50, "Billing Currency": "USD", fulfilmentDate: "2024-01-18" },
          { bookingId: "BK005", netPrice: 290, "Billing Currency": "USD", fulfilmentDate: "2024-01-20" },
          { bookingId: "BK006", netPrice: 125, "Billing Currency": "USD", fulfilmentDate: "2024-01-21" },
          { bookingId: "BK007", netPrice: 48, "Billing Currency": "EUR", fulfilmentDate: "2024-01-22" },
          { bookingId: "BK009", netPrice: 215, "Billing Currency": "USD", fulfilmentDate: "2024-01-24" },
          { bookingId: "BK010", netPrice: 85, "Billing Currency": "GBP", fulfilmentDate: "2024-01-25" },
          { bookingId: "BK999", netPrice: 500, "Billing Currency": "USD", fulfilmentDate: "2024-01-26" }, // Unmapped
        ],
      };

      // Create upload record
      const fileInfo: UploadedFile = {
        id: randomUUID(),
        name: "demo_reconciliation.xlsx",
        size: 2048,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sheetNames: ["HO Data", "SP Invoice Report"],
      };

      const uploadRecord = await storage.createUpload(fileInfo, hoData, spData);

      // Create run
      const run = await storage.createRun({
        uploadId: uploadRecord.id,
        status: "processing",
        progressStep: "Computing reconciliation",
        createdAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      });

      // Run reconciliation
      const result = await runReconciliation(hoData, spData);

      // Store results
      await storage.setRunResult(run.id, result);
      await storage.updateRun(run.id, {
        status: "done",
        progressStep: "Complete",
        completedAt: new Date().toISOString(),
      });

      res.json({
        runId: run.id,
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
      payableSheet["!cols"] = [{ wch: 25 }, { wch: 12 }, { wch: 15 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(workbook, payableSheet, "Payable Summary");

      // =====================================================
      // SHEET 2: Discrepancy Analysis
      // =====================================================
      // Part A: Overall Summary (excluding Reconciled)
      const discrepancySummary = result.overallSummary.filter(r => r.reason !== "Reconciled").map(row => ({
        "Reason": row.reason,
        "Currency": row.currency,
        "Discrepancy (LC)": row.discrepancyLc,
        "Discrepancy (USD)": row.discrepancyUsd,
        "Count BID": row.countBid,
      }));

      // Part B: TID-level breakdown for each reason
      const discrepancyRows = result.primaryRows.filter(r => r.reason !== "Reconciled");
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
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (Math.abs(maxPct - minPct) < 0.5) {
            discrepancyPercentRange = minPct.toFixed(2) + "%";
            pattern = "Scattered";
          } else {
            discrepancyPercentRange = minPct.toFixed(2) + "% - " + maxPct.toFixed(2) + "%";
            pattern = "Consistent";
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

      // Sort TID analysis by reason then TID
      tidAnalysisData.sort((a, b) => {
        if (a["Reason"] !== b["Reason"]) return a["Reason"].localeCompare(b["Reason"]);
        return a["TID"].localeCompare(b["TID"]);
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
        const borderStyle = { style: "thin", color: { rgb: "000000" } };
        const border = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: startRow + r, c: startCol + c });
            if (!sheet[cellRef]) sheet[cellRef] = { v: "", t: "s" };
            
            // Apply border
            sheet[cellRef].s = sheet[cellRef].s || {};
            sheet[cellRef].s.border = border;
            
            // Bold for header row (first row of table)
            if (r === 0) {
              sheet[cellRef].s.font = { bold: true };
            }
            
            // Left align first column
            if (c === 0) {
              sheet[cellRef].s.alignment = { horizontal: "left" };
            }
            
            // Apply number/date formats (skip header row)
            if (r > 0 && columns[c]) {
              const colName = columns[c].toLowerCase();
              // Number format for discrepancy and loss columns - use cell.z for xlsx-js-style
              if (colName.includes("discrepancy") && !colName.includes("%") && !colName.includes("range")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].t = "n";
                  sheet[cellRef].z = "#,##0.00";
                }
              }
              if (colName.includes("loss") && !colName.includes("?")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].t = "n";
                  sheet[cellRef].z = "#,##0.00";
                }
              }
              // Date format for start/end date columns - use cell.z for xlsx-js-style
              if (colName === "start date" || colName === "end date") {
                const val = sheet[cellRef].v;
                // Convert to number if it's a numeric string or already a number
                const numVal = typeof val === "number" ? val : parseFloat(String(val));
                if (!isNaN(numVal) && numVal > 25000) {
                  // Truncate to date only (remove time portion) and set as number with date format
                  sheet[cellRef].v = Math.floor(numVal);
                  sheet[cellRef].t = "n";
                  sheet[cellRef].z = "dd/mm/yyyy";
                }
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
      
      XLSX.utils.book_append_sheet(workbook, discrepancySheet, "Discrepancy Analysis");

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
      XLSX.utils.book_append_sheet(workbook, spReportSheet, "SP Invoice Report");

      // =====================================================
      // SHEET 4: HO Report Updated
      // =====================================================
      // Original HO data + SP Net + Difference + Difference % + Secondary updates
      const hoReportData = originalHoData.map((row: Record<string, unknown>) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        
        // Get all reconciliation rows for this bookingId
        const reconRows = allRowsMap.get(bookingId) || [];
        
        // Determine if this HO row is Primary or Secondary based on the original data
        // Look for fulfillment identifier in original row (common field names)
        const hoFulfillment = String(row["fulfillmentIdentifier"] || row["Fulfillment Identifier"] || row["Type"] || "Primary");
        const isSecondary = hoFulfillment === "Secondary" || hoFulfillment.toLowerCase().includes("secondary");
        
        // Find matching reconciliation row (prefer matching by fulfillment type, otherwise take first)
        const reconRow = reconRows.find(r => 
          (isSecondary && r.fulfillmentIdentifier === "Secondary") ||
          (!isSecondary && r.fulfillmentIdentifier === "Primary")
        ) || reconRows[0];
        
        if (isSecondary) {
          // Secondary bookings: Final net = 0, Comments = "Duplicate Fulfilment"
          return {
            ...row,
            "SP Net": reconRow?.spNetInHo ?? "",
            "Difference": reconRow ? reconRow.hoNet - reconRow.spNetInHo : "",
            "Difference %": reconRow && reconRow.hoNet !== 0 
              ? ((reconRow.hoNet - reconRow.spNetInHo) / reconRow.hoNet * 100).toFixed(2) + "%" 
              : "",
            "Final Net": 0,
            "Comments": "Duplicate Fulfilment",
          };
        } else {
          // Primary bookings: Normal columns with Final Net = HO Net
          return {
            ...row,
            "SP Net": reconRow?.spNetInHo ?? "",
            "Difference": reconRow ? reconRow.hoNet - reconRow.spNetInHo : "",
            "Difference %": reconRow && reconRow.hoNet !== 0 
              ? ((reconRow.hoNet - reconRow.spNetInHo) / reconRow.hoNet * 100).toFixed(2) + "%" 
              : "",
            "Final Net": reconRow?.hoNet ?? "",
            "Comments": "",
          };
        }
      });
      const hoReportSheet = XLSX.utils.json_to_sheet(hoReportData);
      XLSX.utils.book_append_sheet(workbook, hoReportSheet, "HO Report Updated");

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
      let discrepancyRows = result.primaryRows.filter(r => r.reason !== "Reconciled");
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
          if (uniquePercents.length === 1) {
            discrepancyPercentRange = `${uniquePercents[0].toFixed(2)}%`;
            pattern = "Scattered";
          } else {
            const minPct = Math.min(...group.discrepancyPercents);
            const maxPct = Math.max(...group.discrepancyPercents);
            discrepancyPercentRange = `${minPct.toFixed(2)}% - ${maxPct.toFixed(2)}%`;
            pattern = "Consistent";
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

      // Get unique reasons for filtering
      const reasonsSet = new Set(result.primaryRows.filter(r => r.reason !== "Reconciled").map(r => r.reason));
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

  return httpServer;
}

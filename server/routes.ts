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
import { getUncachableGoogleSheetClient } from "./google-sheets";

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
        
        // Determine finalNetPrice, errorTeamAttribution, errorBucket, comments based on reason
        let finalNetPrice: number | string = "";
        let errorTeamAttribution = row["errorTeamAttribution"] || row["Error Team Attribution"] || "";
        let errorBucket = row["errorBucket"] || row["Error Bucket"] || "";
        let comments = row["comments"] || row["Comments"] || "";
        
        const reason = reconRow?.reason || "Reconciled";
        const fulfillmentMethod = String(reconRow?.fulfillmentMethod || row["fulfillmentMethod"] || row["Fulfillment Method"] || "");
        const priceSync = String(row["priceSync"] || row["Price Sync"] || row["PriceSync"] || "");
        
        if (isSecondary) {
          // Secondary rows: finalNetPrice = 0, comments = "Duplicate Fulfillment"
          finalNetPrice = 0;
          comments = "Duplicate Fulfillment";
        } else if (reason === "Reconciled") {
          // Reconciled: finalNetPrice = SP Net, comments = "Reconciled"
          finalNetPrice = spNet;
          comments = "Reconciled";
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
          } else if (keyLower === "comments") {
            newRow[key] = comments;
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
        }
        
        return newRow;
      });
      const hoReportSheet = XLSX.utils.json_to_sheet(hoReportData);
      XLSX.utils.book_append_sheet(workbook, hoReportSheet, "HO Report Updated");

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
      
      // Apply styling: borders, number/date formats
      const borderStyle = { style: "thin", color: { rgb: "000000" } };
      const border = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
      
      for (const region of tableRegions) {
        for (let r = region.startRow; r <= region.endRow; r++) {
          for (let c = 0; c < region.numCols; c++) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (!draftMessagesSheet[cellRef]) draftMessagesSheet[cellRef] = { v: "", t: "s" };
            
            // Apply border
            draftMessagesSheet[cellRef].s = draftMessagesSheet[cellRef].s || {};
            draftMessagesSheet[cellRef].s.border = border;
            
            // Bold for headers
            if (region.type === 'header' || (region.type === 'tid' && r === region.startRow) || (region.type === 'dri' && r === region.startRow)) {
              draftMessagesSheet[cellRef].s.font = { bold: true };
            }
            
            // Number format for Discrepancy USD (column 1 in TID table, index 1)
            if (region.type === 'tid' && c === 1 && r > region.startRow) {
              if (typeof draftMessagesSheet[cellRef].v === "number") {
                draftMessagesSheet[cellRef].z = "#,##0.00";
              }
            }
            
            // Date format for Start Date (col 2) and End Date (col 3) in TID table
            if (region.type === 'tid' && (c === 2 || c === 3) && r > region.startRow) {
              const val = draftMessagesSheet[cellRef].v;
              const numVal = typeof val === "number" ? val : parseFloat(String(val));
              if (!isNaN(numVal) && numVal > 25000) {
                // Truncate to date only and set as number with date format
                draftMessagesSheet[cellRef].v = Math.floor(numVal);
                draftMessagesSheet[cellRef].t = "n";
                draftMessagesSheet[cellRef].z = "dd/mm/yyyy";
              }
            }
          }
        }
      }
      
      // Remove gridlines
      draftMessagesSheet["!sheetViews"] = [{ showGridLines: false }];
      
      draftMessagesSheet["!cols"] = [
        { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, 
        { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 18 }
      ];
      
      // Apply wrapText to column B (Slack draft column, index 1)
      const range = XLSX.utils.decode_range(draftMessagesSheet["!ref"] || "A1");
      for (let r = 0; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 1 });
        if (draftMessagesSheet[cellRef]) {
          draftMessagesSheet[cellRef].s = draftMessagesSheet[cellRef].s || {};
          draftMessagesSheet[cellRef].s.alignment = { wrapText: true, vertical: "top" };
        }
      }
      XLSX.utils.book_append_sheet(workbook, draftMessagesSheet, "Draft Messages");

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
        
        // Apply formatting
        const driRange = XLSX.utils.decode_range(driSheet["!ref"] || "A1");
        for (let r = 1; r <= driRange.e.r; r++) {
          // Date format for Creation Date (col 1) and Experience Date (col 2)
          for (const col of [1, 2]) {
            const cellRef = XLSX.utils.encode_cell({ r, c: col });
            if (driSheet[cellRef] && driSheet[cellRef].v) {
              const val = driSheet[cellRef].v;
              if (typeof val === "string" && val) {
                const date = new Date(val);
                if (!isNaN(date.getTime())) {
                  driSheet[cellRef].v = Math.floor((date.getTime() / 86400000) + 25569);
                  driSheet[cellRef].t = "n";
                  driSheet[cellRef].z = "dd/mm/yyyy";
                }
              }
            }
          }
          
          // Number format for numeric columns
          const numericCols = [13, 14, 16, 18, 20]; // HO SP, HO Net, SP Net, Difference LC, Difference USD
          for (const col of numericCols) {
            const cellRef = XLSX.utils.encode_cell({ r, c: col });
            if (driSheet[cellRef] && typeof driSheet[cellRef].v === "number") {
              driSheet[cellRef].z = "#,##0.00";
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
        
        // Create sheet name (Excel limits to 31 chars)
        const shortReason = reason === "Multiple Tickets Booked" ? "MTB" : reason === "Net Price Discrepancy" ? "NPD" : reason.substring(0, 10);
        const sheetName = `${driTeam.substring(0, 20)}_${shortReason}`.substring(0, 31);
        
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

      // Get Google Sheets client
      const sheets = await getUncachableGoogleSheetClient();

      // Create a new spreadsheet
      const spreadsheetTitle = `Reconciliation Export - ${new Date().toISOString().split("T")[0]}`;
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: spreadsheetTitle,
          },
          sheets: [
            { properties: { title: "Payable Summary" } },
            { properties: { title: "Discrepancy Analysis" } },
            { properties: { title: "SP Invoice Report" } },
            { properties: { title: "HO Report Updated" } },
          ],
        },
      });

      const spreadsheetId = createResponse.data.spreadsheetId;
      const spreadsheetUrl = createResponse.data.spreadsheetUrl;

      if (!spreadsheetId) {
        throw new Error("Failed to create spreadsheet");
      }

      // Prepare sheet data

      // Sheet 1: Payable Summary
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

      const payableSummaryData: (string | number)[][] = [
        ["Description", "Currency", "Amount", "Note"],
      ];

      Array.from(spTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push(["Payable as per SP", ccy, amount, "Sum of SP Invoice"]);
      });

      Array.from(hoTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push(["Payable as per HO", ccy, amount, "Sum of HO Net (Primary only)"]);
      });

      // Sheet 2: Discrepancy Analysis
      const discrepancyData: (string | number)[][] = [
        ["Reason", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Count BID"],
      ];

      result.overallSummary
        .filter(r => r.reason !== "Reconciled")
        .forEach(row => {
          discrepancyData.push([
            row.reason,
            row.currency,
            row.discrepancyLc,
            row.discrepancyUsd,
            row.countBid,
          ]);
        });

      // Sheet 3: SP Invoice Report
      const spReportData: (string | number | null)[][] = [
        ["Booking ID", "SP Net (Original)", "SP Currency"],
      ];

      result.spFxDebugRows.forEach(row => {
        spReportData.push([
          row.bookingId,
          row.spNetOriginal,
          row.spCurrency,
        ]);
      });

      // Sheet 4: HO Report Updated
      const hoReportData: (string | number | null)[][] = [
        ["Booking ID", "HO Net", "Currency", "SP Net (in HO)", "Difference", "Difference %", "Reason", "DRI Team"],
      ];

      result.primaryRows.forEach(row => {
        hoReportData.push([
          row.bookingId,
          row.hoNet,
          row.hoCurrency,
          row.spNetInHo,
          row.differenceLc,
          row.differencePct !== null ? `${(row.differencePct * 100).toFixed(2)}%` : "",
          row.reason,
          row.driTeam || "",
        ]);
      });

      // Write data to sheets
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            { range: "Payable Summary!A1", values: payableSummaryData },
            { range: "Discrepancy Analysis!A1", values: discrepancyData },
            { range: "SP Invoice Report!A1", values: spReportData },
            { range: "HO Report Updated!A1", values: hoReportData },
          ],
        },
      });

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
      const { runId, bookingId, billingEntityId, billingEntityName, currency, disputeAmount, maxDisputeAmount } = req.body;
      
      // Check if dispute already exists for this booking
      const existing = await storage.getDisputeByBooking(runId, bookingId);
      if (existing) {
        // Update existing dispute
        const updated = await storage.updateDispute(existing.disputeId, {
          disputeAmount,
          billingEntityId,
          billingEntityName,
        });
        return res.json({ dispute: updated });
      }
      
      const dispute = await storage.createDispute({
        runId,
        bookingId,
        billingEntityId: billingEntityId || "",
        billingEntityName: billingEntityName || "",
        currency: currency || "USD",
        disputeAmount: disputeAmount || 0,
        maxDisputeAmount: maxDisputeAmount || 0,
        status: "pending",
        closureStatus: "open",
      });
      res.json({ dispute });
    } catch (error) {
      console.error("Create dispute error:", error);
      res.status(500).json({ error: "Failed to create dispute" });
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

  // Close disputes when used in post-recon adjustments
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
      // Fetch from all runs to find the disputes by their IDs
      const allDisputes = await Promise.all(
        disputeIds.map(async (id: string) => {
          // Disputes are stored with their disputeId as key, search across all runs
          // Get dispute directly by looking through storage
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
      
      // Close the disputes
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

  return httpServer;
}

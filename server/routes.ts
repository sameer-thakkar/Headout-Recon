import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomUUID } from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";
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
const upload = multer({ storage: diskStorage });

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
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      const uploadedFile = req.file;

      if (!uploadedFile) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const ext = uploadedFile.originalname.split(".").pop()?.toLowerCase() || "";

      if (ext !== "xlsx" && ext !== "xls") {
        // Delete unsupported file
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          error: `Unsupported file format: ${ext}. Please upload an .xlsx file.`,
        });
      }

      // Read and parse file
      const fileBuffer = fs.readFileSync(uploadedFile.path);
      const sheets = parseXlsxWithSheets(fileBuffer);

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
        hoDataRowCount: hoData.rows.length,
        spDataRowCount: spData.rows.length,
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

  // Export as XLSX
  app.get("/api/export/xlsx", async (req, res) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=reconciliation.xlsx");
    res.send(Buffer.from("Mock XLSX content"));
  });

  return httpServer;
}

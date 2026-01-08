import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomUUID } from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import type {
  UploadedFile,
  ColumnMapping,
  ReconResult,
  SummaryRow,
  DraftMessage,
  FxRate,
} from "@shared/schema";
import { requiredFields, optionalFields, headerAliases, driTeams, reasonCodes } from "@shared/schema";

// Multer memory storage for file uploads
const upload = multer({ storage: multer.memoryStorage() });

interface ParsedFile {
  id: string;
  name: string;
  size: number;
  ext: string;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

function parseXlsx(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return { headers: [], rows: [] };
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { headers: [], rows: [] };
  }
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
  return { headers, rows: jsonData };
}

function parseCsv(content: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const result = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  const headers = result.meta.fields || [];
  return { headers, rows: result.data };
}

// Demo data
const demoReconData = [
  { bid: "BK001", tid: "TID-001", currency: "USD", hoNet: 100.00, spNet: 95.00, bookingStatus: "CONFIRMED", experienceName: "City Tour", supplierName: "TourCo" },
  { bid: "BK002", tid: "TID-001", currency: "EUR", hoNet: 150.00, spNet: 150.00, bookingStatus: "CONFIRMED", experienceName: "City Tour", supplierName: "TourCo" },
  { bid: "BK003", tid: "TID-002", currency: "USD", hoNet: 200.00, spNet: 0.00, bookingStatus: "CONFIRMED", experienceName: "Museum Pass", supplierName: "MuseumInc" },
  { bid: "BK004", tid: "TID-002", currency: "GBP", hoNet: 75.00, spNet: 80.00, bookingStatus: "CANCELLED", experienceName: "Museum Pass", supplierName: "MuseumInc" },
  { bid: "BK005", tid: "TID-003", currency: "USD", hoNet: 300.00, spNet: 290.00, bookingStatus: "CONFIRMED", experienceName: "Theme Park", supplierName: "FunPark" },
  { bid: "BK006", tid: "TID-003", currency: "USD", hoNet: 125.00, spNet: 125.00, bookingStatus: "CONFIRMED", experienceName: "Theme Park", supplierName: "FunPark" },
  { bid: "BK007", tid: "TID-004", currency: "EUR", hoNet: 50.00, spNet: 45.00, bookingStatus: "CONFIRMED", experienceName: "Walking Tour", supplierName: "WalkGuide" },
  { bid: "BK008", tid: "TID-004", currency: "USD", hoNet: 180.00, spNet: 0.00, bookingStatus: "PENDING", experienceName: "Walking Tour", supplierName: "WalkGuide" },
  { bid: "BK009", tid: "TID-005", currency: "USD", hoNet: 220.00, spNet: 215.00, bookingStatus: "CONFIRMED", experienceName: "Food Tour", supplierName: "FoodieInc" },
  { bid: "BK010", tid: "TID-005", currency: "GBP", hoNet: 90.00, spNet: 100.00, bookingStatus: "CONFIRMED", experienceName: "Food Tour", supplierName: "FoodieInc" },
];

const defaultFxRates: FxRate[] = [
  { currency: "USD", rateToUsd: 1.0, lastUpdated: new Date().toISOString() },
  { currency: "EUR", rateToUsd: 1.08, lastUpdated: new Date().toISOString() },
  { currency: "GBP", rateToUsd: 1.27, lastUpdated: new Date().toISOString() },
  { currency: "INR", rateToUsd: 0.012, lastUpdated: new Date().toISOString() },
  { currency: "AED", rateToUsd: 0.27, lastUpdated: new Date().toISOString() },
  { currency: "SGD", rateToUsd: 0.75, lastUpdated: new Date().toISOString() },
];

function computeReconResults(
  rawData: Record<string, unknown>[],
  fxRates: FxRate[]
): ReconResult[] {
  const fxMap = new Map(fxRates.map(r => [r.currency, r.rateToUsd]));

  return rawData.map((row) => {
    const bid = String(row.bid || "");
    const tid = String(row.tid || "");
    const currency = String(row.currency || "USD");
    const hoNet = Number(row.hoNet) || 0;
    const spNet = Number(row.spNet) || 0;
    const bookingStatus = String(row.bookingStatus || "");
    const experienceName = String(row.experienceName || "");
    const supplierName = String(row.supplierName || "");

    const difference = hoNet - spNet;
    const fxRate = fxMap.get(currency) || 1;
    const differenceUsd = difference * fxRate;

    // Determine reason and DRI team
    let reason = "Unknown";
    let driTeam = "Finance";
    let isPrimary = true;

    if (spNet === 0 && hoNet > 0) {
      reason = "MTB - Missing in Supplier";
      driTeam = "Tech";
    } else if (Math.abs(difference) > 0.01 && spNet > 0) {
      if (Math.abs(differenceUsd) > 10) {
        reason = "NPD - Price Mismatch";
        driTeam = "Inventory Ops";
      } else {
        reason = "Charge Loss - Non-API";
        driTeam = "Reservation Ops";
      }
    } else if (bookingStatus === "CANCELLED" && spNet !== 0) {
      reason = "Status Mismatch";
      driTeam = "Supply";
    }

    return {
      bid,
      tid,
      currency,
      hoNet,
      spNet,
      difference,
      differenceUsd,
      reason,
      driTeam,
      isPrimary,
      bookingStatus,
      experienceName,
      supplierName,
    };
  });
}

function computeSummaries(results: ReconResult[]): {
  overall: SummaryRow[];
  mtb: SummaryRow[];
  npd: SummaryRow[];
  chargeLoss: SummaryRow[];
} {
  const total = results.length;
  const groupByReason = new Map<string, ReconResult[]>();

  results.forEach((r) => {
    const existing = groupByReason.get(r.reason) || [];
    groupByReason.set(r.reason, [...existing, r]);
  });

  const overall: SummaryRow[] = [];
  const mtb: SummaryRow[] = [];
  const npd: SummaryRow[] = [];
  const chargeLoss: SummaryRow[] = [];

  groupByReason.forEach((items, category) => {
    const count = items.length;
    const totalDiscrepancyUsd = items.reduce((sum, r) => sum + Math.abs(r.differenceUsd), 0);
    const percentage = total > 0 ? (count / total) * 100 : 0;

    const row: SummaryRow = { category, count, totalDiscrepancyUsd, percentage };
    overall.push(row);

    if (category.startsWith("MTB")) {
      mtb.push(row);
    } else if (category.startsWith("NPD")) {
      npd.push(row);
    } else if (category.startsWith("Charge Loss")) {
      chargeLoss.push(row);
    }
  });

  return { overall, mtb, npd, chargeLoss };
}

function generateDraftMessages(results: ReconResult[]): DraftMessage[] {
  const messages: DraftMessage[] = [];
  const groupByTeam = new Map<string, ReconResult[]>();

  results.forEach((r) => {
    const existing = groupByTeam.get(r.driTeam) || [];
    groupByTeam.set(r.driTeam, [...existing, r]);
  });

  groupByTeam.forEach((items, driTeam) => {
    const mtbItems = items.filter(i => i.reason.startsWith("MTB"));
    const npdItems = items.filter(i => i.reason.startsWith("NPD"));
    const clItems = items.filter(i => i.reason.startsWith("Charge Loss"));

    if (mtbItems.length > 0) {
      const totalUsd = mtbItems.reduce((sum, r) => sum + Math.abs(r.differenceUsd), 0);
      messages.push({
        id: randomUUID(),
        driTeam,
        category: "MTB Combined",
        subject: `MTB Discrepancies - ${mtbItems.length} bookings`,
        body: `Hi ${driTeam} Team,\n\nWe have identified ${mtbItems.length} bookings with Missing to Bill (MTB) discrepancies totaling $${totalUsd.toFixed(2)} USD.\n\nBooking IDs:\n${mtbItems.map(i => `- ${i.bid} (${i.currency} ${i.difference.toFixed(2)})`).join('\n')}\n\nPlease review and take necessary action.\n\nBest regards,\nRecon Team`,
        bookingCount: mtbItems.length,
        totalDiscrepancyUsd: totalUsd,
      });
    }

    if (npdItems.length > 0) {
      const totalUsd = npdItems.reduce((sum, r) => sum + Math.abs(r.differenceUsd), 0);
      const includesPriceSync = driTeam === "Inventory Ops";
      messages.push({
        id: randomUUID(),
        driTeam,
        category: "NPD Per-Group",
        subject: `NPD Discrepancies - ${npdItems.length} bookings`,
        body: `Hi ${driTeam} Team,\n\nWe have identified ${npdItems.length} bookings with Non-Price Discrepancies (NPD) totaling $${totalUsd.toFixed(2)} USD.\n\nBooking IDs:\n${npdItems.map(i => `- ${i.bid}: HO ${i.currency} ${i.hoNet.toFixed(2)} vs SP ${i.spNet.toFixed(2)}`).join('\n')}${includesPriceSync ? '\n\nPlease check if price sync setup is needed.' : ''}\n\nBest regards,\nRecon Team`,
        bookingCount: npdItems.length,
        totalDiscrepancyUsd: totalUsd,
      });
    }

    if (clItems.length > 0) {
      const apiItems = clItems.filter(i => i.reason.includes("API"));
      const nonApiItems = clItems.filter(i => !i.reason.includes("API"));

      if (apiItems.length > 0) {
        const totalUsd = apiItems.reduce((sum, r) => sum + Math.abs(r.differenceUsd), 0);
        messages.push({
          id: randomUUID(),
          driTeam,
          category: "Charge Loss - API",
          subject: `API Charge Loss - ${apiItems.length} bookings`,
          body: `Hi ${driTeam} Team,\n\nWe have identified ${apiItems.length} API-related charge losses totaling $${totalUsd.toFixed(2)} USD.\n\nBooking IDs:\n${apiItems.map(i => `- ${i.bid}`).join('\n')}\n\nBest regards,\nRecon Team`,
          bookingCount: apiItems.length,
          totalDiscrepancyUsd: totalUsd,
        });
      }

      if (nonApiItems.length > 0) {
        const totalUsd = nonApiItems.reduce((sum, r) => sum + Math.abs(r.differenceUsd), 0);
        messages.push({
          id: randomUUID(),
          driTeam,
          category: "Charge Loss - Non-API",
          subject: `Non-API Charge Loss - ${nonApiItems.length} bookings`,
          body: `Hi ${driTeam} Team,\n\nWe have identified ${nonApiItems.length} non-API charge losses totaling $${totalUsd.toFixed(2)} USD.\n\nBooking IDs:\n${nonApiItems.map(i => `- ${i.bid}`).join('\n')}\n\nBest regards,\nRecon Team`,
          bookingCount: nonApiItems.length,
          totalDiscrepancyUsd: totalUsd,
        });
      }
    }
  });

  return messages;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize FX rates
  await storage.setFxRates(defaultFxRates);

  // Get all runs
  app.get("/api/runs", async (req, res) => {
    const runs = await storage.getRuns();
    res.json(runs);
  });

  // Upload files with real parsing
  app.post("/api/upload", upload.array("files"), async (req, res) => {
    try {
      const uploadedFiles = req.files as Express.Multer.File[];
      
      if (!uploadedFiles || uploadedFiles.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const parsedFiles: (ParsedFile & { type: string })[] = [];
      const allHeaders = new Set<string>();
      const unsupportedFiles: string[] = [];

      for (const file of uploadedFiles) {
        const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
        let headers: string[] = [];
        let rows: Record<string, unknown>[] = [];

        if (ext === "xlsx" || ext === "xls") {
          const result = parseXlsx(file.buffer);
          headers = result.headers;
          rows = result.rows;
        } else if (ext === "csv") {
          const content = file.buffer.toString("utf-8");
          const result = parseCsv(content);
          headers = result.headers;
          rows = result.rows;
        } else {
          unsupportedFiles.push(file.originalname);
          continue;
        }

        // Add headers to combined set
        headers.forEach((h) => allHeaders.add(h));

        // Get sample rows (first 5)
        const sampleRows = rows.slice(0, 5);

        parsedFiles.push({
          id: randomUUID(),
          name: file.originalname,
          size: file.size,
          ext,
          type: file.mimetype,
          headers,
          rowCount: rows.length,
          sampleRows,
        });
      }

      // Return error if all files were unsupported
      if (parsedFiles.length === 0 && unsupportedFiles.length > 0) {
        return res.status(400).json({ 
          error: `Unsupported file format(s): ${unsupportedFiles.join(", ")}. Please upload .xlsx or .csv files.` 
        });
      }

      const combinedHeaders = Array.from(allHeaders).sort();

      res.json({ 
        files: parsedFiles, 
        combinedHeaders,
        ...(unsupportedFiles.length > 0 && { skippedFiles: unsupportedFiles })
      });
    } catch (error) {
      console.error("Upload parsing error:", error);
      res.status(500).json({ error: "Failed to parse uploaded files" });
    }
  });

  // Demo mode - load sample data and run full reconciliation
  app.post("/api/demo", async (req, res) => {
    const runId = randomUUID();
    const fxRates = await storage.getFxRates();

    const files: UploadedFile[] = [
      {
        id: randomUUID(),
        name: "demo_recon_report.xlsx",
        size: 2048,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        rowCount: demoReconData.length,
        headers: Object.keys(demoReconData[0]),
      },
    ];

    const headers = Object.keys(demoReconData[0]);

    // Auto-detect mappings
    const mappings: ColumnMapping[] = [...requiredFields, ...optionalFields].map((field) => {
      const aliases = headerAliases[field] || [field];
      const detected = headers.find((h) =>
        aliases.some((alias) => h.toLowerCase().includes(alias.toLowerCase()))
      );
      return {
        fieldName: field,
        detectedColumn: detected || null,
        overrideColumn: null,
        isRequired: requiredFields.includes(field as typeof requiredFields[number]),
        isMatched: !!detected,
      };
    });

    // Compute results
    const results = computeReconResults(demoReconData, fxRates);
    const summaries = computeSummaries(results);
    const draftMessages = generateDraftMessages(results);

    // Store data
    await storage.createRun({
      name: "Demo Run",
      status: "done",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      fileCount: files.length,
      totalBookings: results.length,
      totalDiscrepancyUsd: results.reduce((sum, r) => sum + Math.abs(r.differenceUsd), 0),
    });

    res.json({
      runId,
      files,
      headers,
      mappings,
      results,
      fxRates,
      overallSummary: summaries.overall,
      mtbSummary: summaries.mtb,
      npdSummary: summaries.npd,
      chargeLossSummary: summaries.chargeLoss,
      draftMessages,
      lastFxRefresh: new Date().toISOString(),
    });
  });

  // Run reconciliation steps
  app.post("/api/run/:step", async (req, res) => {
    const { step } = req.params;
    const fxRates = await storage.getFxRates();

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    switch (step) {
      case "parse":
        res.json({ success: true });
        break;

      case "fx":
        res.json({ fxRates });
        break;

      case "compute":
        const results = computeReconResults(demoReconData, fxRates);
        res.json({ results });
        break;

      case "summaries":
        const computedResults = computeReconResults(demoReconData, fxRates);
        const summaries = computeSummaries(computedResults);
        res.json({
          overallSummary: summaries.overall,
          mtbSummary: summaries.mtb,
          npdSummary: summaries.npd,
          chargeLossSummary: summaries.chargeLoss,
        });
        break;

      case "drafts":
        const allResults = computeReconResults(demoReconData, fxRates);
        const draftMessages = generateDraftMessages(allResults);
        res.json({ draftMessages });
        break;

      case "dri":
        res.json({ success: true });
        break;

      default:
        res.status(400).json({ error: "Unknown step" });
    }
  });

  // Refresh FX rates
  app.post("/api/fx/refresh", async (req, res) => {
    // In production, this would fetch from an external API
    const refreshedRates = defaultFxRates.map((rate) => ({
      ...rate,
      lastUpdated: new Date().toISOString(),
    }));
    await storage.setFxRates(refreshedRates);
    res.json({ fxRates: refreshedRates });
  });

  // Export as ZIP (mock)
  app.get("/api/export/zip", async (req, res) => {
    // In production, we'd create an actual ZIP file
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=reconciliation.zip");
    res.send(Buffer.from("Mock ZIP content"));
  });

  // Export as XLSX (mock)
  app.get("/api/export/xlsx", async (req, res) => {
    // In production, we'd create an actual XLSX file using a library
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=reconciliation.xlsx");
    res.send(Buffer.from("Mock XLSX content"));
  });

  return httpServer;
}

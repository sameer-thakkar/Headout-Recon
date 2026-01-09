import { randomUUID } from "crypto";
import type {
  RunRecord,
  UploadedFile,
  UploadRecord,
  SheetData,
  RunResult,
  FxRate,
  ColumnMapping,
  ReconResult,
  SummaryRow,
  DraftMessage,
} from "@shared/schema";

export interface IStorage {
  // Uploads
  createUpload(file: UploadedFile, hoData: SheetData | null, spData: SheetData | null): Promise<UploadRecord>;
  getUpload(id: string): Promise<UploadRecord | undefined>;
  
  // Runs
  getRuns(): Promise<RunRecord[]>;
  getRun(id: string): Promise<RunRecord | undefined>;
  createRun(run: Omit<RunRecord, "id">): Promise<RunRecord>;
  updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord | undefined>;
  
  // Run results
  setRunResult(runId: string, result: RunResult): Promise<void>;
  getRunResult(runId: string): Promise<RunResult | undefined>;

  // Legacy: FX Rates
  setFxRates(rates: FxRate[]): Promise<void>;
  getFxRates(): Promise<FxRate[]>;

  // Legacy: Temp file data (for upload processing)
  setTempFileData(id: string, headers: string[], rawData: Record<string, unknown>[]): Promise<void>;
  getTempFileData(id: string): Promise<{ headers: string[]; rawData: Record<string, unknown>[] } | undefined>;
}

export class MemStorage implements IStorage {
  private uploads: Map<string, UploadRecord> = new Map();
  private runs: Map<string, RunRecord> = new Map();
  private runResults: Map<string, RunResult> = new Map();
  private fxRates: FxRate[] = [];
  private tempFileData: Map<string, { headers: string[]; rawData: Record<string, unknown>[] }> = new Map();

  async createUpload(file: UploadedFile, hoData: SheetData | null, spData: SheetData | null): Promise<UploadRecord> {
    const id = randomUUID();
    const upload: UploadRecord = {
      id,
      file,
      hoData,
      spData,
      createdAt: new Date().toISOString(),
    };
    this.uploads.set(id, upload);
    return upload;
  }

  async getUpload(id: string): Promise<UploadRecord | undefined> {
    return this.uploads.get(id);
  }

  async getRuns(): Promise<RunRecord[]> {
    return Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.runs.get(id);
  }

  async createRun(run: Omit<RunRecord, "id">): Promise<RunRecord> {
    const id = randomUUID();
    const newRun: RunRecord = { ...run, id };
    this.runs.set(id, newRun);
    return newRun;
  }

  async updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const run = this.runs.get(id);
    if (!run) return undefined;
    const updated = { ...run, ...updates };
    this.runs.set(id, updated);
    return updated;
  }

  async setRunResult(runId: string, result: RunResult): Promise<void> {
    this.runResults.set(runId, result);
  }

  async getRunResult(runId: string): Promise<RunResult | undefined> {
    return this.runResults.get(runId);
  }

  async setFxRates(rates: FxRate[]): Promise<void> {
    this.fxRates = rates;
  }

  async getFxRates(): Promise<FxRate[]> {
    return this.fxRates;
  }

  async setTempFileData(id: string, headers: string[], rawData: Record<string, unknown>[]): Promise<void> {
    this.tempFileData.set(id, { headers, rawData });
  }

  async getTempFileData(id: string): Promise<{ headers: string[]; rawData: Record<string, unknown>[] } | undefined> {
    return this.tempFileData.get(id);
  }
}

export const storage = new MemStorage();

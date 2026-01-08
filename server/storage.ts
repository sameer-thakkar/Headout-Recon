import { randomUUID } from "crypto";
import type {
  RunRecord,
  UploadedFile,
  ColumnMapping,
  ReconResult,
  SummaryRow,
  DraftMessage,
  FxRate,
  RunData,
} from "@shared/schema";

export interface IStorage {
  // Runs
  getRuns(): Promise<RunRecord[]>;
  getRun(id: string): Promise<RunRecord | undefined>;
  createRun(run: Omit<RunRecord, "id">): Promise<RunRecord>;
  updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord | undefined>;

  // Run data
  getRunData(runId: string): Promise<RunData | undefined>;
  setRunData(runId: string, data: Partial<RunData>): Promise<void>;

  // Files
  addFiles(runId: string, files: UploadedFile[]): Promise<void>;
  getFiles(runId: string): Promise<UploadedFile[]>;

  // Mappings
  setMappings(runId: string, mappings: ColumnMapping[]): Promise<void>;
  getMappings(runId: string): Promise<ColumnMapping[]>;

  // Results
  setResults(runId: string, results: ReconResult[]): Promise<void>;
  getResults(runId: string): Promise<ReconResult[]>;

  // Summaries
  setSummaries(
    runId: string,
    overall: SummaryRow[],
    mtb: SummaryRow[],
    npd: SummaryRow[],
    chargeLoss: SummaryRow[]
  ): Promise<void>;

  // Drafts
  setDraftMessages(runId: string, messages: DraftMessage[]): Promise<void>;
  getDraftMessages(runId: string): Promise<DraftMessage[]>;

  // FX Rates
  setFxRates(rates: FxRate[]): Promise<void>;
  getFxRates(): Promise<FxRate[]>;

  // Temp file data (for upload processing)
  setTempFileData(runId: string, headers: string[], rawData: Record<string, unknown>[]): Promise<void>;
  getTempFileData(runId: string): Promise<{ headers: string[]; rawData: Record<string, unknown>[] } | undefined>;
}

export class MemStorage implements IStorage {
  private runs: Map<string, RunRecord> = new Map();
  private runData: Map<string, RunData> = new Map();
  private files: Map<string, UploadedFile[]> = new Map();
  private mappings: Map<string, ColumnMapping[]> = new Map();
  private results: Map<string, ReconResult[]> = new Map();
  private summaries: Map<string, { overall: SummaryRow[]; mtb: SummaryRow[]; npd: SummaryRow[]; chargeLoss: SummaryRow[] }> = new Map();
  private draftMessages: Map<string, DraftMessage[]> = new Map();
  private fxRates: FxRate[] = [];
  private tempFileData: Map<string, { headers: string[]; rawData: Record<string, unknown>[] }> = new Map();

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

  async getRunData(runId: string): Promise<RunData | undefined> {
    return this.runData.get(runId);
  }

  async setRunData(runId: string, data: Partial<RunData>): Promise<void> {
    const existing = this.runData.get(runId) || {} as RunData;
    this.runData.set(runId, { ...existing, ...data } as RunData);
  }

  async addFiles(runId: string, newFiles: UploadedFile[]): Promise<void> {
    const existing = this.files.get(runId) || [];
    this.files.set(runId, [...existing, ...newFiles]);
  }

  async getFiles(runId: string): Promise<UploadedFile[]> {
    return this.files.get(runId) || [];
  }

  async setMappings(runId: string, newMappings: ColumnMapping[]): Promise<void> {
    this.mappings.set(runId, newMappings);
  }

  async getMappings(runId: string): Promise<ColumnMapping[]> {
    return this.mappings.get(runId) || [];
  }

  async setResults(runId: string, newResults: ReconResult[]): Promise<void> {
    this.results.set(runId, newResults);
  }

  async getResults(runId: string): Promise<ReconResult[]> {
    return this.results.get(runId) || [];
  }

  async setSummaries(
    runId: string,
    overall: SummaryRow[],
    mtb: SummaryRow[],
    npd: SummaryRow[],
    chargeLoss: SummaryRow[]
  ): Promise<void> {
    this.summaries.set(runId, { overall, mtb, npd, chargeLoss });
  }

  async setDraftMessages(runId: string, messages: DraftMessage[]): Promise<void> {
    this.draftMessages.set(runId, messages);
  }

  async getDraftMessages(runId: string): Promise<DraftMessage[]> {
    return this.draftMessages.get(runId) || [];
  }

  async setFxRates(rates: FxRate[]): Promise<void> {
    this.fxRates = rates;
  }

  async getFxRates(): Promise<FxRate[]> {
    return this.fxRates;
  }

  async setTempFileData(runId: string, headers: string[], rawData: Record<string, unknown>[]): Promise<void> {
    this.tempFileData.set(runId, { headers, rawData });
  }

  async getTempFileData(runId: string): Promise<{ headers: string[]; rawData: Record<string, unknown>[] } | undefined> {
    return this.tempFileData.get(runId);
  }
}

export const storage = new MemStorage();

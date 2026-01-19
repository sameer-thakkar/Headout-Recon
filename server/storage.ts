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
  DisputeRecord,
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

  // Disputes
  createDispute(dispute: Omit<DisputeRecord, "disputeId" | "createdAt">): Promise<DisputeRecord>;
  getDisputes(runId: string): Promise<DisputeRecord[]>;
  getOpenDisputes(runId: string): Promise<DisputeRecord[]>;
  getDisputeById(disputeId: string): Promise<DisputeRecord | undefined>;
  updateDispute(disputeId: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | undefined>;
  deleteDispute(disputeId: string): Promise<boolean>;
  getDisputeByBooking(runId: string, bookingId: string): Promise<DisputeRecord | undefined>;
  closeDisputes(disputeIds: string[], adjustmentAmount: number): Promise<DisputeRecord[]>;
}

export class MemStorage implements IStorage {
  private uploads: Map<string, UploadRecord> = new Map();
  private runs: Map<string, RunRecord> = new Map();
  private runResults: Map<string, RunResult> = new Map();
  private fxRates: FxRate[] = [];
  private tempFileData: Map<string, { headers: string[]; rawData: Record<string, unknown>[] }> = new Map();
  private disputes: Map<string, DisputeRecord> = new Map();
  private disputeCounter: number = 0;

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

  async createDispute(dispute: Omit<DisputeRecord, "disputeId" | "createdAt">): Promise<DisputeRecord> {
    // Ensure counter is higher than any existing DID to prevent duplicates
    const existingIds = Array.from(this.disputes.keys());
    const maxExisting = existingIds.reduce((max, id) => {
      const match = id.match(/DID-#(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 0);
    
    // Use the higher of current counter or max existing
    if (maxExisting >= this.disputeCounter) {
      this.disputeCounter = maxExisting;
    }
    
    this.disputeCounter++;
    const disputeId = `DID-#${this.disputeCounter}`;
    const newDispute: DisputeRecord = {
      ...dispute,
      disputeId,
      createdAt: new Date().toISOString(),
      closureStatus: dispute.closureStatus || "open", // Default to open
    };
    this.disputes.set(disputeId, newDispute);
    return newDispute;
  }

  async closeDisputes(disputeIds: string[], adjustmentAmount: number): Promise<DisputeRecord[]> {
    const closedDisputes: DisputeRecord[] = [];
    const now = new Date().toISOString();
    
    for (const disputeId of disputeIds) {
      const dispute = this.disputes.get(disputeId);
      if (dispute && dispute.closureStatus === "open") {
        const updated: DisputeRecord = {
          ...dispute,
          closureStatus: "closed",
          closedAt: now,
          closedByAdjustmentAmount: adjustmentAmount,
          updatedAt: now,
        };
        this.disputes.set(disputeId, updated);
        closedDisputes.push(updated);
      }
    }
    
    return closedDisputes;
  }

  async getOpenDisputes(runId: string): Promise<DisputeRecord[]> {
    return Array.from(this.disputes.values())
      .filter(d => d.runId === runId && d.closureStatus === "open")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getDisputeById(disputeId: string): Promise<DisputeRecord | undefined> {
    return this.disputes.get(disputeId);
  }

  async getDisputes(runId: string): Promise<DisputeRecord[]> {
    return Array.from(this.disputes.values())
      .filter(d => d.runId === runId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async updateDispute(disputeId: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | undefined> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return undefined;
    const updated = { ...dispute, ...updates, updatedAt: new Date().toISOString() };
    this.disputes.set(disputeId, updated);
    return updated;
  }

  async deleteDispute(disputeId: string): Promise<boolean> {
    return this.disputes.delete(disputeId);
  }

  async getDisputeByBooking(runId: string, bookingId: string): Promise<DisputeRecord | undefined> {
    return Array.from(this.disputes.values()).find(d => d.runId === runId && d.bookingId === bookingId);
  }
}

export const storage = new MemStorage();

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
  IssueRecord,
  VendorCorrection,
  VendorBalance,
  InsertVendorBalance,
  PaxType,
  InsertPaxType,
  PortalReload,
  InsertPortalReload,
  ReloadAdjustment,
  InsertReloadAdjustment,
  UnmappedResolution,
  InsertUnmappedResolution,
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
  manualCloseDisputes(disputeIds: string[], note?: string): Promise<DisputeRecord[]>;

  // Issues
  createIssue(issue: Omit<IssueRecord, "issueId" | "createdDate">): Promise<IssueRecord>;
  getIssues(runId: string): Promise<IssueRecord[]>;
  getIssueById(issueId: string): Promise<IssueRecord | undefined>;
  updateIssue(issueId: string, updates: Partial<IssueRecord>): Promise<IssueRecord | undefined>;
  deleteIssue(issueId: string): Promise<boolean>;

  // Vendor Corrections
  setVendorCorrection(runId: string, bookingId: string, finalVendorId: string): Promise<VendorCorrection>;
  getVendorCorrections(runId: string): Promise<VendorCorrection[]>;
  getVendorCorrection(runId: string, bookingId: string): Promise<VendorCorrection | undefined>;
  deleteVendorCorrection(runId: string, bookingId: string): Promise<boolean>;
  bulkSetVendorCorrections(runId: string, corrections: { bookingId: string; finalVendorId: string }[]): Promise<VendorCorrection[]>;

  // Vendor Balances (for Purchase Reconciliation)
  getVendorBalance(beId: string): Promise<VendorBalance | undefined>;
  getVendorBalances(): Promise<VendorBalance[]>;
  upsertVendorBalance(balance: InsertVendorBalance): Promise<VendorBalance>;
  deleteVendorBalance(beId: string): Promise<boolean>;

  // Pax Types
  getPaxTypes(): Promise<PaxType[]>;
  createPaxType(paxType: InsertPaxType): Promise<PaxType>;
  bulkCreatePaxTypes(names: string[]): Promise<PaxType[]>;
  deletePaxType(id: number): Promise<boolean>;
  deleteAllPaxTypes(): Promise<boolean>;

  // Portal Reloads
  getPortalReloads(): Promise<PortalReload[]>;
  getPortalReloadsByBeId(beId: string): Promise<PortalReload[]>;
  getPortalReloadTotal(beId: string): Promise<number>;
  bulkCreatePortalReloads(reloads: InsertPortalReload[]): Promise<PortalReload[]>;
  deleteAllPortalReloads(): Promise<boolean>;

  // Reload Adjustments
  getReloadAdjustmentsByBeId(beId: string): Promise<ReloadAdjustment[]>;
  createReloadAdjustment(data: InsertReloadAdjustment): Promise<ReloadAdjustment>;
  deleteReloadAdjustment(id: number): Promise<boolean>;

  // Unmapped Resolutions
  getUnmappedResolutions(runId: string): Promise<UnmappedResolution[]>;
  upsertUnmappedResolution(data: InsertUnmappedResolution): Promise<UnmappedResolution>;
  deleteUnmappedResolution(id: number): Promise<boolean>;

  // Dispute Overrides (per-run, per-booking edits from Manage Disputes modal)
  setDisputeOverrides(runId: string, overrides: Record<string, DisputeOverride>): Promise<void>;
  getDisputeOverrides(runId: string): Promise<Record<string, DisputeOverride>>;

  // Price Overrides (per-run, per-booking edits from Amount Payable panel)
  setPriceOverrides(runId: string, overrides: Record<string, PriceOverride>): Promise<void>;
  getPriceOverrides(runId: string): Promise<Record<string, PriceOverride>>;
}

export interface DisputeOverride {
  disputeAdj?: number;
  discrepancyAdj?: number;
  finalDispute?: number;
  ticketId?: string;
  status?: string;
}

export interface PriceOverride {
  totalAmountPayable: number;
  selection?: "ho" | "sp";
}

export class MemStorage implements IStorage {
  private uploads: Map<string, UploadRecord> = new Map();
  private runs: Map<string, RunRecord> = new Map();
  private runResults: Map<string, RunResult> = new Map();
  private fxRates: FxRate[] = [];
  private tempFileData: Map<string, { headers: string[]; rawData: Record<string, unknown>[] }> = new Map();
  private disputes: Map<string, DisputeRecord> = new Map();
  private disputeCounter: number = 0;
  private issues: Map<string, IssueRecord> = new Map();
  private issueCounter: number = 0;
  private vendorCorrections: Map<string, VendorCorrection> = new Map(); // key: runId:bookingId
  private vendorBalances: Map<string, VendorBalance> = new Map(); // key: beId
  private paxTypesList: PaxType[] = [];
  private paxTypeCounter: number = 0;
  private portalReloadsList: PortalReload[] = [];
  private portalReloadCounter: number = 0;
  private disputeOverrides: Map<string, Record<string, DisputeOverride>> = new Map();
  private priceOverrides: Map<string, Record<string, PriceOverride>> = new Map();

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
          closureType: "sp_error", // SP Error - full amount adjusted, no HO net update needed
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

  async manualCloseDisputes(disputeIds: string[], note?: string): Promise<DisputeRecord[]> {
    const closedDisputes: DisputeRecord[] = [];
    const now = new Date().toISOString();
    
    for (const disputeId of disputeIds) {
      const dispute = this.disputes.get(disputeId);
      if (dispute && dispute.closureStatus === "open") {
        const updated: DisputeRecord = {
          ...dispute,
          closureStatus: "closed",
          closureType: "manual_writeoff",
          closureNote: note,
          closedAt: now,
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

  // Issue methods
  async createIssue(issue: Omit<IssueRecord, "issueId" | "createdDate">): Promise<IssueRecord> {
    // Ensure counter is higher than any existing IID to prevent duplicates
    const existingIds = Array.from(this.issues.keys());
    const maxExisting = existingIds.reduce((max, id) => {
      const match = id.match(/IID-#(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 0);
    
    if (maxExisting >= this.issueCounter) {
      this.issueCounter = maxExisting;
    }
    
    this.issueCounter++;
    const issueId = `IID-#${this.issueCounter}`;
    const newIssue: IssueRecord = {
      ...issue,
      issueId,
      createdDate: new Date().toISOString(),
    };
    this.issues.set(issueId, newIssue);
    return newIssue;
  }

  async getIssues(runId: string): Promise<IssueRecord[]> {
    return Array.from(this.issues.values())
      .filter(i => i.runId === runId)
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
  }

  async getIssueById(issueId: string): Promise<IssueRecord | undefined> {
    return this.issues.get(issueId);
  }

  async updateIssue(issueId: string, updates: Partial<IssueRecord>): Promise<IssueRecord | undefined> {
    const issue = this.issues.get(issueId);
    if (!issue) return undefined;
    const { issueId: _, runId: __, createdDate: ___, ...safeUpdates } = updates;
    const updated = { ...issue, ...safeUpdates };
    this.issues.set(issueId, updated);
    return updated;
  }

  async deleteIssue(issueId: string): Promise<boolean> {
    return this.issues.delete(issueId);
  }

  // Vendor Correction methods
  async setVendorCorrection(runId: string, bookingId: string, finalVendorId: string): Promise<VendorCorrection> {
    const key = `${runId}:${bookingId}`;
    const existing = this.vendorCorrections.get(key);
    
    const correction: VendorCorrection = {
      runId,
      bookingId,
      finalVendorId,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    this.vendorCorrections.set(key, correction);
    return correction;
  }

  async getVendorCorrections(runId: string): Promise<VendorCorrection[]> {
    return Array.from(this.vendorCorrections.values())
      .filter(vc => vc.runId === runId);
  }

  async getVendorCorrection(runId: string, bookingId: string): Promise<VendorCorrection | undefined> {
    return this.vendorCorrections.get(`${runId}:${bookingId}`);
  }

  async deleteVendorCorrection(runId: string, bookingId: string): Promise<boolean> {
    return this.vendorCorrections.delete(`${runId}:${bookingId}`);
  }

  async bulkSetVendorCorrections(runId: string, corrections: { bookingId: string; finalVendorId: string }[]): Promise<VendorCorrection[]> {
    const results: VendorCorrection[] = [];
    for (const { bookingId, finalVendorId } of corrections) {
      const correction = await this.setVendorCorrection(runId, bookingId, finalVendorId);
      results.push(correction);
    }
    return results;
  }

  // Vendor Balances
  async getVendorBalance(beId: string): Promise<VendorBalance | undefined> {
    return this.vendorBalances.get(beId);
  }

  async getVendorBalances(): Promise<VendorBalance[]> {
    return Array.from(this.vendorBalances.values());
  }

  async upsertVendorBalance(balance: InsertVendorBalance): Promise<VendorBalance> {
    const existing = this.vendorBalances.get(balance.beId);
    const now = new Date().toISOString();
    
    const vendorBalance: VendorBalance = {
      ...balance,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    
    this.vendorBalances.set(balance.beId, vendorBalance);
    return vendorBalance;
  }

  async deleteVendorBalance(beId: string): Promise<boolean> {
    return this.vendorBalances.delete(beId);
  }

  // Pax Types
  async getPaxTypes(): Promise<PaxType[]> {
    return [...this.paxTypesList];
  }

  async createPaxType(paxType: InsertPaxType): Promise<PaxType> {
    const existing = this.paxTypesList.find(p => p.name === paxType.name);
    if (existing) return existing;
    const newPaxType: PaxType = {
      id: ++this.paxTypeCounter,
      name: paxType.name,
      createdAt: new Date().toISOString(),
    };
    this.paxTypesList.push(newPaxType);
    return newPaxType;
  }

  async bulkCreatePaxTypes(names: string[]): Promise<PaxType[]> {
    const results: PaxType[] = [];
    for (const name of names) {
      const result = await this.createPaxType({ name });
      results.push(result);
    }
    return results;
  }

  async deletePaxType(id: number): Promise<boolean> {
    const idx = this.paxTypesList.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.paxTypesList.splice(idx, 1);
    return true;
  }

  async deleteAllPaxTypes(): Promise<boolean> {
    this.paxTypesList = [];
    return true;
  }

  // Portal Reloads
  async getPortalReloads(): Promise<PortalReload[]> {
    return [...this.portalReloadsList];
  }

  async getPortalReloadsByBeId(beId: string): Promise<PortalReload[]> {
    return this.portalReloadsList.filter(r => r.beId === beId);
  }

  async getPortalReloadTotal(beId: string): Promise<number> {
    return this.portalReloadsList
      .filter(r => r.beId === beId)
      .reduce((sum, r) => sum + r.paidAmount, 0);
  }

  async bulkCreatePortalReloads(reloads: InsertPortalReload[]): Promise<PortalReload[]> {
    const created: PortalReload[] = [];
    for (const reload of reloads) {
      const newReload: PortalReload = {
        id: ++this.portalReloadCounter,
        beId: reload.beId,
        paidAmount: reload.paidAmount,
        zendeskId: reload.zendeskId ?? null,
        dateOfPayment: reload.dateOfPayment ?? null,
        amountLoadedAtDate: reload.amountLoadedAtDate ?? null,
        createdAt: new Date().toISOString(),
      };
      this.portalReloadsList.push(newReload);
      created.push(newReload);
    }
    return created;
  }

  async deleteAllPortalReloads(): Promise<boolean> {
    this.portalReloadsList = [];
    return true;
  }

  // Reload Adjustments
  private reloadAdjustmentsList: ReloadAdjustment[] = [];
  private reloadAdjustmentCounter: number = 0;

  async getReloadAdjustmentsByBeId(beId: string): Promise<ReloadAdjustment[]> {
    return this.reloadAdjustmentsList.filter(a => a.beId === beId);
  }

  async createReloadAdjustment(data: InsertReloadAdjustment): Promise<ReloadAdjustment> {
    const newAdj: ReloadAdjustment = {
      id: ++this.reloadAdjustmentCounter,
      beId: data.beId,
      zendeskId: data.zendeskId ?? null,
      dateOfPayment: data.dateOfPayment ?? null,
      amountLoadedAtDate: data.amountLoadedAtDate ?? null,
      paidAmount: data.paidAmount,
      adjustmentType: data.adjustmentType,
      createdAt: new Date().toISOString(),
    };
    this.reloadAdjustmentsList.push(newAdj);
    return newAdj;
  }

  async deleteReloadAdjustment(id: number): Promise<boolean> {
    const idx = this.reloadAdjustmentsList.findIndex(a => a.id === id);
    if (idx === -1) return false;
    this.reloadAdjustmentsList.splice(idx, 1);
    return true;
  }

  // Unmapped Resolutions
  private unmappedResolutionsList: UnmappedResolution[] = [];
  private unmappedResolutionCounter: number = 0;

  async getUnmappedResolutions(runId: string): Promise<UnmappedResolution[]> {
    return this.unmappedResolutionsList.filter(r => r.runId === runId);
  }

  async upsertUnmappedResolution(data: InsertUnmappedResolution): Promise<UnmappedResolution> {
    const existingIdx = this.unmappedResolutionsList.findIndex(r => r.runId === data.runId && r.bookingId === data.bookingId);
    const resolution: UnmappedResolution = {
      id: existingIdx >= 0 ? this.unmappedResolutionsList[existingIdx].id : ++this.unmappedResolutionCounter,
      runId: data.runId,
      bookingId: data.bookingId,
      resolutionType: data.resolutionType,
      referenceNumber: data.referenceNumber ?? null,
      amountPaid: data.amountPaid ?? null,
      note: data.note ?? null,
      createdAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      this.unmappedResolutionsList[existingIdx] = resolution;
    } else {
      this.unmappedResolutionsList.push(resolution);
    }
    return resolution;
  }

  async deleteUnmappedResolution(id: number): Promise<boolean> {
    const idx = this.unmappedResolutionsList.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.unmappedResolutionsList.splice(idx, 1);
    return true;
  }

  async setDisputeOverrides(runId: string, overrides: Record<string, DisputeOverride>): Promise<void> {
    const existing = this.disputeOverrides.get(runId) || {};
    this.disputeOverrides.set(runId, { ...existing, ...overrides });
  }

  async getDisputeOverrides(runId: string): Promise<Record<string, DisputeOverride>> {
    return this.disputeOverrides.get(runId) || {};
  }

  async setPriceOverrides(runId: string, overrides: Record<string, PriceOverride>): Promise<void> {
    const existing = this.priceOverrides.get(runId) || {};
    this.priceOverrides.set(runId, { ...existing, ...overrides });
  }

  async getPriceOverrides(runId: string): Promise<Record<string, PriceOverride>> {
    return this.priceOverrides.get(runId) || {};
  }
}

// Database-backed storage implementation
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  reconciliationSessions,
  disputes as disputesTable,
  issues as issuesTable,
  vendorCorrections as vendorCorrectionsTable,
  vendorBalances as vendorBalancesTable,
  paxTypes as paxTypesTable,
  portalReloads as portalReloadsTable,
  reloadAdjustments as reloadAdjustmentsTable,
  unmappedResolutions as unmappedResolutionsTable,
  counters,
  type ReconciliationSession,
} from "@shared/schema";

// Extended interface for session-based persistent storage
export interface ISessionStorage extends IStorage {
  // Session management
  createSession(name: string): Promise<ReconciliationSession>;
  getSession(id: string): Promise<ReconciliationSession | undefined>;
  getSessions(): Promise<ReconciliationSession[]>;
  updateSession(id: string, updates: Partial<ReconciliationSession>): Promise<ReconciliationSession | undefined>;
  deleteSession(id: string): Promise<boolean>;
  
  // Save full session data (files, results)
  saveSessionData(sessionId: string, data: {
    hoData?: SheetData | null;
    spData?: SheetData | null;
    hoFileName?: string;
    spFileName?: string;
    runResult?: RunResult;
    status?: string;
  }): Promise<ReconciliationSession | undefined>;
}

export class DatabaseStorage implements ISessionStorage {
  private tempFileData: Map<string, { headers: string[]; rawData: Record<string, unknown>[] }> = new Map();
  private fxRates: FxRate[] = [];
  
  // Helper to get next counter value
  private async getNextCounter(name: string): Promise<number> {
    const result = await db
      .insert(counters)
      .values({ id: name, value: 1 })
      .onConflictDoUpdate({
        target: counters.id,
        set: { value: sql`${counters.value} + 1` },
      })
      .returning();
    
    if (result.length > 0) {
      return result[0].value;
    }
    
    const counter = await db.select().from(counters).where(eq(counters.id, name));
    return counter[0]?.value || 1;
  }

  // Session management
  async createSession(name: string): Promise<ReconciliationSession> {
    const result = await db
      .insert(reconciliationSessions)
      .values({ name, status: "idle" })
      .returning();
    return result[0];
  }

  async getSession(id: string): Promise<ReconciliationSession | undefined> {
    const result = await db
      .select()
      .from(reconciliationSessions)
      .where(eq(reconciliationSessions.id, id));
    return result[0];
  }

  async getSessions(): Promise<ReconciliationSession[]> {
    return db
      .select({
        id: reconciliationSessions.id,
        name: reconciliationSessions.name,
        status: reconciliationSessions.status,
        progressStep: reconciliationSessions.progressStep,
        createdAt: reconciliationSessions.createdAt,
        completedAt: reconciliationSessions.completedAt,
        error: reconciliationSessions.error,
        hoFileName: reconciliationSessions.hoFileName,
        spFileName: reconciliationSessions.spFileName,
        hoFileSize: reconciliationSessions.hoFileSize,
        spFileSize: reconciliationSessions.spFileSize,
        hoData: sql`null`.as("ho_data"),
        spData: sql`null`.as("sp_data"),
        runResult: sql`null`.as("run_result"),
      })
      .from(reconciliationSessions)
      .orderBy(desc(reconciliationSessions.createdAt));
  }

  async updateSession(id: string, updates: Partial<ReconciliationSession>): Promise<ReconciliationSession | undefined> {
    const result = await db
      .update(reconciliationSessions)
      .set(updates)
      .where(eq(reconciliationSessions.id, id))
      .returning();
    return result[0];
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await db
      .delete(reconciliationSessions)
      .where(eq(reconciliationSessions.id, id))
      .returning();
    return result.length > 0;
  }

  async saveSessionData(sessionId: string, data: {
    hoData?: SheetData | null;
    spData?: SheetData | null;
    hoFileName?: string;
    spFileName?: string;
    runResult?: RunResult;
    status?: string;
  }): Promise<ReconciliationSession | undefined> {
    const updates: Partial<ReconciliationSession> = {};
    if (data.hoData !== undefined) updates.hoData = data.hoData;
    if (data.spData !== undefined) updates.spData = data.spData;
    if (data.hoFileName !== undefined) updates.hoFileName = data.hoFileName;
    if (data.spFileName !== undefined) updates.spFileName = data.spFileName;
    if (data.runResult !== undefined) updates.runResult = data.runResult;
    if (data.status !== undefined) updates.status = data.status;
    
    const result = await db
      .update(reconciliationSessions)
      .set(updates)
      .where(eq(reconciliationSessions.id, sessionId))
      .returning();
    return result[0];
  }

  // Upload methods - store data in session
  async createUpload(file: UploadedFile, hoData: SheetData | null, spData: SheetData | null): Promise<UploadRecord> {
    const session = await this.createSession(file.name || "Unnamed Session");
    
    await this.saveSessionData(session.id, {
      hoData,
      spData,
      hoFileName: file.name,
    });
    
    return {
      id: session.id,
      file,
      hoData,
      spData,
      createdAt: session.createdAt.toISOString(),
    };
  }

  async getUpload(id: string): Promise<UploadRecord | undefined> {
    const session = await this.getSession(id);
    if (!session) return undefined;
    
    return {
      id: session.id,
      file: {
        id: session.id,
        name: session.hoFileName || "",
        size: session.hoFileSize || 0,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      hoData: session.hoData as SheetData | null,
      spData: session.spData as SheetData | null,
      createdAt: session.createdAt.toISOString(),
    };
  }

  // Run methods - mapped to sessions
  async getRuns(): Promise<RunRecord[]> {
    const sessions = await this.getSessions();
    return sessions.map(s => ({
      id: s.id,
      uploadId: s.id,
      status: s.status as "idle" | "processing" | "done" | "error",
      progressStep: s.progressStep,
      createdAt: s.createdAt.toISOString(),
      completedAt: s.completedAt?.toISOString() || null,
      error: s.error,
    }));
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const session = await this.getSession(id);
    if (!session) return undefined;
    
    return {
      id: session.id,
      uploadId: session.id,
      status: session.status as "idle" | "processing" | "done" | "error",
      progressStep: session.progressStep,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() || null,
      error: session.error,
    };
  }

  async createRun(run: Omit<RunRecord, "id">): Promise<RunRecord> {
    const session = await this.createSession("Run " + new Date().toLocaleString());
    await this.updateSession(session.id, {
      status: run.status,
      progressStep: run.progressStep,
    });
    
    return {
      id: session.id,
      ...run,
    };
  }

  async updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const sessionUpdates: Partial<ReconciliationSession> = {};
    if (updates.status) sessionUpdates.status = updates.status;
    if (updates.progressStep !== undefined) sessionUpdates.progressStep = updates.progressStep;
    if (updates.error !== undefined) sessionUpdates.error = updates.error;
    if (updates.completedAt !== undefined) sessionUpdates.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    
    const session = await this.updateSession(id, sessionUpdates);
    if (!session) return undefined;
    
    return {
      id: session.id,
      uploadId: session.id,
      status: session.status as "idle" | "processing" | "done" | "error",
      progressStep: session.progressStep,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() || null,
      error: session.error,
    };
  }

  // Run results - stored in session
  async setRunResult(runId: string, result: RunResult): Promise<void> {
    await this.saveSessionData(runId, { runResult: result, status: "done" });
  }

  async getRunResult(runId: string): Promise<RunResult | undefined> {
    const session = await this.getSession(runId);
    return session?.runResult as RunResult | undefined;
  }

  // FX Rates (kept in memory, no persistence needed)
  async setFxRates(rates: FxRate[]): Promise<void> {
    this.fxRates = rates;
  }

  async getFxRates(): Promise<FxRate[]> {
    return this.fxRates;
  }

  // Temp file data (kept in memory)
  async setTempFileData(id: string, headers: string[], rawData: Record<string, unknown>[]): Promise<void> {
    this.tempFileData.set(id, { headers, rawData });
  }

  async getTempFileData(id: string): Promise<{ headers: string[]; rawData: Record<string, unknown>[] } | undefined> {
    return this.tempFileData.get(id);
  }

  // Dispute methods
  async createDispute(dispute: Omit<DisputeRecord, "disputeId" | "createdAt">): Promise<DisputeRecord> {
    const counter = await this.getNextCounter("dispute");
    const disputeId = `DID-#${counter}`;
    
    const result = await db
      .insert(disputesTable)
      .values({
        disputeId,
        sessionId: dispute.runId,
        bookingId: dispute.bookingId,
        billingEntityId: dispute.billingEntityId,
        billingEntityName: dispute.billingEntityName,
        ticketId: dispute.ticketId,
        tid: dispute.tid,
        currency: dispute.currency,
        disputeAmount: dispute.disputeAmount,
        maxDisputeAmount: dispute.maxDisputeAmount,
        reconciledNet: dispute.reconciledNet,
        status: dispute.status,
        closureStatus: dispute.closureStatus || "open",
      })
      .returning();
    
    return this.dbDisputeToRecord(result[0]);
  }

  private dbDisputeToRecord(d: typeof disputesTable.$inferSelect): DisputeRecord {
    return {
      disputeId: d.disputeId,
      runId: d.sessionId,
      bookingId: d.bookingId,
      billingEntityId: d.billingEntityId,
      billingEntityName: d.billingEntityName,
      ticketId: d.ticketId || undefined,
      tid: d.tid || undefined,
      currency: d.currency,
      disputeAmount: d.disputeAmount,
      maxDisputeAmount: d.maxDisputeAmount,
      reconciledNet: d.reconciledNet || undefined,
      status: d.status as "pending" | "submitted" | "resolved" | "rejected",
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt?.toISOString(),
      closureStatus: d.closureStatus as "open" | "closed",
      closureType: d.closureType as "adjustment" | "manual_writeoff" | "accept_ho_error" | "sp_error" | undefined,
      closureNote: d.closureNote || undefined,
      closedAt: d.closedAt?.toISOString(),
      closedByAdjustmentAmount: d.closedByAdjustmentAmount || undefined,
      adjustedInTicketId: d.adjustedInTicketId || undefined,
    };
  }

  async getDisputes(runId: string): Promise<DisputeRecord[]> {
    const results = await db
      .select()
      .from(disputesTable)
      .where(eq(disputesTable.sessionId, runId))
      .orderBy(desc(disputesTable.createdAt));
    
    return results.map(d => this.dbDisputeToRecord(d));
  }

  async getOpenDisputes(runId: string): Promise<DisputeRecord[]> {
    const results = await db
      .select()
      .from(disputesTable)
      .where(and(eq(disputesTable.sessionId, runId), eq(disputesTable.closureStatus, "open")))
      .orderBy(desc(disputesTable.createdAt));
    
    return results.map(d => this.dbDisputeToRecord(d));
  }

  async getDisputeById(disputeId: string): Promise<DisputeRecord | undefined> {
    const results = await db
      .select()
      .from(disputesTable)
      .where(eq(disputesTable.disputeId, disputeId));
    
    return results[0] ? this.dbDisputeToRecord(results[0]) : undefined;
  }

  async updateDispute(disputeId: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | undefined> {
    const dbUpdates: Partial<typeof disputesTable.$inferInsert> = {};
    if (updates.status) dbUpdates.status = updates.status;
    if (updates.closureStatus) dbUpdates.closureStatus = updates.closureStatus;
    if (updates.closureType) dbUpdates.closureType = updates.closureType;
    if (updates.closureNote !== undefined) dbUpdates.closureNote = updates.closureNote;
    if (updates.closedAt) dbUpdates.closedAt = new Date(updates.closedAt);
    if (updates.closedByAdjustmentAmount !== undefined) dbUpdates.closedByAdjustmentAmount = updates.closedByAdjustmentAmount;
    if (updates.adjustedInTicketId !== undefined) dbUpdates.adjustedInTicketId = updates.adjustedInTicketId;
    dbUpdates.updatedAt = new Date();
    
    const results = await db
      .update(disputesTable)
      .set(dbUpdates)
      .where(eq(disputesTable.disputeId, disputeId))
      .returning();
    
    return results[0] ? this.dbDisputeToRecord(results[0]) : undefined;
  }

  async deleteDispute(disputeId: string): Promise<boolean> {
    const result = await db
      .delete(disputesTable)
      .where(eq(disputesTable.disputeId, disputeId))
      .returning();
    return result.length > 0;
  }

  async getDisputeByBooking(runId: string, bookingId: string): Promise<DisputeRecord | undefined> {
    const results = await db
      .select()
      .from(disputesTable)
      .where(and(eq(disputesTable.sessionId, runId), eq(disputesTable.bookingId, bookingId)));
    
    return results[0] ? this.dbDisputeToRecord(results[0]) : undefined;
  }

  async closeDisputes(disputeIds: string[], adjustmentAmount: number): Promise<DisputeRecord[]> {
    const closedDisputes: DisputeRecord[] = [];
    const now = new Date();
    
    for (const disputeId of disputeIds) {
      const result = await db
        .update(disputesTable)
        .set({
          closureStatus: "closed",
          closureType: "sp_error",
          closedAt: now,
          closedByAdjustmentAmount: adjustmentAmount,
          updatedAt: now,
        })
        .where(and(eq(disputesTable.disputeId, disputeId), eq(disputesTable.closureStatus, "open")))
        .returning();
      
      if (result[0]) {
        closedDisputes.push(this.dbDisputeToRecord(result[0]));
      }
    }
    
    return closedDisputes;
  }

  async manualCloseDisputes(disputeIds: string[], note?: string): Promise<DisputeRecord[]> {
    const closedDisputes: DisputeRecord[] = [];
    const now = new Date();
    
    for (const disputeId of disputeIds) {
      const result = await db
        .update(disputesTable)
        .set({
          closureStatus: "closed",
          closureType: "manual_writeoff",
          closureNote: note,
          closedAt: now,
          updatedAt: now,
        })
        .where(and(eq(disputesTable.disputeId, disputeId), eq(disputesTable.closureStatus, "open")))
        .returning();
      
      if (result[0]) {
        closedDisputes.push(this.dbDisputeToRecord(result[0]));
      }
    }
    
    return closedDisputes;
  }

  private dbIssueToRecord(i: typeof issuesTable.$inferSelect): IssueRecord {
    return {
      issueId: i.issueId,
      runId: i.sessionId,
      createdDate: i.createdAt.toISOString(),
      billingEntityId: i.billingEntityId,
      billingEntityName: i.billingEntityName,
      currency: i.currency,
      discrepancyLocal: i.discrepancyLocal,
      discrepancyUsd: i.discrepancyUsd,
      reason: i.reason,
      driTeam: i.driTeam,
      bookingIds: i.bookingIds as string[] | undefined,
      paymentMethod: i.paymentMethod ?? undefined,
      period: i.period ?? undefined,
      assignee: i.assignee ?? undefined,
      errorBucket: i.errorBucket ?? undefined,
      rca: i.rca ?? undefined,
      slackLink: i.slackLink ?? undefined,
      workingsLink: i.workingsLink ?? undefined,
      issueStatus: i.issueStatus ?? undefined,
    };
  }

  // Issue methods
  async createIssue(issue: Omit<IssueRecord, "issueId" | "createdDate">): Promise<IssueRecord> {
    const counter = await this.getNextCounter("issue");
    const issueId = `IID-#${counter}`;
    
    const result = await db
      .insert(issuesTable)
      .values({
        issueId,
        sessionId: issue.runId,
        billingEntityId: issue.billingEntityId,
        billingEntityName: issue.billingEntityName,
        currency: issue.currency,
        discrepancyLocal: issue.discrepancyLocal,
        discrepancyUsd: issue.discrepancyUsd,
        reason: issue.reason,
        driTeam: issue.driTeam,
        bookingIds: issue.bookingIds,
        paymentMethod: issue.paymentMethod,
        period: issue.period,
        assignee: issue.assignee,
        errorBucket: issue.errorBucket,
        rca: issue.rca,
        slackLink: issue.slackLink,
        workingsLink: issue.workingsLink,
        issueStatus: issue.issueStatus,
      })
      .returning();
    
    return this.dbIssueToRecord(result[0]);
  }

  async getIssues(runId: string): Promise<IssueRecord[]> {
    const results = await db
      .select()
      .from(issuesTable)
      .where(eq(issuesTable.sessionId, runId))
      .orderBy(desc(issuesTable.createdAt));
    
    return results.map(i => this.dbIssueToRecord(i));
  }

  async getIssueById(issueId: string): Promise<IssueRecord | undefined> {
    const results = await db
      .select()
      .from(issuesTable)
      .where(eq(issuesTable.issueId, issueId));
    
    if (!results[0]) return undefined;
    return this.dbIssueToRecord(results[0]);
  }

  async updateIssue(issueId: string, updates: Partial<IssueRecord>): Promise<IssueRecord | undefined> {
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.assignee !== undefined) dbUpdates.assignee = updates.assignee;
    if (updates.errorBucket !== undefined) dbUpdates.errorBucket = updates.errorBucket;
    if (updates.rca !== undefined) dbUpdates.rca = updates.rca;
    if (updates.slackLink !== undefined) dbUpdates.slackLink = updates.slackLink;
    if (updates.workingsLink !== undefined) dbUpdates.workingsLink = updates.workingsLink;
    if (updates.issueStatus !== undefined) dbUpdates.issueStatus = updates.issueStatus;
    if (updates.driTeam !== undefined) dbUpdates.driTeam = updates.driTeam;
    if (updates.paymentMethod !== undefined) dbUpdates.paymentMethod = updates.paymentMethod;
    if (updates.period !== undefined) dbUpdates.period = updates.period;

    const result = await db
      .update(issuesTable)
      .set(dbUpdates)
      .where(eq(issuesTable.issueId, issueId))
      .returning();
    
    if (!result[0]) return undefined;
    return this.dbIssueToRecord(result[0]);
  }

  async deleteIssue(issueId: string): Promise<boolean> {
    const result = await db
      .delete(issuesTable)
      .where(eq(issuesTable.issueId, issueId))
      .returning();
    return result.length > 0;
  }

  // Vendor Correction methods
  async setVendorCorrection(runId: string, bookingId: string, finalVendorId: string): Promise<VendorCorrection> {
    const existing = await this.getVendorCorrection(runId, bookingId);
    
    if (existing) {
      const result = await db
        .update(vendorCorrectionsTable)
        .set({ finalVendorId, updatedAt: new Date() })
        .where(and(eq(vendorCorrectionsTable.sessionId, runId), eq(vendorCorrectionsTable.bookingId, bookingId)))
        .returning();
      
      return {
        runId: result[0].sessionId,
        bookingId: result[0].bookingId,
        finalVendorId: result[0].finalVendorId,
        createdAt: result[0].createdAt.toISOString(),
        updatedAt: result[0].updatedAt?.toISOString(),
      };
    }
    
    const result = await db
      .insert(vendorCorrectionsTable)
      .values({ sessionId: runId, bookingId, finalVendorId })
      .returning();
    
    return {
      runId: result[0].sessionId,
      bookingId: result[0].bookingId,
      finalVendorId: result[0].finalVendorId,
      createdAt: result[0].createdAt.toISOString(),
      updatedAt: result[0].updatedAt?.toISOString(),
    };
  }

  async getVendorCorrections(runId: string): Promise<VendorCorrection[]> {
    const results = await db
      .select()
      .from(vendorCorrectionsTable)
      .where(eq(vendorCorrectionsTable.sessionId, runId));
    
    return results.map(vc => ({
      runId: vc.sessionId,
      bookingId: vc.bookingId,
      finalVendorId: vc.finalVendorId,
      createdAt: vc.createdAt.toISOString(),
      updatedAt: vc.updatedAt?.toISOString(),
    }));
  }

  async getVendorCorrection(runId: string, bookingId: string): Promise<VendorCorrection | undefined> {
    const results = await db
      .select()
      .from(vendorCorrectionsTable)
      .where(and(eq(vendorCorrectionsTable.sessionId, runId), eq(vendorCorrectionsTable.bookingId, bookingId)));
    
    if (!results[0]) return undefined;
    
    return {
      runId: results[0].sessionId,
      bookingId: results[0].bookingId,
      finalVendorId: results[0].finalVendorId,
      createdAt: results[0].createdAt.toISOString(),
      updatedAt: results[0].updatedAt?.toISOString(),
    };
  }

  async deleteVendorCorrection(runId: string, bookingId: string): Promise<boolean> {
    const result = await db
      .delete(vendorCorrectionsTable)
      .where(and(eq(vendorCorrectionsTable.sessionId, runId), eq(vendorCorrectionsTable.bookingId, bookingId)))
      .returning();
    return result.length > 0;
  }

  async bulkSetVendorCorrections(runId: string, corrections: { bookingId: string; finalVendorId: string }[]): Promise<VendorCorrection[]> {
    const results: VendorCorrection[] = [];
    for (const { bookingId, finalVendorId } of corrections) {
      const correction = await this.setVendorCorrection(runId, bookingId, finalVendorId);
      results.push(correction);
    }
    return results;
  }

  // Vendor Balances
  async getVendorBalance(beId: string): Promise<VendorBalance | undefined> {
    const [result] = await db.select().from(vendorBalancesTable).where(eq(vendorBalancesTable.beId, beId));
    if (!result) return undefined;
    
    return {
      beId: result.beId,
      openingBalance: result.openingBalance,
      closingBalance: result.closingBalance,
      currency: result.currency,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  async getVendorBalances(): Promise<VendorBalance[]> {
    const results = await db.select().from(vendorBalancesTable);
    return results.map(result => ({
      beId: result.beId,
      openingBalance: result.openingBalance,
      closingBalance: result.closingBalance,
      currency: result.currency,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    }));
  }

  async upsertVendorBalance(balance: InsertVendorBalance): Promise<VendorBalance> {
    const now = new Date();
    const [result] = await db.insert(vendorBalancesTable)
      .values({
        beId: balance.beId,
        openingBalance: balance.openingBalance,
        closingBalance: balance.closingBalance,
        currency: balance.currency,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: vendorBalancesTable.beId,
        set: {
          openingBalance: balance.openingBalance,
          closingBalance: balance.closingBalance,
          currency: balance.currency,
          updatedAt: now,
        },
      })
      .returning();

    return {
      beId: result.beId,
      openingBalance: result.openingBalance,
      closingBalance: result.closingBalance,
      currency: result.currency,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  async deleteVendorBalance(beId: string): Promise<boolean> {
    const result = await db.delete(vendorBalancesTable).where(eq(vendorBalancesTable.beId, beId)).returning();
    return result.length > 0;
  }

  // Pax Types
  async getPaxTypes(): Promise<PaxType[]> {
    const results = await db.select().from(paxTypesTable).orderBy(paxTypesTable.name);
    return results.map(r => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createPaxType(paxType: InsertPaxType): Promise<PaxType> {
    const [result] = await db.insert(paxTypesTable)
      .values({ name: paxType.name })
      .onConflictDoNothing()
      .returning();
    if (!result) {
      const [existing] = await db.select().from(paxTypesTable).where(eq(paxTypesTable.name, paxType.name));
      return { id: existing.id, name: existing.name, createdAt: existing.createdAt.toISOString() };
    }
    return { id: result.id, name: result.name, createdAt: result.createdAt.toISOString() };
  }

  async bulkCreatePaxTypes(names: string[]): Promise<PaxType[]> {
    if (names.length === 0) return [];
    const values = names.map(name => ({ name }));
    await db.insert(paxTypesTable).values(values).onConflictDoNothing();
    return this.getPaxTypes();
  }

  async deletePaxType(id: number): Promise<boolean> {
    const result = await db.delete(paxTypesTable).where(eq(paxTypesTable.id, id)).returning();
    return result.length > 0;
  }

  async deleteAllPaxTypes(): Promise<boolean> {
    await db.delete(paxTypesTable);
    return true;
  }

  // Portal Reloads
  async getPortalReloads(): Promise<PortalReload[]> {
    const results = await db.select().from(portalReloadsTable).orderBy(portalReloadsTable.beId);
    return results.map(r => ({
      id: r.id,
      beId: r.beId,
      paidAmount: r.paidAmount,
      zendeskId: r.zendeskId,
      dateOfPayment: r.dateOfPayment,
      amountLoadedAtDate: r.amountLoadedAtDate,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getPortalReloadsByBeId(beId: string): Promise<PortalReload[]> {
    const results = await db.select().from(portalReloadsTable).where(eq(portalReloadsTable.beId, beId));
    return results.map(r => ({
      id: r.id,
      beId: r.beId,
      paidAmount: r.paidAmount,
      zendeskId: r.zendeskId,
      dateOfPayment: r.dateOfPayment,
      amountLoadedAtDate: r.amountLoadedAtDate,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getPortalReloadTotal(beId: string): Promise<number> {
    const results = await db.select().from(portalReloadsTable).where(eq(portalReloadsTable.beId, beId));
    return results.reduce((sum, r) => sum + r.paidAmount, 0);
  }

  async bulkCreatePortalReloads(reloads: InsertPortalReload[]): Promise<PortalReload[]> {
    if (reloads.length === 0) return [];
    await db.delete(portalReloadsTable);
    const values = reloads.map(r => ({
      beId: r.beId,
      paidAmount: r.paidAmount,
      zendeskId: r.zendeskId ?? null,
      dateOfPayment: r.dateOfPayment ?? null,
      amountLoadedAtDate: r.amountLoadedAtDate ?? null,
    }));
    await db.insert(portalReloadsTable).values(values);
    return this.getPortalReloads();
  }

  async deleteAllPortalReloads(): Promise<boolean> {
    await db.delete(portalReloadsTable);
    return true;
  }

  // Reload Adjustments
  async getReloadAdjustmentsByBeId(beId: string): Promise<ReloadAdjustment[]> {
    const results = await db.select().from(reloadAdjustmentsTable).where(eq(reloadAdjustmentsTable.beId, beId));
    return results.map(r => ({
      id: r.id,
      beId: r.beId,
      zendeskId: r.zendeskId,
      dateOfPayment: r.dateOfPayment,
      amountLoadedAtDate: r.amountLoadedAtDate,
      paidAmount: r.paidAmount,
      adjustmentType: r.adjustmentType as "add" | "less",
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createReloadAdjustment(data: InsertReloadAdjustment): Promise<ReloadAdjustment> {
    const [result] = await db.insert(reloadAdjustmentsTable).values({
      beId: data.beId,
      zendeskId: data.zendeskId ?? null,
      dateOfPayment: data.dateOfPayment ?? null,
      amountLoadedAtDate: data.amountLoadedAtDate ?? null,
      paidAmount: data.paidAmount,
      adjustmentType: data.adjustmentType,
    }).returning();
    return {
      id: result.id,
      beId: result.beId,
      zendeskId: result.zendeskId,
      dateOfPayment: result.dateOfPayment,
      amountLoadedAtDate: result.amountLoadedAtDate,
      paidAmount: result.paidAmount,
      adjustmentType: result.adjustmentType as "add" | "less",
      createdAt: result.createdAt.toISOString(),
    };
  }

  async deleteReloadAdjustment(id: number): Promise<boolean> {
    const result = await db.delete(reloadAdjustmentsTable).where(eq(reloadAdjustmentsTable.id, id)).returning();
    return result.length > 0;
  }

  async getUnmappedResolutions(runId: string): Promise<UnmappedResolution[]> {
    const results = await db.select().from(unmappedResolutionsTable).where(eq(unmappedResolutionsTable.runId, runId));
    return results.map(r => ({
      id: r.id,
      runId: r.runId,
      bookingId: r.bookingId,
      resolutionType: r.resolutionType as "prepurchase" | "other",
      referenceNumber: r.referenceNumber,
      amountPaid: r.amountPaid,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async upsertUnmappedResolution(data: InsertUnmappedResolution): Promise<UnmappedResolution> {
    const existing = await db.select().from(unmappedResolutionsTable)
      .where(and(eq(unmappedResolutionsTable.runId, data.runId), eq(unmappedResolutionsTable.bookingId, data.bookingId)));
    let result;
    if (existing.length > 0) {
      [result] = await db.update(unmappedResolutionsTable)
        .set({
          resolutionType: data.resolutionType,
          referenceNumber: data.referenceNumber ?? null,
          amountPaid: data.amountPaid ?? null,
          note: data.note ?? null,
        })
        .where(eq(unmappedResolutionsTable.id, existing[0].id))
        .returning();
    } else {
      [result] = await db.insert(unmappedResolutionsTable).values({
        runId: data.runId,
        bookingId: data.bookingId,
        resolutionType: data.resolutionType,
        referenceNumber: data.referenceNumber ?? null,
        amountPaid: data.amountPaid ?? null,
        note: data.note ?? null,
      }).returning();
    }
    return {
      id: result.id,
      runId: result.runId,
      bookingId: result.bookingId,
      resolutionType: result.resolutionType as "prepurchase" | "other",
      referenceNumber: result.referenceNumber,
      amountPaid: result.amountPaid,
      note: result.note,
      createdAt: result.createdAt.toISOString(),
    };
  }

  async deleteUnmappedResolution(id: number): Promise<boolean> {
    const result = await db.delete(unmappedResolutionsTable).where(eq(unmappedResolutionsTable.id, id)).returning();
    return result.length > 0;
  }

  private disputeOverridesCache: Map<string, Record<string, DisputeOverride>> = new Map();

  async setDisputeOverrides(runId: string, overrides: Record<string, DisputeOverride>): Promise<void> {
    const existing = this.disputeOverridesCache.get(runId) || {};
    this.disputeOverridesCache.set(runId, { ...existing, ...overrides });
  }

  async getDisputeOverrides(runId: string): Promise<Record<string, DisputeOverride>> {
    return this.disputeOverridesCache.get(runId) || {};
  }

  private priceOverridesCache: Map<string, Record<string, PriceOverride>> = new Map();

  async setPriceOverrides(runId: string, overrides: Record<string, PriceOverride>): Promise<void> {
    const existing = this.priceOverridesCache.get(runId) || {};
    this.priceOverridesCache.set(runId, { ...existing, ...overrides });
  }

  async getPriceOverrides(runId: string): Promise<Record<string, PriceOverride>> {
    return this.priceOverridesCache.get(runId) || {};
  }
}

// Use DatabaseStorage for persistent data or MemStorage for development
const USE_DATABASE = true;
export const storage: IStorage = USE_DATABASE ? new DatabaseStorage() : new MemStorage();
export const sessionStorage: ISessionStorage = new DatabaseStorage();

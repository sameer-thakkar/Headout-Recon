import { z } from "zod";

// Run status enum
export const runStatusSchema = z.enum(["idle", "processing", "done", "error"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

// FX Rate data from API (USD base)
export const fxDataSchema = z.object({
  usdToCcy: z.record(z.string(), z.number()),
  refreshedAt: z.string(),
});
export type FxData = z.infer<typeof fxDataSchema>;

// SP row augmented with FX debug info
export const spFxDebugRowSchema = z.object({
  bookingId: z.string(),
  spCurrency: z.string(),
  hoCurrencyUsed: z.string().nullable(),
  fxRateUsed: z.number().nullable(),
  spNetOriginal: z.number(),
  spNetInHo: z.number().nullable(),
});
export type SpFxDebugRow = z.infer<typeof spFxDebugRowSchema>;

// Primary reconciliation row (HO-based)
export const primaryRowSchema = z.object({
  bookingId: z.string(),
  fulfillmentIdentifier: z.enum(["Primary", "Secondary"]),
  
  // HO fields
  hoNet: z.number(),
  hoCurrency: z.string(),
  bookingCreationDate: z.string().nullable(),
  bookingStatus: z.string(),
  cancellable: z.string().nullable(),
  cancellationInsurance: z.string().nullable(),
  
  // SP fields (from bundle)
  spNetOriginal: z.number(),
  spCurrency: z.string(),
  spNetInHo: z.number(),
  fxRateUsed: z.number(),
  sameCurrency: z.boolean(),
  
  // Computed fields
  differenceLc: z.number(),
  differencePct: z.number().nullable(),
  differenceUsd: z.number(),
  
  // Reason assignment
  reason: z.string(),
  
  // Optional fields for display
  experienceName: z.string().optional(),
  supplierName: z.string().optional(),
  
  // Additional fields for discrepancy analysis
  tid: z.string().optional(),
  fulfillmentMethod: z.string().optional(),
  driTeam: z.string().optional(),
  headoutSellingPrice: z.number().optional(),
  
  // Billing entity fields
  beId: z.string().optional(),
  billingEntityName: z.string().optional(),
  
  // SP Invoice Report fields
  ticketId: z.string().optional(),
  
  // HO Report fields
  paymentBasis: z.string().optional(),
  paymentMethod: z.string().optional(),
  
  // Cancellation-related fields
  chargedLoss: z.string().optional(),
  comment: z.string().optional(),
  
  // Already Reconciled fields
  alreadyReconciledType: z.enum(["same_be", "different_be"]).optional(),
  hoReason: z.string().optional(), // Original HO reason column value
  dateOfPayment: z.string().optional(), // Date of payment for already reconciled bookings
  spDateOfPayment: z.string().optional(), // SP date of payment
  spPaymentMethod: z.string().optional(), // SP payment method for comparison
  hoBeId: z.string().optional(), // HO billing entity ID (for comparison)
  vid: z.string().optional(), // HO Vendor ID (for Vendor ID correction)
  
  // Secondary Vendor flag (cross-cutting check for all discrepancy types)
  isSecondaryVendor: z.boolean().optional(),
  spBeId: z.string().optional(), // SP billing entity ID (for comparison)
});
export type PrimaryRow = z.infer<typeof primaryRowSchema>;

// Discrepancy analysis row (grouped by TID for a specific reason)
export const discrepancyAnalysisRowSchema = z.object({
  tid: z.string(),
  currency: z.string(),
  discrepancyLc: z.number(),
  discrepancyUsd: z.number(),
  fulfillmentMethod: z.string(),
  timesCharged: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  countBidWithDiscrepancy: z.number(),
  countBidsInDuration: z.number(),
  totalBidsInReport: z.number(),
  discrepancyCoveragePercent: z.number(),
  frequency: z.enum(["Recurring", "One-Off"]),
  driTeam: z.string(),
  reason: z.string(),
  // NPD-specific fields (optional - only for Net Price Discrepancy)
  hoTakeRatePercent: z.number().optional(),
  actualTakeRatePercent: z.number().optional(),
  discrepancyPercentRange: z.string().optional(),
  pattern: z.enum(["Consistent", "Scattered"]).optional(),
  soldAtLoss: z.enum(["Yes", "No"]).optional(),
  lossLc: z.number().optional(),
  lossUsd: z.number().optional(),
});
export type DiscrepancyAnalysisRow = z.infer<typeof discrepancyAnalysisRowSchema>;

// Overall summary row (with currency column)
export const overallSummaryRowSchema = z.object({
  reason: z.string(),
  currency: z.string(),
  discrepancyLc: z.number(),
  discrepancyUsd: z.number(),
  countBid: z.number(),
});
export type OverallSummaryRow = z.infer<typeof overallSummaryRowSchema>;

// Run result structure
export const runResultSchema = z.object({
  fx: fxDataSchema,
  overallSummary: z.array(overallSummaryRowSchema),           // Primary vendor summary (BE ID match)
  secondaryVendorSummary: z.array(overallSummaryRowSchema),   // Secondary vendor summary (BE ID mismatch)
  primaryRows: z.array(primaryRowSchema),       // Primary vendor rows (BE ID match)
  secondaryVendorRows: z.array(primaryRowSchema), // Secondary vendor rows (BE ID mismatch)
  unmappedRows: z.array(primaryRowSchema),      // Unmapped bookings (in SP but not in HO)
  allRows: z.array(primaryRowSchema),           // All rows for DRI/drafts
  spFxDebugRows: z.array(spFxDebugRowSchema),
});
export type RunResult = z.infer<typeof runResultSchema>;

// Run record with status tracking
export const runRecordSchema = z.object({
  id: z.string(),
  uploadId: z.string(),
  status: runStatusSchema,
  progressStep: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

// Uploaded file info
export const uploadedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
  filePath: z.string().optional(),
  sheetNames: z.array(z.string()).optional(),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;

// Sheet data
export const sheetDataSchema = z.object({
  name: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type SheetData = z.infer<typeof sheetDataSchema>;

// Upload record with parsed sheets
export const uploadRecordSchema = z.object({
  id: z.string(),
  file: uploadedFileSchema,
  hoData: sheetDataSchema.nullable(),
  spData: sheetDataSchema.nullable(),
  createdAt: z.string(),
});
export type UploadRecord = z.infer<typeof uploadRecordSchema>;

// API request schemas
export const createRunFromUploadRequestSchema = z.object({
  uploadId: z.string(),
});
export type CreateRunFromUploadRequest = z.infer<typeof createRunFromUploadRequestSchema>;

// Column mapping (kept for backward compatibility)
export const columnMappingSchema = z.object({
  fieldName: z.string(),
  detectedColumn: z.string().nullable(),
  overrideColumn: z.string().nullable(),
  isRequired: z.boolean(),
  isMatched: z.boolean(),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

// Draft message
export const draftMessageSchema = z.object({
  id: z.string(),
  driTeam: z.string(),
  category: z.string(),
  subject: z.string(),
  body: z.string(),
  bookingCount: z.number(),
  totalDiscrepancyUsd: z.number(),
});
export type DraftMessage = z.infer<typeof draftMessageSchema>;

// DRI View filter
export const driFilterSchema = z.object({
  driTeam: z.string().nullable(),
  reason: z.string().nullable(),
  currency: z.string().nullable(),
});
export type DriFilter = z.infer<typeof driFilterSchema>;

// Progress step
export const progressStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pending", "active", "completed", "error"]),
});
export type ProgressStep = z.infer<typeof progressStepSchema>;

// Legacy types for backward compatibility
export const fxRateSchema = z.object({
  currency: z.string(),
  rateToUsd: z.number(),
  lastUpdated: z.string(),
});
export type FxRate = z.infer<typeof fxRateSchema>;

export const reconResultSchema = z.object({
  bid: z.string(),
  tid: z.string(),
  currency: z.string(),
  hoNet: z.number(),
  spNet: z.number(),
  difference: z.number(),
  differenceUsd: z.number(),
  reason: z.string(),
  driTeam: z.string(),
  isPrimary: z.boolean(),
  bookingStatus: z.string(),
  experienceName: z.string().optional(),
  supplierName: z.string().optional(),
});
export type ReconResult = z.infer<typeof reconResultSchema>;

export const summaryRowSchema = z.object({
  category: z.string(),
  count: z.number(),
  totalDiscrepancyUsd: z.number(),
  percentage: z.number(),
});
export type SummaryRow = z.infer<typeof summaryRowSchema>;

// Issue record for tracking issues from Amount Payable Calculator
export const issueRecordSchema = z.object({
  issueId: z.string(),
  runId: z.string(),
  createdDate: z.string(),
  billingEntityId: z.string(),
  billingEntityName: z.string(),
  currency: z.string(),
  discrepancyLocal: z.number(),
  discrepancyUsd: z.number(),
  reason: z.string(),
  driTeam: z.string(),
  // Optional: bookingIds associated with this issue
  bookingIds: z.array(z.string()).optional(),
});
export type IssueRecord = z.infer<typeof issueRecordSchema>;

// Dispute record for tracking disputes from Amount Payable Calculator
export const disputeStatusSchema = z.enum(["pending", "submitted", "resolved", "rejected"]);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

// Dispute closure status - separate from dispute status
export const disputeClosureStatusSchema = z.enum(["open", "closed"]);
export type DisputeClosureStatus = z.infer<typeof disputeClosureStatusSchema>;

// Dispute closure type (how the dispute was closed)
export const disputeClosureTypeSchema = z.enum(["adjustment", "manual_writeoff", "accept_ho_error", "sp_error"]);
export type DisputeClosureType = z.infer<typeof disputeClosureTypeSchema>;

export const disputeRecordSchema = z.object({
  disputeId: z.string(),
  runId: z.string(),
  bookingId: z.string(),
  billingEntityId: z.string(),
  billingEntityName: z.string(),
  ticketId: z.string().optional(),
  tid: z.string().optional(), // TID (Tour ID) - separate from ticketId
  currency: z.string(),
  disputeAmount: z.number(),
  maxDisputeAmount: z.number(),
  reconciledNet: z.number().optional(), // Original reconciled net value at dispute creation
  status: disputeStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  // Closure fields
  closureStatus: disputeClosureStatusSchema.default("open"),
  closureType: disputeClosureTypeSchema.optional(),
  closureNote: z.string().optional(),
  closedAt: z.string().optional(),
  closedByAdjustmentAmount: z.number().optional(),
});
export type DisputeRecord = z.infer<typeof disputeRecordSchema>;

// Required field names for column mapping (not used with new pipeline)
export const requiredFields = [
  "bid",
  "tid", 
  "creationDate",
  "experienceDate",
  "currency",
  "hoNet",
  "spNet",
  "bookingStatus",
] as const;

export const optionalFields = [
  "experienceName",
  "supplierName",
  "cityName",
  "spBookingRef",
  "beId",
  "vid",
  "chargedLoss",
  "errorTeam",
  "errorBucket",
  "priceSync",
  "cancellable",
  "cancellationInsurance",
  "bnpl",
  "comment",
] as const;

// Header aliases for auto-detection
export const headerAliases: Record<string, string[]> = {
  bid: ["bid", "booking_id", "bookingid", "booking id", "bookingId"],
  tid: ["tid", "tour_id", "tourid", "tour id", "experience_id", "tgid", "ticket id"],
  creationDate: ["creation_date", "creationdate", "created_at", "booking_date", "bookingCreationDate"],
  experienceDate: ["experience_date", "experiencedate", "tour_date", "travel_date", "experienceDate", "fulfilmentDate"],
  currency: ["currency", "curr", "ccy", "billing currency", "billingCurrency"],
  hoNet: ["ho_net", "honet", "ho net", "headout_net", "headoutSellingPrice", "finalNetPrice", "headout_selling_price"],
  spNet: ["sp_net", "spnet", "sp net", "supplier_net", "netPrice", "net_price", "supplierNetPrice"],
  bookingStatus: ["booking_status", "bookingstatus", "status", "bookingStatus", "fulfilmentStatus"],
  experienceName: ["experience_name", "experiencename", "tour_name", "experienceName", "tourName"],
  supplierName: ["supplier_name", "suppliername", "supplier", "vendorName", "vendor"],
  cityName: ["city_name", "cityname", "city"],
  spBookingRef: ["spBookingRefNumber", "sp_booking_ref", "supplier_ref"],
  beId: ["beId", "be_id", "billing_entity_id", "billingEntityName"],
  vid: ["vid", "vendor_id", "vendorId", "vendor id", "VID", "Vendor ID"],
  chargedLoss: ["chargedLoss", "charged_loss", "charge_loss"],
  errorTeam: ["errorTeamAttribution", "error_team", "dri_team"],
  errorBucket: ["errorBucket", "error_bucket", "reason_code"],
  priceSync: ["Price sync", "priceSync", "price_sync"],
  cancellable: ["Cancellable", "cancellable", "is_cancellable"],
  cancellationInsurance: ["Cancellation Insurance", "cancellationInsurance", "cancellation_insurance"],
  bnpl: ["BNPL", "bnpl", "buy_now_pay_later"],
  comment: ["comment", "Comment", "comments", "Comments", "notes", "Notes"],
};

// Reason codes for new pipeline
// Order reflects priority - Already Reconciled is highest priority, then Secondary Vendor
export const reasonCodes = [
  "Reconciled",
  "Already Reconciled-Same BE",
  "Already Reconciled-Different BE",
  "Secondary Vendor",
  "Net Price Discrepancy",
  "Multiple Tickets Booked",
  "Charge loss",
  "Cancellation Insurance",
  "HO policy cancellation",
  "Duplicate Fulfillment",
  "Unmapped",
  "Cancelled-SP error",
  "Cancelled-Insured Booking",
  "Cancelled-DSS policy",
  "Cancelled-Check for Charge loss",
] as const;

// Already Reconciled sub-classification type
export const alreadyReconciledTypeSchema = z.enum(["same_be", "different_be"]);
export type AlreadyReconciledType = z.infer<typeof alreadyReconciledTypeSchema>;

// Cancellation comment codes (for comment column in exports)
export const cancellationComments = [
  "Cancelled-OK",
  "Cancelled-SP error",
  "Cancelled-Insured Booking",
  "Cancelled-DSS policy",
  "Cancelled-Check for Charge loss",
] as const;

// DRI Teams
export const driTeams = [
  "Tech",
  "Supply",
  "Inventory Ops",
  "Reservation Ops",
  "Finance",
  "Selenium",
] as const;

// Placeholder for users table (keeping existing structure)
import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

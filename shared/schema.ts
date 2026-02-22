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

// Pax breakdown per booking (embedded in reconciliation data, not stored in DB)
export const paxBreakdownSchema = z.object({
  paxType: z.string(),
  count: z.number(),
  unitPrice: z.number(),
  priceNet: z.number(),
});
export type PaxBreakdown = z.infer<typeof paxBreakdownSchema>;

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
  
  // Pax type breakdown (detected from HO data columns)
  paxBreakdown: z.array(paxBreakdownSchema).optional(),
  
  // Experience date (from HO data, used for pax type date grouping)
  experienceDate: z.string().optional(),
  
  // Amount Paid & Dispute Settled (from HO data, for Amount Payable deductions)
  amountPaid: z.number().optional(),
  disputeSettled: z.number().optional(),
  // Dispute & Discrepancy fields from HO data
  disputedAmount: z.number().optional(),
  disputeAdjustedTotal: z.number().optional(),
  discrepancyAmount: z.number().optional(),
  disputeAdjustment: z.number().optional(),
  finalDiscrepancyTotal: z.number().optional(),
  disputeStatus: z.string().optional(),
  adjustedInTicketId: z.string().optional(),
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

// Error Bucket → RCA mapping (hierarchical)
export const errorBucketRcaMapping: Record<string, string[]> = {
  "Pricing": ["Price Sync Migration (RP/NP)", "Manual Error", "Secondary SP", "API Failure - Booked with Same SP"],
  "Cancellation": ["Price Sync Off", "API Failure - Not Cancelled Manually", "Fraud", "Reschedule"],
  "Unmapped_VRN": ["Manual Pricing Error", "Product Listing/Content Error", "VRN not updated - CO", "Selenium Error"],
  "Multiple_Tickets_Booked": ["SP/HO Discount", "Test Bookings", "VRN not updated - API/Selenium", "Manual Error"],
  "Currency Conversion": ["Delayed Tickets"],
  "Fraud": ["Secondary SP", "Fraud"],
  "API Failure - Booked with alternate SP": ["API Failure - Booked with alternate SP"],
  "Incorrect Setup": ["Cancellation Insurance"],
  "Incorrect API Mapping": ["Incorrect API Mapping"],
  "Partial Refund Error": ["DSS Policy"],
  "DSS Policy": ["DSS Policy"],
  "Incorrect Variant": ["Selenium Error", "Product Listing/Content Error"],
  "Incorrect Pax": ["Duplicate Bookings"],
  "BI Not Updated": ["Pending Status - Auto Refund"],
  "Incorrect Tickets": ["Refund Due"],
  "Margin Error": ["Incorrect pax/variant mapping"],
  "Product Listing/Content Error": ["Product Listing/Content Error"],
  "Two Step FF": ["Two Step FF"],
};

export const errorBuckets = Object.keys(errorBucketRcaMapping);

// Issue status options
export const issueStatuses = [
  "Issue resolved - Loss",
  "Issue resolved - No loss",
  "Pending - Finance",
  "Pending - SP",
  "Pending - BDM",
  "Pending - IO",
  "Pending - CO",
  "Pending - RO",
  "Pending - Tech",
  "Pending - BizOps",
  "Pending - Other",
] as const;

export type IssueStatus = typeof issueStatuses[number];

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
  bookingIds: z.array(z.string()).optional(),
  paymentMethod: z.string().optional(),
  period: z.string().optional(),
  assignee: z.string().optional(),
  errorBucket: z.string().optional(),
  rca: z.string().optional(),
  slackLink: z.string().optional(),
  workingsLink: z.string().optional(),
  issueStatus: z.string().optional(),
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
  adjustedInTicketId: z.string().optional(), // Ticket ID where adjustment is credited (for cross-ticket adjustments)
});
export type DisputeRecord = z.infer<typeof disputeRecordSchema>;

// Vendor ID Correction - for payment method mismatch and secondary vendor bookings
export const vendorCorrectionSchema = z.object({
  runId: z.string(),
  bookingId: z.string(),
  finalVendorId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type VendorCorrection = z.infer<typeof vendorCorrectionSchema>;

// Vendor Balance - for Purchase Reconciliation (PORTAL_DEPOSIT payment method)
export const vendorBalanceSchema = z.object({
  beId: z.string(), // Billing Entity ID - primary identifier
  openingBalance: z.number(),
  reloads: z.number(),
  closingBalance: z.number(),
  currency: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VendorBalance = z.infer<typeof vendorBalanceSchema>;

export const insertVendorBalanceSchema = vendorBalanceSchema.omit({ createdAt: true, updatedAt: true });
export type InsertVendorBalance = z.infer<typeof insertVendorBalanceSchema>;

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

// Database tables for persistent storage
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, timestamp, jsonb, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Users table (keeping existing structure)
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

// Reconciliation sessions - main storage for each reconciliation workflow
export const reconciliationSessions = pgTable("reconciliation_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // User-friendly session name
  status: text("status").notNull().default("idle"), // idle, processing, done, error
  progressStep: text("progress_step"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
  // File info
  hoFileName: text("ho_file_name"),
  spFileName: text("sp_file_name"),
  hoFileSize: integer("ho_file_size"),
  spFileSize: integer("sp_file_size"),
  // Parsed data (stored as JSON)
  hoData: jsonb("ho_data"), // SheetData
  spData: jsonb("sp_data"), // SheetData
  // Run result (stored as JSON for simplicity)
  runResult: jsonb("run_result"), // RunResult - full reconciliation results
});

export const insertReconciliationSessionSchema = createInsertSchema(reconciliationSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertReconciliationSession = z.infer<typeof insertReconciliationSessionSchema>;
export type ReconciliationSession = typeof reconciliationSessions.$inferSelect;

// Disputes table - persistent dispute tracking
export const disputes = pgTable("disputes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  disputeId: text("dispute_id").notNull().unique(), // Human-readable ID like DID-#1
  sessionId: varchar("session_id").notNull(), // Reference to reconciliation session
  bookingId: text("booking_id").notNull(),
  billingEntityId: text("billing_entity_id").notNull(),
  billingEntityName: text("billing_entity_name").notNull(),
  ticketId: text("ticket_id"),
  tid: text("tid"),
  currency: text("currency").notNull(),
  disputeAmount: real("dispute_amount").notNull(),
  maxDisputeAmount: real("max_dispute_amount").notNull(),
  reconciledNet: real("reconciled_net"),
  status: text("status").notNull().default("pending"), // pending, submitted, resolved, rejected
  closureStatus: text("closure_status").notNull().default("open"), // open, closed
  closureType: text("closure_type"), // adjustment, manual_writeoff, accept_ho_error, sp_error
  closureNote: text("closure_note"),
  closedAt: timestamp("closed_at"),
  closedByAdjustmentAmount: real("closed_by_adjustment_amount"),
  adjustedInTicketId: text("adjusted_in_ticket_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const insertDisputeSchema = createInsertSchema(disputes).omit({
  id: true,
  createdAt: true,
});

export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputes.$inferSelect;

// Issues table - persistent issue tracking
export const issues = pgTable("issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  issueId: text("issue_id").notNull().unique(),
  sessionId: varchar("session_id").notNull(),
  billingEntityId: text("billing_entity_id").notNull(),
  billingEntityName: text("billing_entity_name").notNull(),
  currency: text("currency").notNull(),
  discrepancyLocal: real("discrepancy_local").notNull(),
  discrepancyUsd: real("discrepancy_usd").notNull(),
  reason: text("reason").notNull(),
  driTeam: text("dri_team").notNull(),
  bookingIds: jsonb("booking_ids"),
  paymentMethod: text("payment_method"),
  period: text("period"),
  assignee: text("assignee"),
  errorBucket: text("error_bucket"),
  rca: text("rca"),
  slackLink: text("slack_link"),
  workingsLink: text("workings_link"),
  issueStatus: text("issue_status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const insertIssueSchema = createInsertSchema(issues).omit({
  id: true,
  createdAt: true,
});

export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Issue = typeof issues.$inferSelect;

// Vendor corrections table - persistent vendor ID corrections
export const vendorCorrections = pgTable("vendor_corrections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(), // Reference to reconciliation session
  bookingId: text("booking_id").notNull(),
  finalVendorId: text("final_vendor_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const insertVendorCorrectionSchema = createInsertSchema(vendorCorrections).omit({
  id: true,
  createdAt: true,
});

export type InsertVendorCorrection = z.infer<typeof insertVendorCorrectionSchema>;
export type DbVendorCorrection = typeof vendorCorrections.$inferSelect;

// Dispute counter for generating sequential IDs
export const counters = pgTable("counters", {
  id: varchar("id").primaryKey(), // counter name like "dispute" or "issue"
  value: integer("value").notNull().default(0),
});

// Vendor Balances for Purchase Reconciliation (PORTAL_DEPOSIT)
export const vendorBalances = pgTable("vendor_balances", {
  beId: varchar("be_id").primaryKey(), // Billing Entity ID is the primary key
  openingBalance: real("opening_balance").notNull().default(0),
  reloads: real("reloads").notNull().default(0),
  closingBalance: real("closing_balance").notNull().default(0),
  currency: varchar("currency").notNull().default("INR"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DbVendorBalance = typeof vendorBalances.$inferSelect;

// Pax Types for booking price breakdown
export const paxTypes = pgTable("pax_types", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DbPaxType = typeof paxTypes.$inferSelect;

export const paxTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
});
export type PaxType = z.infer<typeof paxTypeSchema>;

export const insertPaxTypeSchema = z.object({
  name: z.string().min(1),
});
export type InsertPaxType = z.infer<typeof insertPaxTypeSchema>;

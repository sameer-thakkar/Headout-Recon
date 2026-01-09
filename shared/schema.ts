import { z } from "zod";

// Run status enum
export const runStatusSchema = z.enum(["idle", "processing", "done", "error"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

// Booking record from uploaded files
export const bookingRecordSchema = z.object({
  bid: z.string(),
  tid: z.string(),
  creationDate: z.string(),
  experienceDate: z.string(),
  currency: z.string(),
  hoNet: z.number(),
  spNet: z.number(),
  bookingStatus: z.string(),
  experienceName: z.string().optional(),
  supplierName: z.string().optional(),
  cityName: z.string().optional(),
});
export type BookingRecord = z.infer<typeof bookingRecordSchema>;

// Column mapping
export const columnMappingSchema = z.object({
  fieldName: z.string(),
  detectedColumn: z.string().nullable(),
  overrideColumn: z.string().nullable(),
  isRequired: z.boolean(),
  isMatched: z.boolean(),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

// FX Rate
export const fxRateSchema = z.object({
  currency: z.string(),
  rateToUsd: z.number(),
  lastUpdated: z.string(),
});
export type FxRate = z.infer<typeof fxRateSchema>;

// Reconciliation result per booking
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

// Summary row
export const summaryRowSchema = z.object({
  category: z.string(),
  count: z.number(),
  totalDiscrepancyUsd: z.number(),
  percentage: z.number(),
});
export type SummaryRow = z.infer<typeof summaryRowSchema>;

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
  tid: z.string().nullable(),
});
export type DriFilter = z.infer<typeof driFilterSchema>;

// Uploaded file info
export const uploadedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
  rowCount: z.number().optional(),
  headers: z.array(z.string()).optional(),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;

// Run record
export const runRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: runStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  fileCount: z.number(),
  totalBookings: z.number(),
  totalDiscrepancyUsd: z.number().nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

// Full run data
export const runDataSchema = z.object({
  run: runRecordSchema,
  files: z.array(uploadedFileSchema),
  mappings: z.array(columnMappingSchema),
  fxRates: z.array(fxRateSchema),
  results: z.array(reconResultSchema),
  overallSummary: z.array(summaryRowSchema),
  mtbSummary: z.array(summaryRowSchema),
  npdSummary: z.array(summaryRowSchema),
  chargeLossSummary: z.array(summaryRowSchema),
  draftMessages: z.array(draftMessageSchema),
});
export type RunData = z.infer<typeof runDataSchema>;

// API request/response schemas
export const uploadFilesResponseSchema = z.object({
  files: z.array(uploadedFileSchema),
  headers: z.array(z.string()),
});
export type UploadFilesResponse = z.infer<typeof uploadFilesResponseSchema>;

export const saveMappingRequestSchema = z.object({
  runId: z.string(),
  mappings: z.array(columnMappingSchema),
});
export type SaveMappingRequest = z.infer<typeof saveMappingRequestSchema>;

export const runReconRequestSchema = z.object({
  runId: z.string(),
});
export type RunReconRequest = z.infer<typeof runReconRequestSchema>;

// Progress step
export const progressStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pending", "active", "completed", "error"]),
});
export type ProgressStep = z.infer<typeof progressStepSchema>;

// Required field names for column mapping
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
  "chargedLoss",
  "errorTeam",
  "errorBucket",
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
  chargedLoss: ["chargedLoss", "charged_loss", "charge_loss"],
  errorTeam: ["errorTeamAttribution", "error_team", "dri_team"],
  errorBucket: ["errorBucket", "error_bucket", "reason_code"],
};

// DRI Teams
export const driTeams = [
  "Tech",
  "Supply",
  "Inventory Ops",
  "Reservation Ops",
  "Finance",
  "Selenium",
] as const;

// Reason codes
export const reasonCodes = [
  "MTB - Missing in Supplier",
  "MTB - Duplicate Booking",
  "NPD - Price Mismatch",
  "NPD - Currency Mismatch",
  "Charge Loss - API Error",
  "Charge Loss - Non-API",
  "Status Mismatch",
  "Unknown",
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

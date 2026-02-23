# Headout Recon Automation

## Overview

Headout Recon Automation is an enterprise productivity web application designed to streamline booking reconciliation workflows. It automates discrepancy detection between internal booking data and supplier invoices, performs FX currency conversion, categorizes issues by reason codes, and generates draft messages for DRI teams. The application supports a multi-step workflow from file upload to report export, aiming to enhance efficiency and accuracy in financial reconciliation. It also includes features for managing secondary vendors, already reconciled bookings, cancellations, payment method mismatches, and comprehensive purchase reconciliation with vendor balance and pax type management.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: React useState/useCallback for UI state; TanStack React Query for server state
- **UI Component Library**: shadcn/ui (Radix primitives + Tailwind CSS)
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode)
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful JSON API
- **File Handling**: Multer for file uploads (xlsx, csv)
- **Data Processing**: xlsx library for spreadsheet parsing

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Validation**: Zod schemas
- **Storage**: In-memory storage with an interface for future database migration

### Project Structure
- `client/src/`: React frontend
- `server/`: Express backend
- `shared/`: Shared code including schemas, types, and constants

### Key Design Decisions
- **Monorepo with shared types**: Ensures type safety across client and server.
- **In-memory storage with abstraction**: Allows flexible database integration.
- **Multi-step workflow state**: Global state managed explicitly via props for traceability.
- **Demo data support**: Provides an immediate exploration of features.
- **UI/UX**: Material Design 3 principles, Inter font for UI, JetBrains Mono for data, CSS custom properties for theming.
- **Export Formatting**: Indian number format, DD/MM/YYYY date format, specific sorting, table styling, and auto column widths for Excel and Google Sheets. Export is split into two separate files: Discrepancy Analysis (Discrepancy Analysis, Draft Messages, DRI sheets) and Reconciliation Report (Payable Summary, SP Invoice, HO Report Updated). Both Excel and Google Sheets support this split via `/api/runs/:runId/export/analysis`, `/api/runs/:runId/export/financial`, `/api/runs/:runId/export-gsheet/analysis`, `/api/runs/:runId/export-gsheet/financial`. Export logic lives in `server/export-routes.ts` with shared utilities in `server/export-utils.ts`. The Reconciliation Report export is gated behind the "Apply & confirm" action in the Amount Payable panel. The upload page summary only offers Discrepancy Analysis export.
- **Reason Priority Order**: Defined hierarchy for discrepancy assignment (e.g., Already Reconciled, Negative SP, Cancellations, MTB, NPD).
- **Negative SP Net Handling**: Bookings with negative SP Net are handled in two cases: (1) CANCELLED + HO Net = 0 → auto-reconciled as "Cancelled-Refund OK" with Final Net Price = 0, (2) all other negatives → "Negative SP - Partial Refund" discrepancy reason. UI shows red-tinted rows with "Refund" badge and bold red SP Net values. In Purchase Reconciliation, negative values are called out as refunds in the Balance & Deposits section.
- **Secondary Vendor**: Segregated detection, reason prefixing, separate UI display, and distinct reporting.
- **Already Reconciled Feature**: Highest priority detection, sub-classification, DRI team assignment, UI display with modals, and integration into amount payable adjustments.
- **Cancellations Consolidation**: Grouping of various cancellation types for summarized display, specific discrepancy calculation, and hierarchical modal breakdown.
- **Amount Paid & Dispute Settled**: Two HO data columns parsed during upload. "Amount Paid" is deducted per-booking from the price payable in the Amount Payable section. "Dispute Settled" is informational only. Dispute amounts are tracked and displayed but NOT deducted from price payable. Both shown as visible columns in the Amount Payable booking grids (Discrepancy, Cancellations, Secondary Vendor sections). Total Amount Paid displayed in the summary.
- **Payment Method Mismatch**: Detection of differing payment methods, violet-styled UI section, TID-level grouping, and editable "Final Vendor ID" for manual corrections.
- **Purchase Reconciliation (PORTAL_DEPOSIT)**: Replaces standard Amount Payable panel with a 12-line item reconciliation, including opening/closing balances, reloads, refunds, and computed/actual purchases. Features USD conversion, validation, collapsible reason/TID groups, editable "Final Net Price" with warnings, and TID-level bulk updates (SP Net, HO Net, Pax Type). Includes dispute and issue tracking per booking/TID. Row 10/11 UX optimizations: auto-expand for single-TID reasons and TIDs with ≤3 bookings (with user-collapsible override via `userCollapsed` state), reason-level priority bars showing percentage of grand total discrepancy, prominent TID action strip (bg-primary tint, default-variant buttons), search/filter within breakups (by Booking ID, TID, or reason), and lazy loading showing top 5 reasons with "Show all" button.
- **Vendor Balance Upload**: Dedicated section on the home page for uploading and managing vendor balances via Excel/CSV, with preview and bulk save functionality.
- **Pax Type Management**: Database storage and UI for managing pax type names. Detection of pax-related columns in HO data, per-booking display, and TID-level bulk price updates based on pax types. Date-based grouping of pax unit prices: uses paymentBasis (DATE_OF_EXPERIENCE or DATE_OF_BOOKING) to determine grouping field, computes per-date SP/HO unit prices, collapses contiguous same-price dates into date ranges, and allows per-row Final Price input with direct date-to-rowKey mapping for precise price assignment.

## External Dependencies

### Database
- PostgreSQL (via `DATABASE_URL`)
- Drizzle Kit (for schema migrations)

### Key NPM Packages
- `express`: HTTP server
- `drizzle-orm`, `drizzle-zod`: ORM and schema validation
- `xlsx`: Excel/CSV parsing
- `@tanstack/react-query`: Server state management
- `wouter`: Client-side routing
- `zod`: Runtime type validation
- `shadcn/ui`: UI components

### Environment Variables
- `DATABASE_URL`
- `NODE_ENV`

### API Endpoints
- `/api/vendor-balances`: CRUD operations for vendor balances.
- `/api/pax-types`: CRUD operations for pax types.
- `/api/disputes`: POST and DELETE for managing disputes.
- `/api/issues`: POST for creating issues, GET `/api/issues/:runId` for listing, PATCH `/api/issues/:issueId` for inline editing, DELETE `/api/issues/:issueId` for removal. Issue Tracker is built at DRI-Discrepancy level with columns: Date, Payment Method, Period, Assignee, BE ID/Name, Currency, Discrepancy LC/USD, DRI Team (auto-detected with manual override), Error Bucket (dropdown populated from reconciliation `reasonCodes` + "Other"), RCA (dependent dropdown filtered by Error Bucket via `errorBucketRcaMapping` in shared/schema.ts), Slack Link, Workings Link (auto-generated Google Sheet with "Draft Message" and "DRI Discrepancy" tabs), and Issue Status dropdown. Error Bucket auto-populates with the discrepancy reason when issues are created. Workings Link is auto-generated via `generateIssueWorkingsSheet` in `server/export-routes.ts` which creates a Google Sheet filtered to the issue's booking IDs and reason, running asynchronously after issue creation. All editable fields support inline editing via PATCH endpoint with server-side validation for Error Bucket/RCA pairing.
- `/api/runs/:runId/validate-financial`: GET - Pre-export validation that runs 12 data integrity checks before allowing financial report export. Returns checks array and summary with pass/fail/warning statuses. Checks include: booking count integrity, price completeness, zero/negative price detection, payment mismatch resolution, FX rate validation, manual edits summary, open disputes, grand total variance, amount paid reconciliation, vendor corrections, and data source verification. The `ValidationModal` component in `client/src/components/validation-modal.tsx` displays these checks with animated progress and requires warning acknowledgment before proceeding to export.
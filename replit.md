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
- **Authentication**: Email/password auth with `crypto.scrypt` + 16-byte salt hashing, `timingSafeEqual` for comparison. Registration restricted to `@headout.com` domain. Sessions stored in PostgreSQL via `connect-pg-simple`, 7-day expiry. Two roles: `researcher` (default) and `admin`. Admin dashboard at `/admin` for user management and password resets.
- **Auth endpoints**: `POST /api/register`, `POST /api/auth/login` (email-based), `POST /api/auth/logout`, `GET /api/auth/status`, `GET /api/auth/user`, `POST /api/auth/change-password`. Admin: `GET /api/admin/users`, `PUT /api/admin/users/:id`, `GET /api/admin/stats`, `GET /api/admin/password-resets`, `POST /api/admin/password-resets/:userId`.
- **Multi-step workflow state**: Global state managed explicitly via props for traceability.
- **Demo data support**: Provides an immediate exploration of features.
- **UI/UX**: Material Design 3 principles, Inter font for UI, JetBrains Mono for data, CSS custom properties for theming.
- **Export Formatting**: Indian number format, DD/MM/YYYY date format, specific sorting, table styling, and auto column widths for Excel and Google Sheets. Export is split into two separate files: Discrepancy Analysis (Discrepancy Analysis, Draft Messages, DRI sheets) and Reconciliation Report (Payable Summary, SP Invoice, HO Report Updated). Both Excel and Google Sheets support this split via `/api/runs/:runId/export/analysis`, `/api/runs/:runId/export/financial`, `/api/runs/:runId/export-gsheet/analysis`, `/api/runs/:runId/export-gsheet/financial`. Export logic lives in `server/export-routes.ts` with shared utilities in `server/export-utils.ts`. The Reconciliation Report export is gated behind the "Apply & confirm" action in the Amount Payable panel. The upload page summary only offers Discrepancy Analysis export.
- **Reason Priority Order**: Defined hierarchy for discrepancy assignment (e.g., Already Reconciled, Negative SP, Cancellations, MTB, NPD).
- **Negative SP Net Handling**: Bookings with negative SP Net are handled in two cases: (1) CANCELLED + HO Net = 0 → auto-reconciled as "Cancelled-Refund OK" with Total Amount Payable = 0, (2) all other negatives → "Negative SP - Partial Refund" discrepancy reason. UI shows red-tinted rows with "Refund" badge and bold red SP Net values. In Purchase Reconciliation, negative values are called out as refunds in the Balance & Deposits section. Auto-TAP computation for negative SP bookings: (a) HO=0 → TAP=0, (b) |SP|=|HO| → TAP=0, (c) otherwise → TAP=||HO|-|SP||. Sub-classification badges (Zero HO / Matched / Difference) shown per booking. Summary card in reason group shows counts per sub-type + totals. Verification checkbox required before Apply & Confirm; warning banner shown when unverified. Difference for negative SP bookings is computed as |SP Net| - |HO Net| (absolute values). Reconciliation Status (from HO data "status" column, parsed as `reconciliationStatus` — separate from `bookingStatus` which maps to "Booking Status") is displayed as a violet badge on each negative SP booking row, with status counts shown in the summary card.
- **Secondary Vendor**: Segregated detection, reason prefixing, separate UI display, and distinct reporting.
- **Already Reconciled Feature**: Highest priority detection, sub-classification, DRI team assignment, UI display with modals, and integration into amount payable adjustments.
- **Cancellations Consolidation**: Grouping of various cancellation types for summarized display, specific discrepancy calculation, and hierarchical modal breakdown. The Take Action panel now uses the NPD-style TID Breakdown format: expandable TID rows with BID-level detail (Booking ID, Ticket ID, SP Net, HO Net, Diff LC, Selection SP/HO, Dispute, TAP, Amount Paid, Dispute Amt, Balance Amt Payable, Save), per-TID action strip (Set SP Net, Set HO Net, Pax Pricing, Dispute, Issue), and Pax Pricing modal. Price overrides, disputes, and issues are persisted via the same API mutations as NPD. The `runId` prop is passed from upload.tsx to enable backend mutations.
- **Amount Paid & Dispute Settled**: Two HO data columns parsed during upload. "Amount Paid" is deducted per-booking from the price payable in the Amount Payable section. "Dispute Settled" is informational only. Dispute amounts are tracked and displayed but NOT deducted from price payable. Both shown as visible columns in the Amount Payable booking grids (Discrepancy, Cancellations, Secondary Vendor sections). Total Amount Paid displayed in the summary.
- **Vendor ID Management (formerly Payment Method Mismatch)**: No dedicated PMM section. Instead, Secondary Vendor sections in both Amount Payable and Purchase Reconciliation panels have a mandatory bulk "Final Vendor ID" input that applies to all secondary vendor bookings. Per-booking inline Vendor ID inputs (violet-styled) appear in Discrepancy, Already Reconciled, and Cancellations rows for any booking whose HO/SP payment methods differ. Apply & Confirm is blocked until all vendor IDs are set. Amber warning banner displayed when incomplete. Validation CHECK 5 updated to cover both secondary vendor and payment mismatch bookings.
- **Purchase Reconciliation (PORTAL_DEPOSIT)**: Replaces standard Amount Payable panel with a 12-line item reconciliation, including opening/closing balances, reloads, refunds, and computed/actual purchases. Features USD conversion, validation, collapsible reason/TID groups, editable "Total Amount Payable" with warnings, and TID-level bulk updates (SP Net, HO Net, Pax Type). Includes dispute and issue tracking per booking/TID. Row 10/11 UX optimizations: auto-expand for single-TID reasons and TIDs with ≤3 bookings (with user-collapsible override via `userCollapsed` state), reason-level priority bars showing percentage of grand total discrepancy, prominent TID action strip (bg-primary tint, default-variant buttons), search/filter within breakups (by Booking ID, TID, or reason), and lazy loading showing top 5 reasons with "Show all" button.
- **Vendor Balance Upload**: Dedicated section on the home page for uploading and managing vendor balances via Excel/CSV, with preview and bulk save functionality.
- **Portal Reloads Upload**: Separate file upload section on the home page for reload data. Parses "Finance Zendesk Tickets Portal Partner ID", "Finance Zendesk Tickets Paid Amount", "Finance Zendesk Tickets Currency", Zendesk ID, Date of Payment, and Amount Loaded at Date columns. Currency is stored per transaction row and displayed in the Manage Reloads modal per reload entry. Sums paid amounts per BE ID, and uses the total as the Reloads value in Purchase Reconciliation (overriding the vendor balance reloads when portal reload data exists). API: `/api/portal-reloads`, `/api/portal-reloads/:beId`, `/api/portal-reloads/upload`, `/api/portal-reloads/save`. DB table: `portal_reloads` (columns: id, be_id, paid_amount, zendesk_id, date_of_payment, amount_loaded_at_date, currency, created_at).
- **Reload Adjustments**: Manual add/subtract entries to correct the portal reloads total. Users can view reload breakup (Zendesk ID, Date of Payment, Amount Loaded at Date, Paid Amount) and add adjustments via the "Manage" button on the Reloads line item in Purchase Reconciliation. `adjustedTotal = original total + sum(add adjustments) - sum(less adjustments)`. API: `GET/POST /api/reload-adjustments`, `DELETE /api/reload-adjustments/:id`. DB table: `reload_adjustments`. The `/api/portal-reloads/:beId` endpoint returns `{ total, reloads, adjustments, adjustedTotal }`.
- **Pax Type Management**: Database storage and UI for managing pax type names. Detection of pax-related columns in HO data, per-booking display, and TID-level bulk price updates based on pax types. Date-based grouping of pax unit prices: uses paymentBasis (DATE_OF_EXPERIENCE or DATE_OF_BOOKING) to determine grouping field, computes per-date SP/HO unit prices, collapses contiguous same-price dates into date ranges, and allows per-row Final Price input with direct date-to-rowKey mapping for precise price assignment.
- **Authentication**: Token-based auth using a `users` DB table (id UUID, username, password bcrypt-hashed, role admin/user, created_at). Login via `POST /api/auth/login` with username+password returns a UUID token stored server-side in a `Map<token, userId>`. Token passed as `Authorization: Bearer <token>` header. All `/api/*` routes except `/api/auth/*` require a valid token. On startup, `seedInitialAdmin()` creates an `admin` user (password: APP_PASSWORD env var if set, else `Headout@2025`) when no users exist. Admin users can manage all users via `/api/users` endpoints (list, create, delete, reset password, change role). Any user can change their own password via `POST /api/auth/change-password`. SafeUser type (Omit<User, "password">) used in all responses. Dialog nesting rule: render `<ChangePasswordDialog>` and `<UserManagement>` as siblings outside DropdownMenu using external open state. In controlled mode (open prop provided), the DialogTrigger inside both components is suppressed.
- **Run Naming & Recon Tracker**: Sessions can be named (via TopBar bookmark button or initial upload). Recon Tracker page shows only saved/named sessions. Runs table has `name` and `isSaved` columns.

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
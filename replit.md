# Headout Recon Automation

## Overview

Headout Recon Automation is an enterprise productivity web application designed to streamline booking reconciliation workflows. The tool automates discrepancy detection between internal booking data (HO Net) and supplier invoices (SP Net), performs FX currency conversion, categorizes issues by reason codes, and generates ready-to-send draft messages for DRI (Directly Responsible Individual) teams.

The application follows a multi-step workflow: Upload files → Map columns → Run reconciliation → View results → Export reports.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: React useState/useCallback with props drilling; TanStack React Query for server state
- **UI Component Library**: shadcn/ui (Radix primitives + Tailwind CSS)
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful JSON API under `/api/*` routes
- **File Handling**: Multer for file uploads (xlsx, csv)
- **Data Processing**: xlsx library for spreadsheet parsing

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Validation**: Zod schemas with drizzle-zod integration
- **Storage**: In-memory storage implementation with interface for future database migration

### Project Structure
```
client/src/          # React frontend
  pages/             # Route components (landing, upload, mapping, run, results, drafts, dri, export)
  components/        # Reusable UI components
  components/ui/     # shadcn/ui primitives
  hooks/             # Custom React hooks
  lib/               # Utilities and query client

server/              # Express backend
  index.ts           # Server entry point
  routes.ts          # API route definitions
  storage.ts         # Data storage interface and implementation
  static.ts          # Static file serving for production
  vite.ts            # Vite dev server integration

shared/              # Shared code between client and server
  schema.ts          # Zod schemas, types, and constants
```

### Key Design Decisions

1. **Monorepo with shared types**: TypeScript schemas in `shared/` ensure type safety across client-server boundary without code duplication.

2. **In-memory storage with abstraction**: The `IStorage` interface in `storage.ts` allows swapping implementations (current in-memory → future PostgreSQL) without changing business logic.

3. **Multi-step workflow state**: Global state managed in `App.tsx` and passed down via props rather than context, keeping data flow explicit and traceable.

4. **Demo data support**: Built-in demo dataset allows users to explore the application without uploading real files.

## External Dependencies

### Database
- **PostgreSQL**: Configured via `DATABASE_URL` environment variable
- **Drizzle Kit**: For schema migrations (`npm run db:push`)

### Key NPM Packages
- `express` - HTTP server framework
- `drizzle-orm` / `drizzle-zod` - Database ORM and schema validation
- `xlsx` - Excel/CSV file parsing
- `@tanstack/react-query` - Server state management
- `wouter` - Client-side routing
- `zod` - Runtime type validation
- Full shadcn/ui component set (Radix primitives)

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string
- `NODE_ENV` - development/production mode

### Design System
- Material Design 3 principles adapted for enterprise data tools
- Inter font for UI, JetBrains Mono for numeric/code data
- CSS custom properties for consistent theming

### Export Formatting (Excel and Google Sheets)
- **Indian Number Format**: Currency values use Indian notation (1,00,000.00) with lakhs/crores grouping
- **Date Format**: All dates formatted as DD/MM/YYYY using UTC to avoid timezone issues
- **Sorting**: Tables sorted by Discrepancy USD (negative highest to positive lowest)
- **Tables**: Borders applied to all data tables, gridlines removed from sheets with tables
- **Auto Column Width**: Applied to Discrepancy Analysis tab for optimal viewing
- **SP Invoice Report**: Includes all original columns plus FX conversion data (SP Net in HO Currency, FX Rate Used)
- **Helper Functions**: `formatIndianNumber()` and `formatDateValue()` in `server/routes.ts` handle formatting

### Reason Priority Order (in assignReason function)
1. Already Reconciled - check HO reason column
2. Cancellations - cancelled booking handling
3. MTB (Multiple Tickets Booked) - large percentage difference
4. NPD (Net Price Discrepancy) - amounts don't reconcile
5. Reconciled - amounts match

### Secondary Vendor (Segregated Section)
- **Detection**: HO BE ID ≠ SP BE ID (normalized comparison)
- **Reason Prefix**: When BE IDs don't match, reason is prefixed with "Secondary Vendor-" (e.g., "Secondary Vendor-NPD", "Secondary Vendor-MTB")
- **Complete Separation**: Secondary Vendor bookings are shown in their own dedicated section, not mixed with Primary Vendor bookings
- **Own Reason Breakdown**: Secondary Vendor section has its own reasons: Secondary Vendor-Reconciled, Secondary Vendor-NPD, Secondary Vendor-MTB, Secondary Vendor-Cancelled-*, etc.
- **UI Display**: 
  - Amber-styled section below Primary Vendor summary table
  - Shows reason breakdown with discrepancy totals (reason prefix stripped for display)
  - Separate table in Amount Payable panel
- **Exports**: Secondary Vendor-Reconciled excluded from discrepancy reports (same as Reconciled)

### Already Reconciled Feature
- **Detection**: Bookings where HO data "reason" column contains "Already Auto Reconciled" or "Already Manually Reconciled" (case-insensitive)
- **Priority**: HIGHEST priority - checked first before all other reason types in `assignReason()`
- **Sub-classification**:
  - "Already Reconciled-Same BE": HO BE ID matches SP BE ID (normalized comparison)
  - "Already Reconciled-Different BE": BE IDs don't match
- **DRI Team Assignment**: Finance team
- **UI Display**: Collapsible summary row in results → Modal with classification breakdown → Second modal with booking details
- **Amount Payable Integration**: 
  - Dedicated section for Already Reconciled bookings
  - Per-booking decisions: Cancellation, Multiple Tickets, Partial Fulfillment, Manual Error, Other
  - Remarks field and Add/Less amount adjustment
  - Decisions converted to Adjustment entries and included in Apply payload for export/storage
- **Export**: Already Reconciled bookings included in Discrepancy Analysis (filter excludes only exact "Reconciled")

### Cancellations Consolidation Feature
- **Detection**: Bookings with reasons: Cancelled-SP error, Cancelled-Insured Booking, Cancelled-Check for Charge loss, Cancelled-DSS policy
- **Summary Display**: All cancellation types grouped under single "Cancellations" row in summary table
- **Discrepancy Calculation**: Uses only SP Net (always negative) - calculated as -Math.abs(spNetInHo)
- **UI Display**: 
  - Red-styled row (bg-red-50) with XCircle icon
  - Shows aggregated count and discrepancy totals
  - Click opens breakdown modal with cards for each cancellation type
  - Click on type card opens regular discrepancy modal with booking details
- **Modal Hierarchy**: Summary row → Breakdown modal → Discrepancy detail modal

### Payment Method Mismatch Feature
- **Detection**: Bookings where `paymentMethod` (HO) differs from `spPaymentMethod` (SP) - case-insensitive comparison
- **Purpose**: Identifies bookings that need vendor ID corrections in the external system
- **UI Display**:
  - Violet-styled collapsible section in Amount Payable panel (after Secondary Vendor section)
  - Shows booking count badge
  - TID-level grouping with expandable rows
- **Per-Booking Data**:
  - Booking ID
  - HO Vendor ID (hoBeId) - read-only reference
  - Final Vendor ID - editable input field
- **Bulk Update**: Single input field + button to apply the same Vendor ID to all payment mismatch bookings
- **Data Persistence**: Final Vendor IDs are ephemeral (UI-only) - intended as reference for manual corrections in external system

### Purchase Reconciliation (PORTAL_DEPOSIT)
- **Trigger**: When dominant payment method = "PORTAL_DEPOSIT" (case-insensitive)
- **Replaces**: Amount Payable panel is replaced with Purchase Reconciliation panel
- **12 Line Items**:
  1. Opening Balance - Fetched from database (BE ID level)
  2. Reloads - Fetched from database (BE ID level)
  3. Refunds - Sum of SP Invoice negative values
  4. Closing Balance - Fetched from database (BE ID level)
  5. Computed Purchase = 1 + 2 + 3 - 4
  6. Actual Purchase = Total from SP Invoice data
  7. Timing Difference in Closing Balance = 5 - 6
  8. Purchases as per HO = Total of primary fulfillments (HO Net)
  9. Difference = 8 - 6 (highlighted)
  10. In SP data not in HO = Sum where SP Net > HO Net (collapsible reason groups)
  11. In HO data not in SP = Sum where HO Net > SP Net (collapsible reason groups)
  12. Net Difference = 9 + 10 - 11 (validation row, should equal 0)
- **Component**: `client/src/components/purchase-reconciliation-panel.tsx`
- **UI**: Read-only table with line item numbers, calculated amounts, and notes
- **Validation**: Line 12 serves as cross-check - if balanced, shows green; if unbalanced, shows red
- **Collapsible Reason Groups (Rows 10 & 11)**:
  - Reason sub-headers in rows 10 and 11 are collapsible with chevron indicators
  - Click reason header to expand/collapse booking details
  - State tracked via `expandedReasons` Set using format `${rowId}-${reasonName}`
- **Dispute & Issue Tracking**:
  - Actions column in booking detail tables with "Dispute" and "Issue" buttons
  - Raise Dispute modal: Opens with booking details, allows setting dispute amount
  - Flag Issue modal: Creates issue entry for the booking
  - Active disputes shown with "Remove" option instead of "Dispute" button
  - State resets automatically when runId changes
  - API integrations: POST /api/disputes, POST /api/issues, DELETE /api/disputes/:bookingId
- **Database**: `vendor_balances` table stores Opening Balance, Reloads, Closing Balance per BE ID
- **API Endpoints**:
  - `GET /api/vendor-balances` - List all vendor balances
  - `GET /api/vendor-balances/:beId` - Get balance for specific BE ID
  - `POST /api/vendor-balances` - Create/update balance (upsert by BE ID)
  - `DELETE /api/vendor-balances/:beId` - Delete balance

### Vendor Balance Upload (Home Page)
- **Location**: Home/landing page section below "How It Works"
- **Component**: `client/src/components/vendor-balances-section.tsx`
- **File Upload**: Accepts Excel/CSV with columns: BE ID, Opening Balance, Reloads, Closing Balance, Currency
- **Preview Table**: Shows parsed data with validation status before saving
- **Bulk Save**: Saves all valid balances to database at once
- **Saved Balances Table**: Shows all stored balances with delete capability
- **Purpose**: Upload balances upfront so reconciliation uses read-only data (prevents manipulation)
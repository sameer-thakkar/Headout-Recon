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

### Secondary Vendor (Cross-Cutting Flag)
- **Type**: Boolean flag (`isSecondaryVendor`) set independently of primary reason
- **Detection**: HO BE ID ≠ SP BE ID (normalized comparison)
- **Logic**: Checked for ALL bookings regardless of their primary reason; a booking can be "MTB + Secondary Vendor" or "Cancellation + Secondary Vendor"
- **UI Display**: 
  - Amber-styled sub-section after main reconciliation summary table
  - Groups Secondary Vendor bookings by their primary reason with count and discrepancy totals
  - Also shown in Amount Payable panel with same grouping
- **No Overlap Rule**: Bookings appear once in summary table under their primary reason; Secondary Vendor section is informational cross-reference

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
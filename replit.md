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
- **Export Formatting**: Indian number format, DD/MM/YYYY date format, specific sorting, table styling, and auto column widths for Excel and Google Sheets.
- **Reason Priority Order**: Defined hierarchy for discrepancy assignment (e.g., Already Reconciled, Cancellations, MTB, NPD).
- **Secondary Vendor**: Segregated detection, reason prefixing, separate UI display, and distinct reporting.
- **Already Reconciled Feature**: Highest priority detection, sub-classification, DRI team assignment, UI display with modals, and integration into amount payable adjustments.
- **Cancellations Consolidation**: Grouping of various cancellation types for summarized display, specific discrepancy calculation, and hierarchical modal breakdown.
- **Payment Method Mismatch**: Detection of differing payment methods, violet-styled UI section, TID-level grouping, and editable "Final Vendor ID" for manual corrections.
- **Purchase Reconciliation (PORTAL_DEPOSIT)**: Replaces standard Amount Payable panel with a 12-line item reconciliation, including opening/closing balances, reloads, refunds, and computed/actual purchases. Features USD conversion, validation, collapsible reason/TID groups, editable "Final Net Price" with warnings, and TID-level bulk updates (SP Net, HO Net, Pax Type). Includes dispute and issue tracking per booking/TID.
- **Vendor Balance Upload**: Dedicated section on the home page for uploading and managing vendor balances via Excel/CSV, with preview and bulk save functionality.
- **Pax Type Management**: Database storage and UI for managing pax type names. Detection of pax-related columns in HO data, per-booking display, and TID-level bulk price updates based on pax types.

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
- `/api/issues`: POST for flagging issues.
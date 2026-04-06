# Headout Recon Automation

## Overview

Headout Recon Automation is an enterprise productivity web application designed to automate and streamline booking reconciliation workflows. Its primary purpose is to detect discrepancies between internal booking data and supplier invoices, perform FX currency conversion, categorize issues with reason codes, and generate draft messages for DRI teams. The application supports a comprehensive multi-step process from file upload to report export, aiming to significantly enhance efficiency and accuracy in financial reconciliation. Key capabilities include managing secondary vendors, already reconciled bookings, cancellations, and comprehensive purchase reconciliation with vendor balance and pax type management. The project aims to provide a robust solution for financial operations, reducing manual effort and improving data integrity.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Monorepo Structure**: Frontend (React) and Backend (Node.js) coexist with shared types for enhanced type safety.
- **Data Abstraction**: In-memory storage is used with an interface for future database integration, ensuring flexibility.
- **Multi-step Workflow**: Global state management explicitly via props for clear traceability.
- **Robust Authentication**: Email/password authentication with `crypto.scrypt` hashing, restricted domain registration (`@headout.com`), role-based access control (`researcher`, `admin`), and session management using PostgreSQL.
- **UI/UX**: Adheres to Material Design 3 principles, utilizes Inter font for UI and JetBrains Mono for data, and supports theming (light/dark mode) via CSS custom properties.

### Frontend
- **Framework**: React 18 with TypeScript.
- **Routing**: Wouter.
- **State Management**: React's `useState`/`useCallback` for UI state; TanStack React Query for server state.
- **UI Components**: shadcn/ui (Radix primitives + Tailwind CSS).
- **Styling**: Tailwind CSS with CSS variables.

### Backend
- **Runtime**: Node.js with Express.
- **Language**: TypeScript (ESM modules).
- **API Pattern**: RESTful JSON API.
- **File Handling**: Multer for `xlsx`, `csv` file uploads.
- **Data Processing**: `xlsx` library for spreadsheet parsing.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Validation**: Zod schemas.
- **Storage**: In-memory storage with an interface for future database migration.

### Key Features
- **Discrepancy Resolution**: Automated detection, reason code assignment, and generation of draft messages. Includes specific handling for Negative SP Net bookings with auto-TAP computation and sub-classification.
- **Secondary Vendor Management**: Segregated detection, UI display, and distinct reporting.
- **Already Reconciled Feature**: High-priority detection, sub-classification, and integration into payable adjustments.
- **Cancellations Consolidation**: Grouping of various cancellation types for summarized display and specific discrepancy calculation.
- **Vendor ID Management**: Centralized management for both secondary vendor and payment method mismatch scenarios, blocking "Apply & Confirm" until all vendor IDs are set.
- **Purchase Reconciliation (PORTAL_DEPOSIT)**: A specialized 12-line item reconciliation process including opening/closing balances, reloads, refunds, and computed/actual purchases. Supports USD conversion, validation, and TID-level bulk updates.
- **Vendor Balance & Portal Reloads**: Dedicated sections for uploading and managing vendor balances and portal reload data via Excel/CSV, impacting purchase reconciliation. Includes manual adjustment capabilities for reloads.
- **Pax Type Management**: Database storage, UI display, and TID-level bulk price updates based on pax types, supporting date-based grouping for unit prices.
- **Export Functionality**: Exports split into "Discrepancy Analysis" and "Reconciliation Report" for both Excel and Google Sheets, with specific formatting (Indian number format, DD/MM/YYYY dates) and pre-export validation checks.
- **Recon Tracker**: Allows naming and tracking of saved reconciliation sessions.

## External Dependencies

### Database
- PostgreSQL (via `DATABASE_URL` environment variable)

### Key NPM Packages
- `express`: Web application framework.
- `drizzle-orm`, `drizzle-zod`: ORM and schema validation.
- `xlsx`: Spreadsheet parsing.
- `@tanstack/react-query`: Server state management.
- `wouter`: Client-side routing.
- `zod`: Runtime type validation.
- `shadcn/ui`: UI component library.
- `multer`: Middleware for handling `multipart/form-data`.

### Environment Variables
- `DATABASE_URL`: Connection string for PostgreSQL.
- `NODE_ENV`: Application environment.
- `APP_PASSWORD`: Admin user default password (optional).

### API Endpoints
- `/api/auth/*`: User authentication (login, register, status, logout, change password).
- `/api/admin/*`: Admin-specific user management and statistics.
- `/api/vendor-balances`: CRUD for vendor balance data.
- `/api/pax-types`: CRUD for pax type definitions.
- `/api/disputes`: Management of booking disputes.
- `/api/issues`: Management and tracking of reconciliation issues, including auto-generation of Google Sheets for workings.
- `/api/portal-reloads`: Upload, management, and retrieval of portal reload data.
- `/api/reload-adjustments`: Management of manual adjustments to portal reloads.
- `/api/runs/:runId/export/*`: Endpoints for exporting reconciliation data to Excel/Google Sheets.
- `/api/runs/:runId/actioning-progress`: Retrieves progress on TID actioning.
- `/api/runs/:runId/validate-financial`: Performs pre-export data integrity validations.
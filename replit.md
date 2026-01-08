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
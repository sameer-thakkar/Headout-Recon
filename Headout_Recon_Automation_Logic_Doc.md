# Headout Recon Automation — Complete Logic Documentation

---

## 1. Overview

Headout Recon Automation is an enterprise web application that automates the reconciliation of booking data between Headout's internal systems (HO) and Supplier Partner (SP) invoices. It detects discrepancies, converts currencies, classifies issues by reason codes, assigns them to responsible teams, and generates draft messages and exportable reports.

---

## 2. Application Pages & Navigation

| Route | Page | Purpose |
|:---|:---|:---|
| `/` | Landing / Home | Dashboard with recent sessions, vendor balance upload, portal reloads upload, pax type management |
| `/login` | Login | Email/password authentication for @headout.com users |
| `/register` | Register | New account creation (restricted to @headout.com domain) |
| `/upload` | Reconciliation Workspace | Core page — file upload, multi-step processing, discrepancy analysis, amount payable |
| `/discrepancy-analysis` | Discrepancy Analysis | Deep-dive into specific reason codes with TID-level breakdown |
| `/recon-tracker` | Recon Tracker | History and status of saved/named reconciliation sessions |
| `/issue-tracker` | Issue Tracker | Management of all flagged issues with Error Bucket, RCA, and status tracking |
| `/admin` | Admin Dashboard | User management, system stats, password reset processing (admin only) |
| `/dri` | DRI View | Team-specific view for assigned discrepancies |
| `/drafts` | Draft Messages | View and copy auto-generated communication for suppliers |
| `/export` | Export Hub | Final reporting page for validated reconciliation results |

---

## 3. Authentication & User Management

### 3.1 Authentication Flow
- **Method**: Email/password with session cookies (stored in PostgreSQL via `connect-pg-simple`, 7-day expiry)
- **Password Hashing**: `crypto.scrypt` with 16-byte random salt, `timingSafeEqual` for comparison
- **Domain Restriction**: Only `@headout.com` email addresses can register
- **Initial Admin**: On first startup, system creates `admin@headout.com` with `APP_PASSWORD` environment variable (or default `Headout@2025`)

### 3.2 Roles
| Role | Access |
|:---|:---|
| **Researcher** (default) | Full access to all reconciliation features — uploads, analysis, exports, issue tracker, recon tracker |
| **Admin** | Everything above + Admin Dashboard: user management, role changes, account suspension, password reset processing |

### 3.3 Password Reset Flow
1. User clicks "Forgot password?" on login page and submits their email
2. System creates a pending reset request (generic confirmation shown to prevent email enumeration)
3. Admin sees the request in the Admin Dashboard
4. Admin approves (generates temporary password to share) or rejects (with optional notes)
5. User logs in with temporary password and is forced to change it

### 3.4 Auth Endpoints
| Endpoint | Method | Auth | Purpose |
|:---|:---|:---|:---|
| `/api/register` | POST | None | Self-registration |
| `/api/auth/login` | POST | None | Email-based login |
| `/api/auth/logout` | POST | Session | Logout |
| `/api/auth/status` | GET | None | Check authentication status |
| `/api/auth/user` | GET | Session | Get current user profile |
| `/api/auth/change-password` | POST | Session | Change own password |
| `/api/auth/request-password-reset` | POST | None | Request password reset |
| `/api/admin/users` | GET | Admin | List all users |
| `/api/admin/users/:id` | PUT | Admin | Update user role/status |
| `/api/admin/password-reset-request/:id/process` | POST | Admin | Approve reset request |
| `/api/admin/password-reset-request/:id/reject` | POST | Admin | Reject reset request |

---

## 4. Core Reconciliation Workflow

### 4.1 Lifecycle
```
Upload HO/SP Files → Parse & Validate → FX Conversion → Match Bookings
→ Assign Reasons → Compute Differences → Generate Drafts → User Review
→ Take Actions (Disputes/Issues/Price Overrides) → Validate → Apply & Confirm → Export
```

### 4.2 File Upload & Parsing
- Accepts Excel (.xlsx) and CSV files
- HO (Headout) data and SP (Supplier Partner) data can be in the same or separate files
- **Column Mapping**: Auto-detects standard column headers; supports custom mapping
- **Key Fields Parsed**: Booking ID, Ticket ID, SP Net, HO Net, Currency, Payment Method, Booking Status, Cancellation Status, Fulfillment Method, Price Sync, Billing Entity ID, Amount Paid, Dispute Settled, Pax Breakdown, Reconciliation Status

### 4.3 FX Currency Conversion
- SP Net values are converted from SP Currency to HO Currency using stored FX rates
- Difference calculated as: `Diff LC = HO Net - SP Net (in HO Currency)`
- Difference USD computed for cross-currency comparisons
- FX rates can be updated/refreshed

### 4.4 Primary Row Selection
When multiple HO rows exist for the same Booking ID, the row with the **latest `bookingCreationDate`** is selected as the Primary row for reconciliation. Other rows are treated as secondary/duplicate.

---

## 5. Reason Code Assignment (Priority Order)

Reasons are assigned using a **strict priority hierarchy** — the first matching rule wins:

### Priority 1: Already Reconciled (Highest)
Based on the "Reason" column in HO data:
- **Already Reconciled-Same BE**: HO reason contains "already reconciled" AND Billing Entity IDs match
- **Already Reconciled-Different BE**: HO reason contains "already reconciled" AND Billing Entity IDs differ

### Priority 2: Negative SP Net
- **Cancelled-Refund OK**: Booking is CANCELLED + HO Net = 0 + SP Net < 0 (refund processed correctly, TAP = 0)
- **Negative SP - Partial Refund**: SP Net < 0 for all other cases (partial refund discrepancy)

### Priority 3: Cancellations
- **Cancelled-OK**: SP Net = 0 (no charge)
- **Cancelled-SP error**: Cancellable = "Yes" but SP charged (SP Net > 0)
- **Cancelled-Insured Booking**: Cancellable = "No", SP Net > 0, Cancellation Insurance = "Yes"
- **Cancelled-DSS policy**: Cancellable = "No", SP Net > 0, Charged Loss = "TRUE"
- **Cancelled-Check for Charge loss**: Cancellable = "No", SP Net > 0, Charged Loss = "FALSE"

### Priority 4: Multiple Tickets Booked (MTB)
Non-cancelled bookings where the difference percentage is <= -95% (HO Net is drastically less than SP Net)

### Priority 5: Reconciled
- **Exact match**: Difference = 0
- **Tolerance (Same Currency)**: Difference % <= 0.1%
- **Tolerance (Cross Currency)**: Difference % < 3%

### Priority 6: Net Price Discrepancy (NPD)
Fallback — any booking where amounts don't match and no prior rule applies

### Priority 7: Unmapped
Bookings present in SP report but missing from HO report entirely

---

## 6. Secondary Vendor Detection

A booking is flagged as **Secondary Vendor** when `hoBeId` (Headout Billing Entity) does not match `spBeId` (Supplier Billing Entity). These bookings:
- Follow the same reason classification logic
- Are displayed in a **separate section** in the UI
- Require a **Final Vendor ID** before export
- Have reason codes prefixed (e.g., "SV-NPD", "SV-Cancelled-OK")
- Are reported separately in exports

---

## 7. DRI Team Assignment

The responsible team is determined by the combination of Reason, Fulfillment Method, and Price Sync status:

| Reason | Fulfillment Method | Price Sync | DRI Team |
|:---|:---|:---|:---|
| MTB / Cancelled-SP error / Charge Loss | Freesale / Vendor API / Vendor Request | Any | **Tech** |
| | Manual | Any | **Reservation Ops** |
| | Selenium | Any | **Selenium** |
| | Pre-Purchase | Any | **Inventory Ops** |
| Secondary Vendor | Any | Any | **Supply** |
| Already Reconciled | Any | Any | **Finance** |
| NPD | Freesale / Manual | Any | **Biz Ops** |
| | Selenium | Any | **Selenium** |
| | Pre-Purchase | Any | **Inventory Ops** |
| | Vendor API | Yes | **Biz Ops** |
| | Vendor API | No / Blank | **Inventory Ops** |
| | Vendor Request | Any | **Tech** |
| Cancelled-OK / Insured / DSS / Refund OK | Any | Any | **N/A** |

---

## 8. Amount Payable Panel (Standard Vendors)

### 8.1 Overview
The Amount Payable panel is the final step where users determine how much Headout should pay the supplier.

### 8.2 Booking Categories
Bookings are grouped into:
1. **Reconciled** — Matched bookings (always SP Net)
2. **Discrepancies** — NPD, MTB, etc. (user selects SP or HO Net)
3. **Cancellations** — Grouped by cancellation type
4. **Already Reconciled** — Previously processed bookings
5. **Secondary Vendor** — Different billing entity bookings
6. **Amount Paid** — Bookings with prior partial payments

### 8.3 Per-Booking Actions
- **Net Selection**: Choose SP Net or HO Net as the payable amount (dropdown per booking)
- **Total Amount Payable Override**: Manual input to set a custom payable amount
- **Dispute Toggle**: Flag a booking as disputed (only when SP Net > HO Net)
- **Dispute Amount**: Editable amount for the disputed portion
- **Vendor ID Correction**: Required for payment method mismatch bookings

### 8.4 Final Amount Calculation
```
Final Amount = Reconciled Total
             + Discrepancy Total (based on SP/HO selections)
             + Already Reconciled Total
             + Secondary Vendor Total
             + |Cancellations Total|
             + Amount Paid Net Payable (TAP - Amount Already Paid)
             +/- Manual Adjustments
```

### 8.5 Locking Mechanism
When a booking's balance is finalized in the **Reconciliation Summary Workspace** (via Pax Pricing modal or TID-level Set SP/HO actions):
- The booking is **locked** in the Amount Payable panel
- Net selection dropdown shows "Locked" (violet label)
- Total Payable input is disabled with violet styling
- Prevents accidental overrides after summary-level decisions

### 8.6 Apply & Confirm
- Blocked until all **Vendor IDs** are set for secondary vendor and payment mismatch bookings
- Amber warning banner shown when incomplete
- On confirmation, results are finalized and financial export becomes available

---

## 9. Purchase Reconciliation (PORTAL_DEPOSIT Vendors)

For vendors using the PORTAL_DEPOSIT payment method, the standard Amount Payable panel is replaced with a **12-line item reconciliation**:

| Line | Item | Source |
|:---|:---|:---|
| 1 | Opening Balance | Vendor Balance upload |
| 2 | Reloads | Portal Reloads upload (with adjustments) |
| 3 | Refunds | Computed from negative SP bookings |
| 4 | Total Available | Lines 1 + 2 + 3 |
| 5 | Computed Purchases (SP) | Sum of SP Net for all bookings |
| 6 | Actual Purchases (HO) | Sum of HO Net for all bookings |
| 7 | Discrepancy | Line 5 - Line 6 |
| 8 | Closing Balance (Expected) | Line 4 - Line 6 |
| 9 | Closing Balance (Actual) | From vendor balance data |
| 10 | Difference | Line 8 - Line 9 |
| 11 | TID-Level Breakup | Expandable detail of discrepancies |
| 12 | Grand Total | Final reconciled position |

### 9.1 Features
- USD conversion alongside local currency
- Collapsible reason/TID groups with lazy loading (top 5 reasons, "Show all" button)
- Reason-level priority bars showing percentage of grand total discrepancy
- Search/filter within breakups (by Booking ID, TID, or reason)
- Auto-expand for single-TID reasons and TIDs with 3 or fewer bookings
- Editable "Total Amount Payable" with warnings
- TID-level bulk updates (Set SP Net, Set HO Net, Pax Type)
- Dispute and issue tracking per booking/TID

---

## 10. Negative SP Net Handling

Bookings with negative SP Net require special treatment:

### 10.1 Auto-Reconciliation
- **CANCELLED + HO Net = 0**: Auto-reconciled as "Cancelled-Refund OK" with TAP = 0

### 10.2 Auto-TAP Computation
- HO = 0 → TAP = 0
- |SP| = |HO| → TAP = 0
- Otherwise → TAP = ||HO| - |SP||

### 10.3 Sub-Classification Badges
- **Zero HO**: HO Net is 0
- **Matched**: |SP| equals |HO|
- **Difference**: Other cases

### 10.4 UI Treatment
- Red-tinted rows with "Refund" badge
- Bold red SP Net values
- Reconciliation Status displayed as violet badge
- Verification checkbox required before Apply & Confirm

---

## 11. Vendor ID Management

### 11.1 Payment Method Mismatch
When a booking's HO payment method differs from its SP payment method, an inline **Vendor ID input** (violet-styled) appears in the Discrepancy, Already Reconciled, and Cancellations rows.

### 11.2 Secondary Vendor
Secondary Vendor sections have a mandatory **bulk "Final Vendor ID"** input that applies to all secondary vendor bookings.

### 11.3 Validation Gate
Apply & Confirm is blocked until all vendor IDs are set. Amber warning banner displayed when incomplete.

---

## 12. Dispute & Issue Tracking

### 12.1 Disputes
- **Condition**: Can only dispute when SP Net > HO Net (i.e., Headout would be overpaying)
- **Per-Booking Toggle**: Checkbox to flag as disputed
- **Dispute Amount**: Editable, defaults to max discrepancy amount
- **Behavior**: Dispute amounts are tracked and displayed but **NOT deducted** from price payable
- **Auto-Clear**: If a booking is switched to HO Net selection, its dispute is automatically removed

### 12.2 Issues
- Created at the DRI-Discrepancy level
- **Columns**: Date, Payment Method, Period, Assignee, BE ID/Name, Currency, Discrepancy LC/USD, DRI Team, Error Bucket, RCA, Slack Link, Workings Link, Issue Status
- **Error Bucket**: Auto-populated from reconciliation reason codes + "Other"
- **RCA**: Dependent dropdown filtered by Error Bucket (via `errorBucketRcaMapping`)
- **Workings Link**: Auto-generated Google Sheet with "Draft Message" and "DRI Discrepancy" tabs
- All fields support inline editing

---

## 13. Pax Type Management

### 13.1 Pax Types
Database-stored names for passenger types (Adult, Child, Infant, etc.). Managed via the home page.

### 13.2 Pax Pricing Modal
- Detects pax-related columns in HO data
- Groups bookings by date (using `paymentBasis`: DATE_OF_EXPERIENCE or DATE_OF_BOOKING)
- Computes per-date SP/HO unit prices per pax type
- Collapses contiguous same-price dates into date ranges
- Allows per-row "Total Amount Payable" input via SP Net/HO Net dropdown
- Dispute and Issue columns with plain inputs

---

## 14. Portal Reloads & Vendor Balances

### 14.1 Vendor Balance Upload
- Dedicated section on home page
- Excel/CSV upload with preview and bulk save
- Stores opening balance, closing balance, and reloads per Billing Entity

### 14.2 Portal Reloads Upload
- Separate file upload for reload transaction data
- Parses: Finance Zendesk Tickets Portal Partner ID, Paid Amount, Currency, Zendesk ID, Date of Payment, Amount Loaded at Date
- Sums paid amounts per BE ID
- Overrides vendor balance reloads when portal reload data exists

### 14.3 Reload Adjustments
- Manual add/subtract entries to correct totals
- Managed via "Manage" button on the Reloads line item
- Formula: `adjustedTotal = original total + sum(add) - sum(less)`

---

## 15. Export System

### 15.1 Export Split
Exports are split into two separate files:

#### Discrepancy Analysis Export
| Sheet | Content |
|:---|:---|
| Discrepancy Analysis | Overall summary by reason, cancellation breakup, TID analysis |
| Draft Messages | Auto-generated communication templates for vendors |
| DRI Sheets (per team) | Team-specific booking lists (Tech, Reservation Ops, Selenium, Inventory Ops, Supply, Finance) |

#### Reconciliation Report (Financial) Export
| Sheet | Content |
|:---|:---|
| Payable Summary | SP vs HO payable comparison, Amount Payable Summary, Purchase Reconciliation (for PORTAL_DEPOSIT) |
| SP Invoice Report | Original SP data + SP Net in HO Currency + FX Rate Used |
| HO Report Updated | Cleaned HO data + Final Vendor ID + SP Net in HO Currency + Difference |

### 15.2 Formats
- **Excel (.xlsx)**: Styled workbook with auto column widths, Indian number format, DD/MM/YYYY dates
- **Google Sheets**: Direct creation via Google Sheets API with batch formatting

### 15.3 Validation Gate
Financial export requires passing a **12-point validation check**:
1. Booking count integrity
2. Price completeness
3. Zero/negative price detection
4. Payment mismatch resolution (all Vendor IDs set)
5. FX rate validation
6. Manual edits summary
7. Open disputes review
8. Grand total variance check
9. Amount paid reconciliation
10. Vendor corrections verification
11. Data source verification
12. Secondary vendor coverage

### 15.4 Export Endpoints
| Endpoint | Type |
|:---|:---|
| `/api/runs/:runId/export/analysis` | Excel — Discrepancy Analysis |
| `/api/runs/:runId/export/financial` | Excel — Reconciliation Report |
| `/api/runs/:runId/export-gsheet/analysis` | Google Sheets — Discrepancy Analysis |
| `/api/runs/:runId/export-gsheet/financial` | Google Sheets — Reconciliation Report |

---

## 16. Reconciliation Summary Workspace

### 16.1 Summary Table
The overall reconciliation summary displays 10 columns:
- Reason | Currency | SP Net | HO Net | Discrepancy LC | Discrepancy USD | Balance Payable | Eye (detail) | Count | Action

### 16.2 Enhanced Summary Structure
Returns: `rows` (discrepancy reasons), `arRow` (Already Reconciled), `cancRow` (Cancellations), `reconciledRow`, `svRows` (Secondary Vendor), `svArRow`, `svCancRow`, `grandTotal`

### 16.3 Take Action Panel
NPD-style TID Breakdown format:
- Expandable TID rows with BID-level detail
- Per-TID action strip: Set SP Net, Set HO Net, Pax Pricing, Dispute, Issue
- Pax Pricing modal with date-based grouping
- Price overrides persisted via API mutations

---

## 17. Run Management & Recon Tracker

- Sessions can be **named** (via TopBar bookmark button or during initial upload)
- Named/saved sessions appear in the **Recon Tracker** page
- Runs table has `name` and `isSaved` columns
- Each run stores complete results, file metadata, and processing state

---

## 18. Technical Architecture

### 18.1 Stack
| Layer | Technology |
|:---|:---|
| Frontend | React 18 + TypeScript + Vite |
| Routing | Wouter |
| State | TanStack React Query + useState |
| UI | shadcn/ui (Radix + Tailwind CSS) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| File Parsing | xlsx library + Multer |
| Auth | crypto.scrypt + express-session + connect-pg-simple |

### 18.2 Key Design Patterns
- **Monorepo with shared types**: `shared/schema.ts` ensures type safety across client and server
- **Multi-step workflow state**: Global state managed via props for traceability
- **Debounced persistence**: Price overrides auto-saved with 1-second debounce
- **Split export architecture**: Analysis vs Financial exports for different audiences

---

## 19. Database Tables

| Table | Purpose |
|:---|:---|
| `users` | User accounts with email, role, status |
| `user_sessions` | Session storage for authentication |
| `password_reset_requests` | Password reset workflow tracking |
| `reconciliation_sessions` | Run metadata and processing state |
| `vendor_balances` | Uploaded vendor balance data |
| `portal_reloads` | Uploaded portal reload transactions |
| `reload_adjustments` | Manual reload adjustments |
| `pax_types` | Passenger type definitions |
| `disputes` | Active dispute records per booking |
| `issues` | Issue tracker entries with RCA |
| `price_overrides` | Persisted per-booking price selections |
| `fx_rates` | Currency exchange rates |
| `runs` | Reconciliation run results and file data |

---

## 20. Formatting Standards

- **Number Format**: Indian format (e.g., 1,23,456.78)
- **Date Format**: DD/MM/YYYY
- **Currency Display**: Symbol prefix with 2 decimal places
- **Fonts**: Inter for UI, JetBrains Mono for data/numbers
- **Theme**: Light/dark mode via CSS custom properties

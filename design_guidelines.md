# Headout Recon Automation - Design Guidelines

## Design Approach
**Selected System**: Material Design 3 with clean, data-focused customization
**Rationale**: Enterprise productivity tool requiring clarity, consistency, and efficient data presentation. Material's components handle complex tables, forms, and workflows while maintaining visual hierarchy.

**Design Principles**:
- Clarity over decoration: Information-first design
- Predictable interactions: Standard patterns users recognize
- Efficient workflows: Minimize clicks, maximize visibility
- Progressive disclosure: Show complexity only when needed

## Typography
- **Primary Font**: Inter (Google Fonts) - excellent for data/UI
- **Monospace Font**: JetBrains Mono - for TIDs, currencies, numeric data
- **Scale**:
  - Page titles: text-3xl font-bold
  - Section headers: text-xl font-semibold
  - Card titles: text-lg font-medium
  - Body/tables: text-sm
  - Labels/metadata: text-xs text-gray-600

## Layout System
**Spacing Primitives**: Tailwind units of 2, 4, 6, 8, 12, 16
- Component padding: p-4 or p-6
- Section gaps: gap-6 or gap-8
- Page margins: px-8 py-6
- Card spacing: p-6

**Container Strategy**:
- App shell: Full viewport with fixed sidebar (256px width)
- Content area: max-w-7xl mx-auto px-8
- Cards: Contained within content area, not full-bleed

## Component Library

### Navigation Shell
**Sidebar** (always visible, 256px fixed width):
- Logo + app name at top (py-6 px-4)
- Nav items: Full-width with left-aligned text + icon, active state has subtle background
- Items use py-3 px-4 with 8px icon-to-text gap
- Sticky position, light border-right

**Top Bar** (fixed, 64px height):
- Left: Current file/run selector (max-w-xs)
- Center: Status pill with icon
- Right: FX refresh button + timestamp
- All items vertically centered with gap-4

### Landing Page Design
**Hero Section** (not full-viewport, approximately 60vh):
- Large centered headline: "Headout Recon Automation" (text-5xl font-bold)
- One-line value prop beneath (text-xl text-gray-600)
- Two prominent CTAs side-by-side:
  - Primary: "Start Reconciliation" (larger, filled button)
  - Secondary: "Try Demo" (outlined button)
- Background: Subtle gradient or geometric pattern (non-distracting)

**How It Works Strip** (py-16):
- 3-column grid (grid-cols-3 gap-8)
- Each step: Large number badge, title, 2-line description
- Visual flow indicators (arrows) between steps
- Icons: Upload, processing gears, download

**Recent Runs Card** (max-w-4xl mx-auto):
- Table layout when runs exist (file name, date, status, actions)
- Empty state: Centered icon + "No runs yet" + helper text
- Card elevation: subtle shadow

**Footer** (py-8, border-top):
- 2-column: Left has version info, Right has last FX refresh timestamp
- Subdued styling (text-sm text-gray-500)

### Data Tables
**Standard Pattern**:
- Sticky header row with sort indicators
- Zebra striping (subtle, every other row)
- Row height: py-3
- Cell padding: px-4
- Hover state: subtle background change
- Default sort indicator: Arrow icon in header
- Numeric columns: Right-aligned, monospace font
- Actions column: Always right-most, minimal icons

**Table Variants**:
- Summary tables: Denser spacing (py-2)
- Booking-level tables: Include expandable rows for details
- Always show total count above table

### Forms & Inputs
**Upload Area**:
- Large dashed border dropzone (h-48)
- Centered upload icon + text
- File list below with remove actions
- Demo button as separate card below dropzone

**Column Mapping Table**:
- 3-column layout: Field name (bold) | Detected (badge) | Override (dropdown)
- Auto-detected fields show success indicator
- Missing fields highlighted with warning badge
- Dropdown full-width in cell

**Filters/Controls**:
- Horizontal layout with gap-4
- Labels above dropdowns (text-sm font-medium)
- All controls same height (h-10)
- Clear all button at end

### Cards & Containers
**Standard Card**:
- White background, rounded-lg, shadow-sm
- Padding: p-6
- Header with title + optional action button
- Content section with gap-4

**Message Draft Cards**:
- Border-left accent (4px) for different types
- Header: DRI team badge + copy/export buttons
- Message content: Monospace, pre-wrapped text
- Footer: Metadata (booking count, etc.)

### Tabs
**Tab Bar**:
- Horizontal with border-bottom on container
- Active tab: border-bottom-2 in accent color, font-medium
- Inactive: text-gray-600, hover state
- Tab content: py-6

### Status & Feedback
**Status Pills**: Small, rounded-full, px-3 py-1, uppercase text-xs
**Progress Indicators**: 
- Vertical step list with connecting lines
- Active step highlighted, completed steps with checkmark
- Each step shows loading spinner when active

**Empty States**: 
- Centered layout with icon (h-16 w-16)
- Heading + 2-line description
- CTA button below

### Buttons
**Primary Actions**: Filled, px-6 py-2.5, rounded-md, font-medium
**Secondary Actions**: Outlined, same sizing
**Icon Buttons**: Square (h-10 w-10), centered icon
**Groups**: gap-3 between buttons

## Images
**Landing Page Hero**: Abstract dashboard/data visualization mockup as background (semi-transparent overlay for text readability), approximately 800x500px
**How It Works Icons**: Simple line-art style icons for upload/processing/export steps
**Empty State Illustrations**: Minimalist iconography for "no runs" and "no data" states

## Animation
Minimal animations only:
- Page transitions: None (instant)
- Loading states: Simple spinner
- Hover states: Subtle opacity/background changes (100-200ms)
- Avoid scroll-triggered or decorative animations
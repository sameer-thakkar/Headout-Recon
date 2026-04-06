import { useState, useCallback, useMemo, useEffect, useRef, Fragment } from "react";
import { Plus, Trash2, Calculator, ChevronDown, ChevronRight, AlertTriangle, Check, CheckCircle2, X, Eye, FileWarning, Download, Pencil, RotateCcw, XCircle, CreditCard, Search, FileSpreadsheet, Loader2 } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Adjustment, 
  BookingForPayable, 
  FinalNetSelection,
  createPresetAdjustments 
} from "./amount-payable-modal";
import { AlreadyReconciledWorkspace } from "./already-reconciled-workspace";
import type { ArWorkspaceBooking } from "./already-reconciled-workspace";
import type { PrimaryRow } from "@shared/schema";



const CANCELLATION_CONDITIONS: Record<string, {
  cancellable: string;
  spNet: string;
  hoNet: string;
  cancellationInsurance: string;
  chargeLoss: string;
}> = {
  "Cancelled-OK":                    { cancellable: "Any", spNet: "= 0", hoNet: "Any", cancellationInsurance: "N/A", chargeLoss: "Any"   },
  "Cancelled-Refund OK":             { cancellable: "Any", spNet: "< 0", hoNet: "= 0", cancellationInsurance: "Any", chargeLoss: "Any"   },
  "Cancelled-SP error":              { cancellable: "Yes", spNet: "> 0", hoNet: "Any", cancellationInsurance: "N/A", chargeLoss: "Any"   },
  "Cancelled-Insured Booking":       { cancellable: "No",  spNet: "> 0", hoNet: "Any", cancellationInsurance: "Yes", chargeLoss: "Any"   },
  "Cancelled-DSS policy":            { cancellable: "No",  spNet: "> 0", hoNet: "Any", cancellationInsurance: "No",  chargeLoss: "TRUE"  },
  "Cancelled-Check for Charge loss": { cancellable: "No",  spNet: "> 0", hoNet: "Any", cancellationInsurance: "No",  chargeLoss: "FALSE" },
};

const CANCELLATION_ACTION_POINTS: Record<string, string> = {
  "Cancelled-OK":                    "No action needed",
  "Cancelled-Refund OK":             "No action needed",
  "Cancelled-SP error":              "Raise debit note to SP",
  "Cancelled-Insured Booking":       "Claim from insurance",
  "Cancelled-DSS policy":            "Covered under DSS policy",
  "Cancelled-Check for Charge loss": "Verify charge loss; raise debit note if applicable",
};

const CANCELLATION_FULFILLMENT_SPLIT = new Set(["Cancelled-SP error", "Cancelled-Check for Charge loss"]);

function getCancellationDriTeam(reason: string, fulfillmentMethod: string): string {
  const noAction = ["Cancelled-OK", "Cancelled-Refund OK", "Cancelled-Insured Booking", "Cancelled-DSS policy"];
  if (noAction.includes(reason)) return "N/A";
  const fm = fulfillmentMethod.trim().toLowerCase();
  const isFreesale = fm === "freesale";
  const isManual = fm === "manual";
  const isSelenium = fm === "selenium";
  const isPrePurchase = fm === "prepurchase" || fm === "pre-purchase" || fm === "pre_purchase" || fm === "pre purchase";
  const isVendorApi = fm === "vendor api" || fm === "vendorapi" || fm === "vendor-api" || fm === "vendor_api";
  const isVendorRequest = fm === "vendor request" || fm === "vendorrequest" || fm === "vendor-request" || fm === "vendor_request";
  if (isFreesale) return "Tech";
  if (isManual) return "Reservation Ops";
  if (isSelenium) return "Selenium";
  if (isPrePurchase) return "Inventory Ops";
  if (isVendorApi) return "Tech";
  if (isVendorRequest) return "Tech";
  return "Unknown";
}

function formatCancDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return dateStr; }
}

interface CancellationSummaryRow {
  reason: string;
  fulfillmentMethod: string;
  bidCount: number;
  startDate: string;
  endDate: string;
  totalBIDs: number;
  discrepancyLC: number;
  discrepancyUSD: number;
  bookings: BookingForPayable[];
}

type ARDecision = {
  decision: "pay" | "dont_pay";
  reason: string;
  customReason: string;
  finalAmount: number;
};

interface AmountPayablePanelProps {
  bookings: BookingForPayable[];
  currency: string;
  adjustments: Adjustment[];
  finalNetSelections: FinalNetSelection;
  onApply: (adjustments: Adjustment[], selections: FinalNetSelection, finalAmount: number) => void;
  onClose: () => void;
  runId?: string | null;
  allRows?: PrimaryRow[];
  onCurrencyChange?: (currency: string) => void;
  availableCurrencies?: string[];
  dominantPaymentMethod?: string;
  arDecisions?: Map<string, ARDecision>;
  onArDecisionChange?: (decisions: Map<string, ARDecision>) => void;
  arActiveDisputes?: Set<string>;
  arDisputeAmounts?: Map<string, number>;
  onArDisputeChange?: (newActive: Set<string>, newAmounts: Map<string, number>) => void;
  externalLocalSelections?: FinalNetSelection;
  onLocalSelectionsChange?: React.Dispatch<React.SetStateAction<FinalNetSelection>>;
  externalAmountPaidTotals?: Record<string, number>;
  onAmountPaidTotalsChange?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  lockedBookingIds?: Set<string>;
}

export function AmountPayablePanel({
  bookings,
  currency,
  adjustments,
  finalNetSelections,
  onApply,
  onClose,
  runId,
  allRows = [],
  onCurrencyChange,
  availableCurrencies = [],
  dominantPaymentMethod = "",
  arDecisions: externalArDecisions,
  onArDecisionChange: externalOnArDecisionChange,
  arActiveDisputes: externalArActiveDisputes,
  arDisputeAmounts: externalArDisputeAmounts,
  onArDisputeChange: externalOnArDisputeChange,
  externalLocalSelections,
  onLocalSelectionsChange,
  externalAmountPaidTotals,
  onAmountPaidTotalsChange,
  lockedBookingIds = new Set(),
}: AmountPayablePanelProps) {
  const [localAdjustments, setLocalAdjustments] = useState<Adjustment[]>(adjustments);
  const [internalSelections, setInternalSelections] = useState<FinalNetSelection>(finalNetSelections);
  const localSelections = externalLocalSelections ?? internalSelections;
  const setLocalSelections = onLocalSelectionsChange ?? setInternalSelections;
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  const [isCancellationsExpanded, setIsCancellationsExpanded] = useState(false);
  const [isAlreadyReconciledExpanded, setIsAlreadyReconciledExpanded] = useState(false);
  const [isArWorkspaceOpen, setIsArWorkspaceOpen] = useState(false);
  const [isAmountPaidExpanded, setIsAmountPaidExpanded] = useState(false);
  const [internalAmountPaidTotals, setInternalAmountPaidTotals] = useState<Record<string, number>>({});
  const amountPaidTotals = externalAmountPaidTotals ?? internalAmountPaidTotals;
  const setAmountPaidTotals = onAmountPaidTotalsChange ?? setInternalAmountPaidTotals;
  const [rawInputValues, setRawInputValues] = useState<Record<string, string>>({});
  const [actionedBookings, setActionedBookings] = useState<Set<string>>(new Set());
  const [disputeAdjEdits, setDisputeAdjEdits] = useState<Record<string, number>>({});
  const [discrepancyAdjEdits, setDiscrepancyAdjEdits] = useState<Record<string, number>>({});
  const [ticketIdEdits, setTicketIdEdits] = useState<Record<string, string>>({});
  const [disputeStatusEdits, setDisputeStatusEdits] = useState<Record<string, string>>({});
  const [isAmountPaidModalOpen, setIsAmountPaidModalOpen] = useState(false);
  const [bulkDisputeAdj, setBulkDisputeAdj] = useState("");
  const [bulkDiscrepancyAdj, setBulkDiscrepancyAdj] = useState("");
  const [bulkTicketId, setBulkTicketId] = useState("");
  const [modalSearchQuery, setModalSearchQuery] = useState("");
  const [bulkActionsExpanded, setBulkActionsExpanded] = useState(false);
  // Vendor ID correction: final vendor ID per booking and bulk vendor ID
  const [finalVendorIds, setFinalVendorIds] = useState<Map<string, string>>(new Map());
  const [secondaryVendorFinalId, setSecondaryVendorFinalId] = useState<string>("");
  const [vendorCorrectionsLoaded, setVendorCorrectionsLoaded] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [gSheetUrl, setGSheetUrl] = useState<string | null>(null);
  useEffect(() => { setGSheetUrl(null); }, [runId]);
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(() => {
    return externalArDisputeAmounts ? new Map(externalArDisputeAmounts) : new Map();
  });
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(() => {
    return externalArActiveDisputes ? new Set(externalArActiveDisputes) : new Set();
  });
  const [originalDisputes, setOriginalDisputes] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [disputeErrors, setDisputeErrors] = useState<Map<string, string>>(new Map());
  const [selectedReasonModal, setSelectedReasonModal] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [isLoggingIssues, setIsLoggingIssues] = useState(false);
  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [pendingApplyData, setPendingApplyData] = useState<{
    adjustments: Adjustment[];
    selections: FinalNetSelection;
    amount: number;
  } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const presets = createPresetAdjustments();
    const customAdjustments = adjustments.filter(a => !a.isPreset);
    setLocalAdjustments([...presets, ...customAdjustments]);
  }, [adjustments]);

  const prevRunIdRef = useRef(runId);
  useEffect(() => {
    if (prevRunIdRef.current !== runId) {
      setLocalSelections(finalNetSelections);
      setDisputesLoaded(false);
      setActionedBookings(new Set());
      prevRunIdRef.current = runId;
    }
    
    if (runId && !disputesLoaded) {
      setLocalSelections(finalNetSelections);
      fetch(`/api/disputes/${runId}`)
        .then(res => res.json())
        .then(data => {
          const disputes = data.disputes || [];
          const newDisputeAmounts = new Map<string, number>(externalArDisputeAmounts || []);
          const newActiveDisputes = new Set<string>(externalArActiveDisputes || []);
          
          const openOnlyDisputes = disputes.filter((d: { closureStatus?: string }) => d.closureStatus === "open");
          for (const dispute of openOnlyDisputes) {
            newDisputeAmounts.set(dispute.bookingId, dispute.disputeAmount);
            newActiveDisputes.add(dispute.bookingId);
          }
          
          setDisputeAmounts(newDisputeAmounts);
          setActiveDisputes(newActiveDisputes);
          setOriginalDisputes(new Map(newDisputeAmounts));
          setDisputesLoaded(true);
        })
        .catch(err => {
          console.error("Failed to load existing disputes:", err);
          const fallbackAmounts = new Map<string, number>(externalArDisputeAmounts || []);
          const fallbackActive = new Set<string>(externalArActiveDisputes || []);
          setDisputeAmounts(fallbackAmounts);
          setActiveDisputes(fallbackActive);
          setOriginalDisputes(new Map());
          setDisputesLoaded(true);
        });
    }
  }, [runId, disputesLoaded]);

  useEffect(() => {
    if (runId && !vendorCorrectionsLoaded) {
      fetch(`/api/vendor-corrections/${runId}`)
        .then(res => res.json())
        .then(data => {
          const corrections = data.corrections || [];
          const newMap = new Map<string, string>();
          for (const vc of corrections) {
            newMap.set(vc.bookingId, vc.finalVendorId);
          }
          setFinalVendorIds(newMap);
          const svBookings = bookings.filter(b => b.isSecondaryVendor);
          const svIds = new Set<string>();
          for (const b of svBookings) {
            const vid = newMap.get(b.bookingId);
            if (vid) svIds.add(vid);
          }
          if (svIds.size === 1) {
            setSecondaryVendorFinalId(Array.from(svIds)[0]);
          }
          setVendorCorrectionsLoaded(true);
        })
        .catch(err => {
          console.error("Failed to load vendor corrections:", err);
          setVendorCorrectionsLoaded(true);
        });
    }
  }, [runId, vendorCorrectionsLoaded, bookings]);

  const updateVendorId = useCallback((bookingId: string, value: string) => {
    setFinalVendorIds(prev => { const n = new Map(prev); n.set(bookingId, value); return n; });
  }, []);

  const saveVendorCorrection = useCallback(async (bookingId: string, finalVendorId: string) => {
    if (!runId) return;
    try {
      if (finalVendorId.trim()) {
        // Save the vendor correction
        await authFetch(`/api/vendor-corrections/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, finalVendorId: finalVendorId.trim() }),
        });
      } else {
        // Delete the vendor correction if value is cleared
        await authFetch(`/api/vendor-corrections/${runId}/${bookingId}`, {
          method: "DELETE",
        });
      }
    } catch (err) {
      console.error("Failed to save/delete vendor correction:", err);
    }
  }, [runId]);

  const saveSecondaryVendorId = useCallback(async () => {
    if (!runId || !secondaryVendorFinalId.trim()) return;
    const vid = secondaryVendorFinalId.trim();
    const svBookings = bookings.filter(b => b.isSecondaryVendor);
    if (svBookings.length === 0) return;
    try {
      for (const b of svBookings) {
        await authFetch(`/api/vendor-corrections/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: b.bookingId, finalVendorId: vid }),
        });
        setFinalVendorIds(prev => {
          const next = new Map(prev);
          next.set(b.bookingId, vid);
          return next;
        });
      }
      toast({ title: "Saved", description: `Final Vendor ID "${vid}" applied to ${svBookings.length} booking(s)` });
    } catch (err) {
      console.error("Failed to save secondary vendor ID:", err);
      toast({ title: "Error", description: "Failed to save vendor ID", variant: "destructive" });
    }
  }, [runId, secondaryVendorFinalId, bookings, toast]);

  // Save bulk vendor corrections
  useEffect(() => {
    if (!runId) return;
    const timer = setTimeout(() => {
      const overrides: Record<string, { totalAmountPayable: number; selection?: "ho" | "sp" }> = {};
      for (const b of bookings) {
        let pricePayable: number;
        const sel = (localSelections[b.bookingId] || "sp") as "ho" | "sp";
        if (amountPaidTotals[b.bookingId] !== undefined) {
          pricePayable = amountPaidTotals[b.bookingId];
        } else if (b.reason === "Reconciled" || b.reason === "Unmapped") {
          pricePayable = b.spNet;
        } else {
          pricePayable = sel === "ho" ? b.hoNet : b.spNet;
        }
        overrides[b.bookingId] = { totalAmountPayable: Math.max(0, pricePayable), selection: sel };
      }
      if (Object.keys(overrides).length > 0) {
        apiRequest("POST", "/api/price-overrides", { runId, overrides }).catch(console.error);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [runId, amountPaidTotals, localSelections, bookings]);

  const openDisputeData = useMemo(() => {
    const openRows = allRows.filter(r => r.disputeStatus?.toUpperCase() === "OPEN");
    if (openRows.length === 0) return { total: 0, groups: [], bookingCount: 0 };

    const byBe = new Map<string, { beName: string; beId: string; rows: typeof openRows; total: number }>();
    for (const row of openRows) {
      const key = row.beId || "unknown";
      if (!byBe.has(key)) {
        byBe.set(key, { beName: row.billingEntityName || key, beId: key, rows: [], total: 0 });
      }
      const g = byBe.get(key)!;
      g.rows.push(row);
      g.total += row.disputedAmount ?? 0;
    }

    const groups = Array.from(byBe.values()).map(g => ({
      ...g,
      total: Math.round(g.total * 100) / 100,
    }));
    const total = Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100;
    return { total, groups, bookingCount: openRows.length };
  }, [allRows]);

  useEffect(() => {
    setLocalAdjustments(prev =>
      prev.map(a =>
        a.nature === "Open Dispute Adjustments"
          ? { ...a, amount: Math.abs(openDisputeData.total), reference: openDisputeData.bookingCount > 0 ? `${openDisputeData.bookingCount} booking(s) from file` : "" }
          : a
      )
    );
  }, [openDisputeData]);

  const [isOpenDisputeExpanded, setIsOpenDisputeExpanded] = useState(false);

  const reconciledBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason === "Reconciled" && !(b.amountPaid != null && b.amountPaid > 0)), 
    [bookings]
  );

  // Cancellation reasons to group together
  const cancellationReasons = [
    "Cancelled-OK",
    "Cancelled-Refund OK",
    "Cancelled-SP error",
    "Cancelled-Insured Booking",
    "Cancelled-Check for Charge loss",
    "Cancelled-DSS policy",
  ];

  // Regular discrepancy bookings (excludes cancellations)
  const hasAmountPaidOrSettled = (b: BookingForPayable) =>
    b.disputeStatus === "OPEN";

  const discrepancyBookings = useMemo(() => 
    (bookings || []).filter(b => 
      b.reason !== "Reconciled" && 
      !b.reason.startsWith("Already Reconciled") && 
      !b.isSecondaryVendor &&
      !cancellationReasons.includes(b.reason) &&
      !hasAmountPaidOrSettled(b)
    ), 
    [bookings]
  );

  // Cancellation bookings grouped separately
  const cancellationBookings = useMemo(() => 
    (bookings || []).filter(b => cancellationReasons.includes(b.reason) && !b.isSecondaryVendor && !hasAmountPaidOrSettled(b)), 
    [bookings]
  );

  // Already Reconciled bookings with decision state
  const alreadyReconciledBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason.startsWith("Already Reconciled")), 
    [bookings]
  );

  const [internalArDecisions, setInternalArDecisions] = useState<Map<string, ARDecision>>(new Map());
  const alreadyReconciledDecisions = externalArDecisions ?? internalArDecisions;
  const setAlreadyReconciledDecisions = externalOnArDecisionChange ?? setInternalArDecisions;

  const reconciledTotal = useMemo(() => 
    reconciledBookings.reduce((sum, b) => sum + b.spNet, 0), 
    [reconciledBookings]
  );

  const bookingsByReason = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const booking of discrepancyBookings) {
      if (!grouped[booking.reason]) {
        grouped[booking.reason] = [];
      }
      grouped[booking.reason].push(booking);
    }
    if (reconciledBookings.length > 0) {
      grouped["Reconciled"] = reconciledBookings;
    }
    return grouped;
  }, [discrepancyBookings, reconciledBookings]);

  const bookingsByReasonAndTid = useMemo(() => {
    const result: Record<string, Record<string, BookingForPayable[]>> = {};
    for (const booking of discrepancyBookings) {
      if (!result[booking.reason]) {
        result[booking.reason] = {};
      }
      const tid = booking.tid || booking.bookingId;
      if (!result[booking.reason][tid]) {
        result[booking.reason][tid] = [];
      }
      result[booking.reason][tid].push(booking);
    }
    return result;
  }, [discrepancyBookings]);

  // Group cancellation bookings by reason
  const cancellationsByReason = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const booking of cancellationBookings) {
      if (!grouped[booking.reason]) {
        grouped[booking.reason] = [];
      }
      grouped[booking.reason].push(booking);
    }
    return grouped;
  }, [cancellationBookings]);

  // Cancellation summary flat table rows
  const cancellationSummaryRows = useMemo((): CancellationSummaryRow[] => {
    const rows: CancellationSummaryRow[] = [];

    function chronoSort(dateStrs: string[]): string[] {
      return dateStrs.slice().sort((a, b) => {
        const ta = new Date(a).getTime();
        const tb = new Date(b).getTime();
        if (isNaN(ta) && isNaN(tb)) return a.localeCompare(b);
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return ta - tb;
      });
    }

    function getBookingDates(bkgs: BookingForPayable[]): string[] {
      return bkgs.map(b => {
        const r = allRows.find(r => r.bookingId === b.bookingId);
        return b.experienceDate || r?.experienceDate || b.bookingCreationDate || r?.bookingCreationDate || "";
      }).filter((d): d is string => Boolean(d));
    }

    function calcDiscUSD(bkgs: BookingForPayable[]): number {
      return bkgs.reduce((s, b) => {
        const r = allRows.find(row => row.bookingId === b.bookingId);
        return s + (r?.differenceUsd ?? 0);
      }, 0);
    }

    Object.entries(cancellationsByReason).forEach(([reason, bkgs]) => {
      const reasonTotalBIDs = bkgs.length;

      if (CANCELLATION_FULFILLMENT_SPLIT.has(reason)) {
        const byFm = new Map<string, BookingForPayable[]>();
        for (const b of bkgs) {
          const row = allRows.find(r => r.bookingId === b.bookingId);
          const fm = row?.fulfillmentMethod || "Unknown";
          if (!byFm.has(fm)) byFm.set(fm, []);
          byFm.get(fm)!.push(b);
        }
        byFm.forEach((fmBookings, fm) => {
          const sorted = chronoSort(getBookingDates(fmBookings));
          const discLC = fmBookings.reduce((s, b) => s + (b.hoNet - b.spNet), 0);
          rows.push({
            reason,
            fulfillmentMethod: fm,
            bidCount: fmBookings.length,
            startDate: sorted[0] || "",
            endDate: sorted[sorted.length - 1] || "",
            totalBIDs: reasonTotalBIDs,
            discrepancyLC: discLC,
            discrepancyUSD: calcDiscUSD(fmBookings),
            bookings: fmBookings,
          });
        });
      } else {
        const fmSet = new Set<string>();
        for (const b of bkgs) {
          const row = allRows.find(r => r.bookingId === b.bookingId);
          if (row?.fulfillmentMethod) fmSet.add(row.fulfillmentMethod);
        }
        const sorted = chronoSort(getBookingDates(bkgs));
        const discLC = bkgs.reduce((s, b) => s + (b.hoNet - b.spNet), 0);
        rows.push({
          reason,
          fulfillmentMethod: fmSet.size > 0 ? Array.from(fmSet).join(", ") : "—",
          bidCount: bkgs.length,
          startDate: sorted[0] || "",
          endDate: sorted[sorted.length - 1] || "",
          totalBIDs: reasonTotalBIDs,
          discrepancyLC: discLC,
          discrepancyUSD: calcDiscUSD(bkgs),
          bookings: bkgs,
        });
      }
    });

    const ORDER = ["Cancelled-OK", "Cancelled-Refund OK", "Cancelled-SP error", "Cancelled-Insured Booking", "Cancelled-DSS policy", "Cancelled-Check for Charge loss"];
    rows.sort((a, b) => {
      const ai = ORDER.indexOf(a.reason);
      const bi = ORDER.indexOf(b.reason);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    return rows;
  }, [cancellationsByReason, allRows]);

  // Secondary Vendor bookings - using isSecondaryVendor flag
  const secondaryVendorBookings = useMemo(() => {
    return bookings.filter(b => b.isSecondaryVendor && !hasAmountPaidOrSettled(b));
  }, [bookings]);

  // Group Secondary Vendor bookings by their reason
  const secondaryVendorByReason = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const booking of secondaryVendorBookings) {
      if (!grouped[booking.reason]) {
        grouped[booking.reason] = [];
      }
      grouped[booking.reason].push(booking);
    }
    return grouped;
  }, [secondaryVendorBookings]);

  // Group Secondary Vendor bookings by reason AND tid (for expandable UI)
  const secondaryVendorByReasonAndTid = useMemo(() => {
    const result: Record<string, Record<string, BookingForPayable[]>> = {};
    for (const booking of secondaryVendorBookings) {
      if (!result[booking.reason]) {
        result[booking.reason] = {};
      }
      const tid = booking.tid || booking.bookingId;
      if (!result[booking.reason][tid]) {
        result[booking.reason][tid] = [];
      }
      result[booking.reason][tid].push(booking);
    }
    return result;
  }, [secondaryVendorBookings]);

  const hasPaymentMismatch = useCallback((booking: BookingForPayable): boolean => {
    if (!dominantPaymentMethod) return false;
    if (!booking.paymentMethod) return false;
    return booking.paymentMethod.toLowerCase().trim() !== dominantPaymentMethod.toLowerCase().trim();
  }, [dominantPaymentMethod]);

  const allVendorIdsComplete = useMemo(() => {
    if (secondaryVendorBookings.length > 0 && !secondaryVendorFinalId.trim()) return false;
    for (const b of secondaryVendorBookings) {
      const vid = finalVendorIds.get(b.bookingId);
      if (!vid || !vid.trim()) return false;
    }
    for (const b of bookings) {
      if (!b.isSecondaryVendor && hasPaymentMismatch(b)) {
        const vid = finalVendorIds.get(b.bookingId);
        if (!vid || !vid.trim()) return false;
      }
    }
    return true;
  }, [bookings, secondaryVendorBookings, secondaryVendorFinalId, hasPaymentMismatch, finalVendorIds]);

  const getFinalNetPrice = useCallback((booking: BookingForPayable): number => {
    if (amountPaidTotals[booking.bookingId] !== undefined) {
      return amountPaidTotals[booking.bookingId];
    }
    if (booking.reason === "Reconciled" || booking.reason === "Unmapped") {
      return booking.spNet;
    }
    const selection = localSelections[booking.bookingId] || "sp";
    const pricePayable = selection === "ho" ? booking.hoNet : booking.spNet;
    
    return pricePayable;
  }, [localSelections, activeDisputes, disputeAmounts, amountPaidTotals]);

  const getReasonTotal = useCallback((reason: string): number => {
    const reasonBookings = bookingsByReason[reason] || [];
    return reasonBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0);
  }, [bookingsByReason, getFinalNetPrice]);

  // Get total for a secondary vendor reason
  const getSecondaryVendorReasonTotal = useCallback((reason: string): number => {
    const reasonBookings = secondaryVendorByReason[reason] || [];
    return reasonBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0);
  }, [secondaryVendorByReason, getFinalNetPrice]);

  const discrepancyTotal = useMemo(() => 
    discrepancyBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0),
    [discrepancyBookings, getFinalNetPrice]
  );

  // Secondary Vendor total
  const secondaryVendorTotal = useMemo(() => 
    secondaryVendorBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0),
    [secondaryVendorBookings, getFinalNetPrice]
  );

  const cancellationsTotal = useMemo(() => 
    cancellationBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0),
    [cancellationBookings, getFinalNetPrice]
  );

  const totalAmountPaid = useMemo(() => 
    bookings.reduce((sum, b) => sum + (b.amountPaid || 0), 0),
    [bookings]
  );

  const amountPaidBookings = useMemo(() => 
    bookings.filter(hasAmountPaidOrSettled),
    [bookings]
  );

  const getAmountPaidTotal = useCallback((booking: BookingForPayable): number => {
    if (amountPaidTotals[booking.bookingId] !== undefined) {
      return amountPaidTotals[booking.bookingId];
    }
    const sel = localSelections[booking.bookingId] || "sp";
    return sel === "ho" ? booking.hoNet : booking.spNet;
  }, [amountPaidTotals, localSelections]);

  const isTidFullyActioned = useCallback((tidBookings: BookingForPayable[]) => {
    return tidBookings.length > 0 && tidBookings.every(b => actionedBookings.has(b.bookingId));
  }, [actionedBookings]);

  const handleAmountPaidTotalChange = useCallback((bookingId: string, value: string) => {
    setRawInputValues(prev => ({ ...prev, [bookingId]: value }));
    setActionedBookings(prev => { const next = new Set(prev); next.add(bookingId); return next; });
    const numVal = parseFloat(value);
    if (isNaN(numVal)) {
      setAmountPaidTotals(prev => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
    } else {
      setAmountPaidTotals(prev => ({ ...prev, [bookingId]: Math.round(numVal * 100) / 100 }));
    }
  }, []);

  const handleAmountPaidTotalBlur = useCallback((bookingId: string, hoNet: number, spNet: number) => {
    setAmountPaidTotals(prev => {
      const val = prev[bookingId];
      if (val === undefined) return prev;
      const lower = Math.min(hoNet, spNet);
      const upper = Math.max(hoNet, spNet);
      const minVal = lower * 0.9;
      const maxVal = upper * 1.1;
      const capped = Math.round(Math.max(minVal, Math.min(val, maxVal)) * 100) / 100;
      return { ...prev, [bookingId]: capped };
    });
    setRawInputValues(prev => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });
  }, []);

  // Calculate Already Reconciled total from decisions (only "pay" decisions count)
  // and also calculate adjustment (difference from base SP Net)
  const { alreadyReconciledTotal, alreadyReconciledAdjustment } = useMemo(() => {
    let totalFromDecisions = 0;
    let baseTotal = 0;
    
    alreadyReconciledBookings.forEach((booking) => {
      const decision = alreadyReconciledDecisions.get(booking.bookingId);
      baseTotal += booking.spNet;
      
      if (decision) {
        if (decision.decision === "pay") {
          // Use the user-specified finalAmount (defaults to SP Net)
          totalFromDecisions += decision.finalAmount;
        }
        // "dont_pay" means we don't add anything to total
      } else {
        // No decision yet — AR bookings default to TAP=0 (already paid)
      }
    });
    
    // Adjustment is the difference from what would be paid vs base SP Net total
    const adjustment = totalFromDecisions - baseTotal;
    
    return { 
      alreadyReconciledTotal: totalFromDecisions, 
      alreadyReconciledAdjustment: adjustment 
    };
  }, [alreadyReconciledBookings, alreadyReconciledDecisions]);

  const baseAmount = reconciledTotal + discrepancyTotal + alreadyReconciledTotal + secondaryVendorTotal + Math.abs(cancellationsTotal);

  const amountPaidNetPayableTotal = useMemo(() => {
    return amountPaidBookings.reduce((sum, b) => {
      const totalPayable = amountPaidTotals[b.bookingId] !== undefined
        ? amountPaidTotals[b.bookingId]
        : ((localSelections[b.bookingId] || "sp") === "ho" ? b.hoNet : b.spNet);
      return sum + (totalPayable - (b.amountPaid || 0));
    }, 0);
  }, [amountPaidBookings, amountPaidTotals, localSelections]);

  const finalAmount = useMemo(() => {
    const adjustmentsResult = localAdjustments.reduce((total, adj) => {
      if (adj.type === "add") {
        return total + adj.amount;
      } else {
        return total - adj.amount;
      }
    }, baseAmount);
    
    const result = adjustmentsResult + amountPaidNetPayableTotal;
    return Math.round(result * 100) / 100;
  }, [baseAmount, localAdjustments, amountPaidNetPayableTotal]);

  const updateSelection = useCallback((bookingId: string, value: "ho" | "sp", booking?: BookingForPayable) => {
    setLocalSelections(prev => ({ ...prev, [bookingId]: value }));
    setActionedBookings(prev => { const next = new Set(prev); next.add(bookingId); return next; });
    setAmountPaidTotals(prev => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });
    setRawInputValues(prev => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        newSet.delete(bookingId);
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        newMap.delete(bookingId);
        return newMap;
      });
    }
  }, []);

  const updateAmountPaidBulkSelection = useCallback((value: "ho" | "sp") => {
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of amountPaidBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    setAmountPaidTotals(prev => {
      const next = { ...prev };
      for (const b of amountPaidBookings) {
        delete next[b.bookingId];
      }
      return next;
    });
    setRawInputValues(prev => {
      const next = { ...prev };
      for (const b of amountPaidBookings) {
        delete next[b.bookingId];
      }
      return next;
    });
  }, [amountPaidBookings]);

  const updateTidSelection = useCallback((reason: string, tid: string, value: "ho" | "sp") => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of tidBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    setAmountPaidTotals(prev => {
      const next = { ...prev };
      for (const b of tidBookings) {
        delete next[b.bookingId];
      }
      return next;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of tidBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [bookingsByReasonAndTid]);

  const updateSecondaryVendorTidSelection = useCallback((reason: string, tid: string, value: "ho" | "sp") => {
    const tidBookings = secondaryVendorByReasonAndTid[reason]?.[tid] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of tidBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    setAmountPaidTotals(prev => {
      const next = { ...prev };
      for (const b of tidBookings) {
        delete next[b.bookingId];
      }
      return next;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of tidBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [secondaryVendorByReasonAndTid]);

  const toggleReason = useCallback((reason: string) => {
    setExpandedReasons(prev => {
      const newSet = new Set(prev);
      if (newSet.has(reason)) {
        newSet.delete(reason);
      } else {
        newSet.add(reason);
      }
      return newSet;
    });
  }, []);

  const toggleTid = useCallback((tidKey: string) => {
    setExpandedTids(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tidKey)) {
        newSet.delete(tidKey);
      } else {
        newSet.add(tidKey);
      }
      return newSet;
    });
  }, []);

  const isBookingDisputable = useCallback((booking: BookingForPayable): boolean => {
    if (booking.reason === "Unmapped") return true;
    const selection = localSelections[booking.bookingId] || "sp";
    return selection === "sp";
  }, [localSelections]);

  const getMaxDisputeAmount = useCallback((booking: BookingForPayable): number => {
    const finalNet = getFinalNetPrice(booking);
    return Math.round(Math.abs(booking.hoNet - finalNet) * 100) / 100;
  }, [getFinalNetPrice]);

  const toggleDispute = useCallback((bookingId: string, booking: BookingForPayable) => {
    if (!isBookingDisputable(booking)) return;
    setActionedBookings(prev => { const next = new Set(prev); next.add(bookingId); return next; });
    setActiveDisputes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bookingId)) {
        newSet.delete(bookingId);
      } else {
        newSet.add(bookingId);
        if (!disputeAmounts.has(bookingId)) {
          const maxAmt = getMaxDisputeAmount(booking);
          setDisputeAmounts(prevMap => new Map(prevMap).set(bookingId, maxAmt));
        }
      }
      return newSet;
    });
  }, [isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

  const updateDisputeAmount = useCallback((bookingId: string, amount: number, booking: BookingForPayable) => {
    const maxAmount = getMaxDisputeAmount(booking);
    if (amount > maxAmount) {
      setDisputeErrors(prev => new Map(prev).set(bookingId, `Max: ${formatCurrency(maxAmount)}`));
      return;
    }
    setDisputeErrors(prev => {
      const newMap = new Map(prev);
      newMap.delete(bookingId);
      return newMap;
    });
    setDisputeAmounts(prev => new Map(prev).set(bookingId, Math.round(amount * 100) / 100));
  }, [getMaxDisputeAmount]);

  const getTidDisputeCount = useCallback((reason: string, tid: string) => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    let disputed = 0;
    let disputable = 0;
    for (const b of tidBookings) {
      if (isBookingDisputable(b)) {
        disputable++;
        if (activeDisputes.has(b.bookingId)) {
          disputed++;
        }
      }
    }
    return { disputed, disputable };
  }, [bookingsByReasonAndTid, isBookingDisputable, activeDisputes]);

  const toggleTidDispute = useCallback((reason: string, tid: string) => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    const { disputed, disputable } = getTidDisputeCount(reason, tid);
    
    if (disputed === disputable) {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
    } else {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          if (isBookingDisputable(b)) {
            newSet.add(b.bookingId);
            if (!disputeAmounts.has(b.bookingId)) {
              const maxAmt = getMaxDisputeAmount(b);
              setDisputeAmounts(prevMap => new Map(prevMap).set(b.bookingId, maxAmt));
            }
          }
        }
        return newSet;
      });
    }
  }, [bookingsByReasonAndTid, getTidDisputeCount, isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

  const toggleSecondaryVendorTidDispute = useCallback((reason: string, tid: string) => {
    const tidBookings = secondaryVendorByReasonAndTid[reason]?.[tid] || [];
    const disputableBookings = tidBookings.filter(b => isBookingDisputable(b));
    const allDisputed = disputableBookings.every(b => activeDisputes.has(b.bookingId));
    
    if (allDisputed) {
      const newDisputes = new Set(activeDisputes);
      const newAmounts = new Map(disputeAmounts);
      for (const b of disputableBookings) {
        newDisputes.delete(b.bookingId);
        newAmounts.delete(b.bookingId);
      }
      setActiveDisputes(newDisputes);
      setDisputeAmounts(newAmounts);
    } else {
      const newDisputes = new Set(activeDisputes);
      const newAmounts = new Map(disputeAmounts);
      for (const b of disputableBookings) {
        newDisputes.add(b.bookingId);
        if (!newAmounts.has(b.bookingId)) {
          newAmounts.set(b.bookingId, getMaxDisputeAmount(b));
        }
      }
      setActiveDisputes(newDisputes);
      setDisputeAmounts(newAmounts);
    }
  }, [secondaryVendorByReasonAndTid, activeDisputes, disputeAmounts, isBookingDisputable, getMaxDisputeAmount]);

  const getSecondaryVendorTidDisputeCount = useCallback((reason: string, tid: string) => {
    const tidBookings = secondaryVendorByReasonAndTid[reason]?.[tid] || [];
    const disputable = tidBookings.filter(b => isBookingDisputable(b)).length;
    const disputed = tidBookings.filter(b => activeDisputes.has(b.bookingId)).length;
    return { disputed, disputable };
  }, [secondaryVendorByReasonAndTid, activeDisputes, isBookingDisputable]);

  const addAdjustment = useCallback(() => {
    setLocalAdjustments((prev) => [
      ...prev,
      {
        id: `adj-${Date.now()}`,
        nature: "",
        reference: "",
        type: "less",
        amount: 0,
        isPreset: false,
      },
    ]);
  }, []);

  const removeAdjustment = useCallback((id: string) => {
    setLocalAdjustments((prev) => prev.filter((a) => a.id !== id || a.isPreset));
  }, []);

  const updateAdjustment = useCallback((id: string, field: keyof Adjustment, value: string | number | string[]) => {
    const roundedValue = field === "amount" && typeof value === "number" ? Math.round(value * 100) / 100 : value;
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        return { ...a, [field]: roundedValue };
      })
    );
    setValidationError("");
  }, []);

  const [isLoggingDisputes, setIsLoggingDisputes] = useState(false);

  const handleLogDisputes = useCallback(async () => {
    if (!runId) return;
    
    setIsLoggingDisputes(true);
    try {
      const newDisputes: Array<{
        bookingId: string;
        disputeAmount: number;
        currency: string;
        billingEntityId: string;
        billingEntityName: string;
        ticketId: string;
        tid: string;
        reconciledNet: number;
      }> = [];
      const removedDisputes: string[] = [];

      for (const booking of bookings) {
        const wasDisputed = originalDisputes.has(booking.bookingId);
        const isNowDisputed = activeDisputes.has(booking.bookingId);
        const currentAmount = disputeAmounts.get(booking.bookingId) || 0;
        const originalAmount = originalDisputes.get(booking.bookingId) || 0;

        if (isNowDisputed && (!wasDisputed || currentAmount !== originalAmount)) {
          const selection = localSelections[booking.bookingId] || "sp";
          const reconciledNet = selection === "ho" ? booking.hoNet : booking.spNet;
          newDisputes.push({
            bookingId: booking.bookingId,
            disputeAmount: currentAmount,
            currency: booking.currency,
            billingEntityId: booking.beId || "",
            billingEntityName: booking.billingEntityName || "",
            ticketId: booking.ticketId || "",
            tid: booking.tid || "",
            reconciledNet,
          });
        } else if (wasDisputed && !isNowDisputed) {
          removedDisputes.push(booking.bookingId);
        }
      }

      if (newDisputes.length > 0) {
        await apiRequest("POST", `/api/disputes/${runId}`, { disputes: newDisputes });
        toast({
          title: "Dispute Created",
          description: `${newDisputes.length} dispute(s) logged to the Dispute Tracker.`,
        });
      }
      
      if (removedDisputes.length > 0) {
        await apiRequest("DELETE", `/api/disputes/${runId}/bulk`, { bookingIds: removedDisputes });
      }
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
      
      setOriginalDisputes(new Map(disputeAmounts));
    } catch (error) {
      console.error("Failed to log disputes:", error);
      toast({
        title: "Error",
        description: "Failed to log disputes. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoggingDisputes(false);
    }
  }, [runId, disputeAmounts, originalDisputes, bookings, activeDisputes, localSelections, toast]);

  const toggleIssueSelection = useCallback((reason: string, tid: string) => {
    const issueKey = `${reason}:${tid}`;
    setSelectedIssues(prev => {
      const newSet = new Set(prev);
      if (newSet.has(issueKey)) {
        newSet.delete(issueKey);
      } else {
        newSet.add(issueKey);
      }
      return newSet;
    });
  }, []);

  const handleLogIssues = useCallback(async () => {
    if (!runId || selectedIssues.size === 0) return;
    
    setIsLoggingIssues(true);
    try {
      const issuesByReason = new Map<string, { reason: string; bookings: BookingForPayable[]; driTeam: string }>();
      
      const selectedArray = Array.from(selectedIssues);
      for (const issueKey of selectedArray) {
        const [reason, tid] = issueKey.split(":");
        const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
        if (tidBookings.length === 0) continue;
        
        const matchingRows = allRows.filter(r => r.reason === reason);
        const driTeam = matchingRows.find(r => 
          tidBookings.some(b => b.bookingId === r.bookingId)
        )?.driTeam || matchingRows[0]?.driTeam || "Unknown";
        
        if (!issuesByReason.has(reason)) {
          issuesByReason.set(reason, { reason, bookings: [], driTeam });
        }
        issuesByReason.get(reason)!.bookings.push(...tidBookings);
      }
      
      const issuesArray = Array.from(issuesByReason.values());
      for (const { reason, bookings, driTeam } of issuesArray) {
        if (bookings.length === 0) continue;
        
        const firstBooking = bookings[0];
        const discrepancyLocal = bookings.reduce((sum: number, b: BookingForPayable) => sum + Math.abs(b.hoNet - b.spNet), 0);
        const discrepancyUsd = bookings.reduce((sum: number, b: BookingForPayable) => {
          const matchingRow = allRows.find(r => r.bookingId === b.bookingId);
          return sum + Math.abs(matchingRow?.differenceUsd || 0);
        }, 0);

        await apiRequest("POST", "/api/issues", {
          runId,
          billingEntityId: firstBooking.beId || "",
          billingEntityName: firstBooking.billingEntityName || firstBooking.beId || "",
          currency,
          discrepancyLocal,
          discrepancyUsd,
          reason,
          driTeam,
          bookingIds: bookings.map((b: BookingForPayable) => b.bookingId),
          paymentMethod: firstBooking.paymentMethod || undefined,
          errorBucket: reason,
        });
      }

      toast({
        title: "Issues Logged",
        description: `${issuesByReason.size} issue(s) logged to the Issue Tracker.`,
      });

      setSelectedIssues(new Set());
      await queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
    } catch (error) {
      console.error("Failed to log issues:", error);
      toast({
        title: "Error",
        description: "Failed to log issues. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoggingIssues(false);
    }
  }, [runId, selectedIssues, bookingsByReasonAndTid, allRows, currency, toast]);

  const handleApply = useCallback(async () => {
    setValidationError("");
    
    if (!allVendorIdsComplete) {
      setValidationError("All Final Vendor IDs must be set before applying. Check Secondary Vendor section and any payment method mismatch bookings.");
      return;
    }

    const manualAdjustments = localAdjustments.filter(a => !a.isPreset);
    for (const adj of manualAdjustments) {
      if (!adj.nature.trim() || !adj.reference.trim() || adj.amount === 0) {
        setValidationError("Please fill in all fields (Nature, Reference No, Amount) for manually added adjustment rows before applying.");
        return;
      }
    }
    
    // Convert Already Reconciled decisions into adjustment entries
    // For "dont_pay" decisions, we deduct the full SP Net
    // For "pay" with modified finalAmount, we record the difference
    const alreadyReconciledAdjustmentEntries: Adjustment[] = [];
    alreadyReconciledBookings.forEach((booking) => {
      const decision = alreadyReconciledDecisions.get(booking.bookingId);
      if (decision) {
        const reasonLabel = decision.reason || decision.customReason || "No reason";
        if (decision.decision === "dont_pay") {
          // Deduct the full SP Net amount
          alreadyReconciledAdjustmentEntries.push({
            id: `ar-${booking.bookingId}`,
            nature: `Already Reconciled - Don't Pay`,
            reference: `${booking.bookingId} - ${reasonLabel}`,
            type: "less",
            amount: Math.abs(booking.spNet),
            isPreset: true,
          });
        } else if (decision.decision === "pay" && decision.finalAmount !== booking.spNet) {
          // Record the difference from SP Net
          const diff = decision.finalAmount - booking.spNet;
          alreadyReconciledAdjustmentEntries.push({
            id: `ar-${booking.bookingId}`,
            nature: `Already Reconciled - Adjusted`,
            reference: `${booking.bookingId} - ${reasonLabel}`,
            type: diff >= 0 ? "add" : "less",
            amount: Math.abs(diff),
            isPreset: true,
          });
        }
      }
    });
    
    // Combine regular adjustments with Already Reconciled adjustments
    const allAdjustments = [...localAdjustments, ...alreadyReconciledAdjustmentEntries];
    
    // Store pending data and show confirmation dialog
    setPendingApplyData({
      adjustments: allAdjustments,
      selections: localSelections,
      amount: finalAmount,
    });
    setShowApplyConfirmation(true);
  }, [localAdjustments, localSelections, finalAmount, alreadyReconciledDecisions, alreadyReconciledBookings, allVendorIdsComplete]);

  const handleConfirmApply = useCallback(async () => {
    if (!pendingApplyData) return;
    
    setShowApplyConfirmation(false);
    onApply(pendingApplyData.adjustments, pendingApplyData.selections, pendingApplyData.amount);
    setPendingApplyData(null);
    setIsConfirmed(true);
  }, [pendingApplyData, onApply]);

  const handleCancelApply = useCallback(() => {
    setShowApplyConfirmation(false);
    setPendingApplyData(null);
  }, []);

  const handleExportExcel = useCallback(async () => {
    if (!runId) {
      toast({
        title: "No data to export",
        description: "Please run a reconciliation first",
        variant: "destructive",
      });
      return;
    }
    if (!allVendorIdsComplete) {
      toast({
        title: "Vendor IDs incomplete",
        description: "All secondary vendor and payment mismatch bookings must have a Final Vendor ID before exporting.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsExporting(true);
      toast({
        title: "Generating export…",
        description: "Please wait while the export file is being prepared",
      });

      const financialResponse = await fetch(`/api/runs/${runId}/export/financial`);
      if (!financialResponse.ok) {
        const errData = await financialResponse.json().catch(() => null);
        throw new Error(errData?.error || "Failed to generate export");
      }

      const timestamp = new Date().toISOString().slice(0, 10);

      const financialBlob = await financialResponse.blob();
      const financialUrl = window.URL.createObjectURL(financialBlob);
      const a = document.createElement("a");
      a.href = financialUrl;
      a.download = `financial_report_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(financialUrl);
      document.body.removeChild(a);

      toast({
        title: "Export complete",
        description: "Your reconciliation report has been downloaded",
      });
    } catch (error) {
      console.error("Export error:", error);
      const msg = error instanceof Error ? error.message : "Failed to generate export file";
      toast({
        title: "Export failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }, [runId, toast, allVendorIdsComplete]);

  const handleExportGSheet = useCallback(async () => {
    if (!runId) {
      toast({
        title: "No data to export",
        description: "Please run a reconciliation first",
        variant: "destructive",
      });
      return;
    }
    if (!allVendorIdsComplete) {
      toast({
        title: "Vendor IDs incomplete",
        description: "All secondary vendor and payment mismatch bookings must have a Final Vendor ID before exporting.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsExporting(true);
      toast({
        title: "Creating Google Sheet…",
        description: "Please wait while the spreadsheet is being created",
      });

      const response = await authFetch(`/api/runs/${runId}/export-gsheet/financial`, { method: "POST" });
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || "Failed to create Google Sheet");
      }
      const data = await response.json();
      if (data.spreadsheetUrl) setGSheetUrl(data.spreadsheetUrl);
      toast({
        title: "Google Sheet ready",
        description: "Click the link below to open it",
      });
    } catch (error) {
      console.error("Export error:", error);
      const msg = error instanceof Error ? error.message : "Failed to create Google Sheet";
      toast({
        title: "Export failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }, [runId, toast, allVendorIdsComplete]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          <div className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Reconciled</span>
                <Badge variant="secondary" className="text-xs">{reconciledBookings.length}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">
                  Bal: <span className="font-mono font-semibold text-foreground">{formatCurrency(reconciledBookings.reduce((s, b) => s + (b.spNet - (b.amountPaid || 0)), 0))}</span>
                </span>
                <span className="text-sm font-mono font-semibold" data-testid="text-reconciled-total">
                  {formatCurrency(reconciledTotal)} {currency}
                </span>
              </div>
            </div>
          </div>

          {/* Already Reconciled Bookings Section - Collapsible */}
          {alreadyReconciledBookings.length > 0 && (
            <Collapsible
              open={isAlreadyReconciledExpanded}
              onOpenChange={setIsAlreadyReconciledExpanded}
            >
              <div className="border rounded-lg overflow-hidden">
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/30 cursor-pointer hover-elevate">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6" tabIndex={-1} aria-label={isAlreadyReconciledExpanded ? "Collapse Already Reconciled" : "Expand Already Reconciled"}>
                        {isAlreadyReconciledExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                      <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium">Already Reconciled</span>
                      <Badge variant="secondary" className="text-xs">
                        {alreadyReconciledBookings.length}
                      </Badge>
                      {(() => {
                        const sameBECount = alreadyReconciledBookings.filter(b => b.reason.includes("Same")).length;
                        const diffBECount = alreadyReconciledBookings.length - sameBECount;
                        return (
                          <>
                            {sameBECount > 0 && <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">Same BE: {sameBECount}</Badge>}
                            {diffBECount > 0 && <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200">Diff BE: {diffBECount}</Badge>}
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground">
                        Bal: <span className="font-mono font-semibold text-foreground">{formatCurrency(alreadyReconciledBookings.reduce((s, b) => {
                          const d = alreadyReconciledDecisions.get(b.bookingId);
                          const tap = d?.decision === "pay" ? d.finalAmount : 0;
                          return s + (tap - (b.amountPaid || 0));
                        }, 0))}</span>
                      </span>
                      <span className="font-mono text-sm">
                        {formatCurrency(alreadyReconciledTotal)} {currency}
                      </span>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t px-4 py-3">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        <span className="font-semibold text-foreground">
                          {alreadyReconciledBookings.filter(b => {
                            const d = alreadyReconciledDecisions.get(b.bookingId);
                            return !d || (d.decision === "pay" && d.finalAmount === 0);
                          }).length}
                        </span>{" "}zeroed out
                      </span>
                      <span>
                        <span className="font-semibold text-foreground">
                          {alreadyReconciledBookings.filter(b => {
                            const d = alreadyReconciledDecisions.get(b.bookingId);
                            return d?.decision === "pay" && d.finalAmount > 0;
                          }).length}
                        </span>{" "}kept payable
                      </span>
                      <span>
                        <span className="font-semibold text-foreground">
                          {alreadyReconciledBookings.filter(b => alreadyReconciledDecisions.get(b.bookingId)?.decision === "dont_pay").length}
                        </span>{" "}don't pay
                      </span>
                      <span className="ml-auto text-xs">
                        Open workspace to review and action individual bookings.
                      </span>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Cancellations Section - Collapsible */}
          {cancellationBookings.length > 0 && (
            <Collapsible 
              open={isCancellationsExpanded}
              onOpenChange={setIsCancellationsExpanded}
            >
              <div className="border rounded-lg overflow-hidden">
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/30 cursor-pointer hover-elevate">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={isCancellationsExpanded ? "Collapse Cancellations" : "Expand Cancellations"}>
                        {isCancellationsExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Cancellations</span>
                      <Badge variant="secondary" className="text-xs">
                        {cancellationBookings.length}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground">
                        Bal: <span className="font-mono font-semibold text-foreground">{formatCurrency(cancellationBookings.reduce((s, b) => s + (getFinalNetPrice(b) - (b.amountPaid || 0)), 0))}</span>
                      </span>
                      <span className="font-mono text-sm">
                        {formatCurrency(Math.abs(cancellationsTotal))} {currency}
                      </span>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t overflow-x-auto max-h-[480px]">
                    <Table className="text-xs w-full min-w-[1100px]">
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="h-8 bg-muted/80 backdrop-blur-sm">
                          <TableHead className="py-1 text-xs font-semibold bg-muted/80">Sub Category</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">Cancellable</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">SP Net</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">HO Net</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">Canc. Insurance</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">Charge Loss</TableHead>
                          <TableHead className="py-1 text-xs font-semibold bg-muted/80">Result (Sub-category)</TableHead>
                          <TableHead className="py-1 text-xs font-semibold bg-muted/80">Action Point</TableHead>
                          <TableHead className="py-1 text-xs font-semibold bg-muted/80">DRI Team</TableHead>
                          <TableHead className="py-1 text-xs font-semibold bg-muted/80">Fulfillment</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-right bg-muted/80">BID Count</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">Start Date</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-center bg-muted/80">End Date</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-right bg-muted/80">Total BIDs</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-right bg-muted/80">Disc. ({currency})</TableHead>
                          <TableHead className="py-1 text-xs font-semibold text-right bg-muted/80">Disc. (USD)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const ORDER = ["Cancelled-OK", "Cancelled-Refund OK", "Cancelled-SP error", "Cancelled-Insured Booking", "Cancelled-DSS policy", "Cancelled-Check for Charge loss"];
                          const uniqueReasons = Array.from(new Set(cancellationSummaryRows.map(r => r.reason)));
                          uniqueReasons.sort((a, b) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)));
                          const reasonGroupIndex = new Map(uniqueReasons.map((r, i) => [r, i]));
                          const seenReasons = new Set<string>();

                          return cancellationSummaryRows.map((row, idx) => {
                            const cond = CANCELLATION_CONDITIONS[row.reason];
                            const actionPoint = CANCELLATION_ACTION_POINTS[row.reason] || "—";
                            const driTeam = getCancellationDriTeam(row.reason, row.fulfillmentMethod);
                            const isNoAction = ["Cancelled-OK", "Cancelled-Refund OK", "Cancelled-Insured Booking", "Cancelled-DSS policy"].includes(row.reason);
                            const isDebitNote = row.reason === "Cancelled-SP error";
                            const groupIdx = reasonGroupIndex.get(row.reason) ?? 0;
                            const isOddGroup = groupIdx % 2 === 1;
                            const isSplit = CANCELLATION_FULFILLMENT_SPLIT.has(row.reason);
                            const isFirstForReason = !seenReasons.has(row.reason);
                            seenReasons.add(row.reason);

                            return (
                              <TableRow
                                key={`${row.reason}-${row.fulfillmentMethod}-${idx}`}
                                className={`h-8 hover:bg-primary/5 ${isOddGroup ? "bg-muted/20" : ""}`}
                              >
                                <TableCell className="py-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-xs">{row.reason.replace("Cancelled-", "")}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{isFirstForReason ? (cond?.cancellable ?? "—") : ""}</TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{isFirstForReason ? (cond?.spNet ?? "—") : ""}</TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{isFirstForReason ? (cond?.hoNet ?? "—") : ""}</TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{isFirstForReason ? (cond?.cancellationInsurance ?? "—") : ""}</TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{isFirstForReason ? (cond?.chargeLoss ?? "—") : ""}</TableCell>
                                <TableCell className="py-1">
                                  {isFirstForReason && (
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] px-1.5 whitespace-nowrap ${isNoAction ? "border-green-500 text-green-700 dark:text-green-400" : isDebitNote ? "border-orange-500 text-orange-700 dark:text-orange-400" : "border-blue-500 text-blue-700 dark:text-blue-400"}`}
                                    >
                                      {row.reason}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="py-1 text-xs text-muted-foreground max-w-[180px]">
                                  {isFirstForReason && <span title={actionPoint} className="truncate block">{actionPoint}</span>}
                                </TableCell>
                                <TableCell className="py-1">
                                  {driTeam === "N/A" ? (
                                    <span className="text-xs text-muted-foreground">N/A</span>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px] px-1.5">{driTeam}</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="py-1 text-xs text-muted-foreground max-w-[120px]">
                                  <span title={row.fulfillmentMethod} className="truncate block">{row.fulfillmentMethod}</span>
                                </TableCell>
                                <TableCell className="py-1 text-right font-mono">{row.bidCount}</TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{formatCancDate(row.startDate)}</TableCell>
                                <TableCell className="py-1 text-center font-mono text-muted-foreground">{formatCancDate(row.endDate)}</TableCell>
                                <TableCell className="py-1 text-right font-mono text-muted-foreground">
                                  {isSplit ? (isFirstForReason ? row.totalBIDs : <span className="text-muted-foreground/40">—</span>) : row.totalBIDs}
                                </TableCell>
                                <TableCell className={`py-1 text-right font-mono font-semibold ${row.discrepancyLC > 0 ? "text-green-700 dark:text-green-400" : row.discrepancyLC < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                                  {row.discrepancyLC > 0 ? "+" : ""}{formatCurrency(row.discrepancyLC)}
                                </TableCell>
                                <TableCell className={`py-1 text-right font-mono ${row.discrepancyUSD > 0 ? "text-green-700 dark:text-green-400" : row.discrepancyUSD < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                                  {row.discrepancyUSD > 0 ? "+" : ""}{formatCurrency(row.discrepancyUSD)}
                                </TableCell>
                              </TableRow>
                            );
                          });
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                  {(() => {
                    const cancMismatchBookings = cancellationBookings.filter(b => hasPaymentMismatch(b));
                    if (cancMismatchBookings.length === 0) return null;
                    return (
                      <div className="border-t p-2 space-y-1">
                        <div className="flex items-center gap-2 px-1 py-0.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            {cancMismatchBookings.length} booking(s) with payment method mismatch — assign Final Vendor ID
                          </span>
                        </div>
                        {cancMismatchBookings.map(b => (
                          <div key={`canc-vid-${b.bookingId}`} className="flex items-center gap-2 px-2 py-1 rounded bg-violet-50/40 dark:bg-violet-950/20">
                            <span className="text-[10px] font-mono text-muted-foreground w-24 truncate" title={b.bookingId}>{b.bookingId}</span>
                            {dominantPaymentMethod && b.paymentMethod && (
                              <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700 dark:text-violet-300">
                                {b.paymentMethod} → {dominantPaymentMethod}
                              </Badge>
                            )}
                            <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium whitespace-nowrap">Final Vendor ID:</span>
                            <Input
                              type="text"
                              className="h-5 text-[10px] w-32 font-mono border-violet-200 dark:border-violet-800 bg-white dark:bg-background"
                              placeholder="Enter Vendor ID"
                              value={finalVendorIds.get(b.bookingId) || ""}
                              onChange={(e) => updateVendorId(b.bookingId, e.target.value)}
                              onBlur={() => saveVendorCorrection(b.bookingId, finalVendorIds.get(b.bookingId) || "")}
                              onKeyDown={(e) => { if (e.key === "Enter") saveVendorCorrection(b.bookingId, finalVendorIds.get(b.bookingId) || ""); }}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`input-vendor-id-canc-${b.bookingId}`}
                            />
                            {finalVendorIds.get(b.bookingId)?.trim() ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {discrepancyBookings.length > 0 && (
            <div className="space-y-3">
              {Object.entries(bookingsByReasonAndTid).map(([reason, tidGroups]) => {
                  const reasonBookings = bookingsByReason[reason] || [];
                  const reasonTotal = getReasonTotal(reason);
                  const tidKey = (tid: string) => `${reason}:${tid}`;

                  return (
                    <Collapsible
                      key={reason}
                      open={expandedReasons.has(reason)}
                      onOpenChange={() => toggleReason(reason)}
                    >
                      <div className="border rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                          <div className="flex items-center gap-2">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={expandedReasons.has(reason) ? `Collapse ${reason}` : `Expand ${reason}`}>
                                {expandedReasons.has(reason) ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                            <Button
                              variant="ghost"
                              className="p-0 h-auto text-sm font-medium"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReasonModal(reason);
                              }}
                              data-testid={`button-view-reason-${reason}`}
                            >
                              {reason}
                              <Eye className="h-3 w-3 ml-1 opacity-50" />
                            </Button>
                            <Badge variant="secondary" className="text-xs">
                              {reasonBookings.length}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-muted-foreground">
                              Bal: <span className="font-mono font-semibold text-foreground">{formatCurrency(reasonBookings.reduce((s, b) => s + (getFinalNetPrice(b) - (b.amountPaid || 0)), 0))}</span>
                            </span>
                            <span className="font-mono text-sm font-semibold">
                              {formatCurrency(reasonTotal)} {currency}
                            </span>
                          </div>
                        </div>

                        <CollapsibleContent>
                          <div className="max-h-80 overflow-y-auto space-y-1.5 p-1.5">
                            {Object.entries(tidGroups).map(([tid, tidBookings]) => {
                              const tidKeyStr = `${reason}:${tid}`;
                              const isTidExpanded = expandedTids.has(tidKeyStr);
                              return (
                                <div key={tid} className="border-t first:border-t-0">
                                  <div
                                    className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-muted/40 transition-colors"
                                    onClick={() => toggleTid(tidKeyStr)}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {isTidExpanded ? <ChevronDown className="h-3 w-3 text-primary shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                                      <span className="font-mono text-xs shrink-0">{tid}</span>
                                      <span className="font-mono text-xs text-muted-foreground shrink-0">({tidBookings.length})</span>
                                      {(() => { const en = tidBookings.find(b => b.experienceName)?.experienceName; return en ? <span className="font-mono text-xs truncate max-w-[750px]" title={en}>· {en}</span> : null; })()}
                                      {isTidFullyActioned(tidBookings) && (
                                        <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" data-testid={`tid-actioned-canc-${tid}`} />
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                                      {(() => { const hoT = tidBookings.reduce((s, b) => s + b.hoNet, 0); const spT = tidBookings.reduce((s, b) => s + b.spNet, 0); const pct = hoT !== 0 ? ((hoT - spT) / hoT) * 100 : null; return pct !== null ? <span className="font-mono text-xs text-muted-foreground">({pct.toFixed(2)}%)</span> : null; })()}
                                      <span className="font-mono text-amber-600 dark:text-amber-400 text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                                      </span>
                                    </div>
                                  </div>
                                  {isTidExpanded && (
                                    <div className="px-1 pb-1">
                                    <Table className="text-xs table-fixed">
                                      <TableHeader>
                                        <TableRow className="h-7">
                                          <TableHead className="py-1 text-xs w-[18%]">Booking ID</TableHead>
                                          <TableHead className="py-1 text-xs text-right w-[12%]">HO Net</TableHead>
                                          <TableHead className="py-1 text-xs text-right w-[12%]">SP Net</TableHead>
                                          <TableHead className="py-1 text-xs text-center w-[12%]">Net</TableHead>
                                          <TableHead className="py-1 text-xs text-center w-[10%]">Dispute</TableHead>
                                          <TableHead className="py-1 text-xs text-center w-[15%]">Amt Payable</TableHead>
                                          <TableHead className="py-1 text-xs text-right w-[13%]">Dispute Amt</TableHead>
                                          <TableHead className="py-1 text-xs text-right w-[15%]">Price Payable</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {tidBookings.map((booking) => {
                                          const currentSelection = localSelections[booking.bookingId] || "sp";
                                          const canDispute = isBookingDisputable(booking);
                                          const isDisputed = activeDisputes.has(booking.bookingId);
                                          const maxDispute = getMaxDisputeAmount(booking);
                                          const currentDisputeAmt = disputeAmounts.get(booking.bookingId) ?? maxDispute;
                                          const pricePayable = currentSelection === "ho" ? booking.hoNet : booking.spNet;
                                          return (
                                            <Fragment key={booking.bookingId}>
                                              <TableRow className="h-7">
                                                <TableCell className="py-1 font-mono">{booking.bookingId}</TableCell>
                                                <TableCell className="py-1 text-right font-mono">{formatCurrency(booking.hoNet)}</TableCell>
                                                <TableCell className="py-1 text-right font-mono">{formatCurrency(booking.spNet)}</TableCell>
                                                <TableCell className="text-center">
                                                  {reason === "Unmapped" || lockedBookingIds.has(booking.bookingId) ? (
                                                    <span className={`text-xs font-medium ${lockedBookingIds.has(booking.bookingId) ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`}>{lockedBookingIds.has(booking.bookingId) ? "Locked" : "SP"}</span>
                                                  ) : (
                                                    <Select
                                                      value={currentSelection}
                                                      onValueChange={(v) => updateSelection(booking.bookingId, v as "ho" | "sp", booking)}
                                                    >
                                                      <SelectTrigger 
                                                        className="w-[4.5rem] h-7 text-sm border-dashed text-muted-foreground mx-auto" 
                                                        data-testid={`select-booking-${booking.bookingId}`}
                                                      >
                                                        <SelectValue />
                                                      </SelectTrigger>
                                                      <SelectContent>
                                                        <SelectItem value="ho">HO</SelectItem>
                                                        <SelectItem value="sp">SP</SelectItem>
                                                      </SelectContent>
                                                    </Select>
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                  {canDispute ? (
                                                    <Checkbox
                                                      checked={isDisputed}
                                                      onCheckedChange={() => toggleDispute(booking.bookingId, booking)}
                                                      className="h-4 w-4"
                                                      data-testid={`checkbox-dispute-${booking.bookingId}`}
                                                    />
                                                  ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                  <div className="flex justify-center">
                                                    <Input
                                                      type="number"
                                                      step="0.01"
                                                      value={rawInputValues[booking.bookingId] !== undefined ? rawInputValues[booking.bookingId] : (amountPaidTotals[booking.bookingId] !== undefined ? amountPaidTotals[booking.bookingId] : pricePayable)}
                                                      onChange={(e) => handleAmountPaidTotalChange(booking.bookingId, e.target.value)}
                                                      onBlur={() => handleAmountPaidTotalBlur(booking.bookingId, booking.hoNet, booking.spNet)}
                                                      disabled={lockedBookingIds.has(booking.bookingId)}
                                                      className={`w-20 h-6 text-xs font-mono text-right px-1 ${lockedBookingIds.has(booking.bookingId) ? 'cursor-not-allowed opacity-60 border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-950/30' : amountPaidTotals[booking.bookingId] !== undefined ? 'cursor-text border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30' : 'cursor-text border-dashed border-muted-foreground/30'}`}
                                                      data-testid={`input-total-payable-${booking.bookingId}`}
                                                    />
                                                  </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  {canDispute && isDisputed ? (
                                                    <div className="flex flex-col items-end">
                                                      <Input
                                                        type="number"
                                                        step="0.01"
                                                        value={currentDisputeAmt}
                                                        onChange={(e) => updateDisputeAmount(booking.bookingId, parseFloat(e.target.value) || 0, booking)}
                                                        className={`w-20 h-5 text-xs font-mono px-1 text-right ${disputeErrors.has(booking.bookingId) ? 'border-red-500' : ''}`}
                                                        data-testid={`input-dispute-amount-${booking.bookingId}`}
                                                      />
                                                      {disputeErrors.has(booking.bookingId) && (
                                                        <span className="text-[10px] text-red-500">{disputeErrors.get(booking.bookingId)}</span>
                                                      )}
                                                    </div>
                                                  ) : (
                                                    <span className="text-xs text-muted-foreground font-mono">-</span>
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-semibold">
                                                  {formatCurrency(getFinalNetPrice(booking))}
                                                </TableCell>
                                              </TableRow>
                                              {hasPaymentMismatch(booking) && (
                                                <TableRow className="h-7 bg-violet-50/50 dark:bg-violet-950/20">
                                                  <TableCell colSpan={8} className="py-1">
                                                    <div className="flex items-center gap-2">
                                                      <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700 dark:text-violet-300">
                                                        {booking.paymentMethod} → {dominantPaymentMethod}
                                                      </Badge>
                                                      <span className="text-[10px] text-muted-foreground">Final Vendor ID:</span>
                                                      <Input
                                                        className="h-5 text-[10px] font-mono w-28 px-1"
                                                        placeholder="Vendor ID"
                                                        value={finalVendorIds.get(booking.bookingId) || ""}
                                                        onChange={e => {
                                                          const val = e.target.value;
                                                          setFinalVendorIds(prev => { const n = new Map(prev); n.set(booking.bookingId, val); return n; });
                                                        }}
                                                        onBlur={() => { const val = finalVendorIds.get(booking.bookingId) || ""; saveVendorCorrection(booking.bookingId, val); }}
                                                        onKeyDown={e => { if (e.key === "Enter") { const val = finalVendorIds.get(booking.bookingId) || ""; saveVendorCorrection(booking.bookingId, val); } }}
                                                        data-testid={`input-vendor-id-${booking.bookingId}`}
                                                      />
                                                      {finalVendorIds.has(booking.bookingId) && finalVendorIds.get(booking.bookingId)!.trim() && (
                                                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                                                      )}
                                                    </div>
                                                  </TableCell>
                                                </TableRow>
                                              )}
                                            </Fragment>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}

              {selectedIssues.size > 0 && (
                <div className="flex justify-end items-center pt-3 mt-3 border-t gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleLogIssues}
                      disabled={isLoggingIssues}
                      className="h-7 text-xs"
                      data-testid="button-log-issues"
                    >
                      <FileWarning className="h-3 w-3 mr-1" />
                      {isLoggingIssues ? "Logging…" : `Log Issues (${selectedIssues.size})`}
                    </Button>
                </div>
              )}
            </div>
          )}

          {/* Secondary Vendor Section - Full Interactive (BE ID Mismatch) */}
          {secondaryVendorBookings.length > 0 && (
            <div className="space-y-3 pt-4 mt-4 border-t-2 border-dashed">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                  <p className="text-base font-semibold">
                    Secondary Vendor (BE ID Mismatch)
                  </p>
                  <Badge variant="outline">
                    {secondaryVendorBookings.length} bookings
                  </Badge>
                </div>
                <p className="text-lg font-bold font-mono" data-testid="text-secondary-vendor-total">
                  {formatCurrency(secondaryVendorTotal)} {currency}
                </p>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30 mb-3" data-testid="secondary-vendor-id-input">
                <span className="text-xs font-medium whitespace-nowrap">Final Vendor ID:</span>
                <Input
                  className="h-7 text-xs font-mono max-w-[200px]"
                  placeholder="Enter vendor ID"
                  value={secondaryVendorFinalId}
                  onChange={e => setSecondaryVendorFinalId(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveSecondaryVendorId(); }}
                  data-testid="input-secondary-vendor-id"
                />
                <Button size="sm" className="h-7 text-xs" onClick={saveSecondaryVendorId} disabled={!secondaryVendorFinalId.trim()} data-testid="btn-save-secondary-vendor-id">
                  Apply to All
                </Button>
                {secondaryVendorFinalId.trim() && secondaryVendorBookings.every(b => finalVendorIds.get(b.bookingId) === secondaryVendorFinalId.trim()) && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Applied
                  </Badge>
                )}
              </div>

              {Object.entries(secondaryVendorByReasonAndTid).map(([reason, tidGroups]) => {
                const reasonBookings = secondaryVendorByReason[reason] || [];
                const reasonTotal = getSecondaryVendorReasonTotal(reason);
                const svTidKey = (tid: string) => `sv:${reason}:${tid}`;

                return (
                  <Collapsible
                    key={`sv-${reason}`}
                    open={expandedReasons.has(`sv-${reason}`)}
                    onOpenChange={() => toggleReason(`sv-${reason}`)}
                  >
                    <div className="border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={expandedReasons.has(`sv-${reason}`) ? `Collapse ${reason}` : `Expand ${reason}`}>
                              {expandedReasons.has(`sv-${reason}`) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          <span className="text-sm font-medium">{reason}</span>
                          <Badge variant="secondary" className="text-xs">
                            {reasonBookings.length}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-muted-foreground">
                            Bal: <span className="font-mono font-semibold text-foreground">{formatCurrency(reasonBookings.reduce((s, b) => s + (getFinalNetPrice(b) - (b.amountPaid || 0)), 0))}</span>
                          </span>
                          <span className="font-mono text-sm font-semibold">
                            {formatCurrency(reasonTotal)} {currency}
                          </span>
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className="max-h-80 overflow-y-auto space-y-1.5 p-1.5">
                          {Object.entries(tidGroups).map(([tid, tidBookings]) => {
                            const tidKeyStr = svTidKey(tid);
                            const isTidExpanded = expandedTids.has(tidKeyStr);
                            return (
                              <div key={tid} className="border-t first:border-t-0">
                                <div
                                  className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-muted/40 transition-colors"
                                  onClick={() => toggleTid(tidKeyStr)}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {isTidExpanded ? <ChevronDown className="h-3 w-3 text-primary shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                                    <span className="font-mono text-xs shrink-0">{tid}</span>
                                    <span className="font-mono text-xs text-muted-foreground shrink-0">({tidBookings.length})</span>
                                    {(() => { const en = tidBookings.find(b => b.experienceName)?.experienceName; return en ? <span className="font-mono text-xs truncate max-w-[750px]" title={en}>· {en}</span> : null; })()}
                                    {isTidFullyActioned(tidBookings) && (
                                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" data-testid={`tid-actioned-sv-${tid}`} />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                                    {(() => { const hoT = tidBookings.reduce((s, b) => s + b.hoNet, 0); const spT = tidBookings.reduce((s, b) => s + b.spNet, 0); const pct = hoT !== 0 ? ((hoT - spT) / hoT) * 100 : null; return pct !== null ? <span className="font-mono text-xs text-muted-foreground">({pct.toFixed(2)}%)</span> : null; })()}
                                    <span className="font-mono text-amber-600 dark:text-amber-400 text-xs">
                                      {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                                    </span>
                                  </div>
                                </div>
                                {isTidExpanded && (
                                  <div className="px-1 pb-1">
                                  <Table className="text-xs table-fixed">
                                    <TableHeader>
                                      <TableRow className="h-7">
                                        <TableHead className="py-1 text-xs w-[18%]">Booking ID</TableHead>
                                        <TableHead className="py-1 text-xs text-right w-[12%]">HO Net</TableHead>
                                        <TableHead className="py-1 text-xs text-right w-[12%]">SP Net</TableHead>
                                        <TableHead className="py-1 text-xs text-center w-[12%]">Net</TableHead>
                                        <TableHead className="py-1 text-xs text-center w-[10%]">Dispute</TableHead>
                                        <TableHead className="py-1 text-xs text-center w-[15%]">Amt Payable</TableHead>
                                        <TableHead className="py-1 text-xs text-right w-[13%]">Dispute Amt</TableHead>
                                        <TableHead className="py-1 text-xs text-right w-[15%]">Price Payable</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                    {tidBookings.map((booking) => {
                                      const selection = localSelections[booking.bookingId] || "sp";
                                      const isDisputed = activeDisputes.has(booking.bookingId);
                                      const disputeAmt = disputeAmounts.get(booking.bookingId) || 0;
                                      const pricePayable = reason === "Reconciled" ? booking.spNet : (selection === "ho" ? booking.hoNet : booking.spNet);
                                      const finalNet = getFinalNetPrice(booking);
                                      const canDispute = reason !== "Reconciled" && isBookingDisputable(booking);

                                      return (
                                        <Fragment key={booking.bookingId}>
                                          <TableRow className="h-7">
                                            <TableCell className="py-1 font-mono">{booking.bookingId}</TableCell>
                                            <TableCell className="py-1 text-right font-mono">{formatCurrency(booking.hoNet)}</TableCell>
                                            <TableCell className="py-1 text-right font-mono">{formatCurrency(booking.spNet)}</TableCell>
                                            <TableCell className="text-center">
                                              {reason === "Reconciled" || lockedBookingIds.has(booking.bookingId) ? (
                                                <span className={`text-xs font-medium ${lockedBookingIds.has(booking.bookingId) ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`}>{lockedBookingIds.has(booking.bookingId) ? "Locked" : "SP"}</span>
                                              ) : (
                                                <Select
                                                  value={selection}
                                                  onValueChange={(v) => updateSelection(booking.bookingId, v as "ho" | "sp", booking)}
                                                >
                                                  <SelectTrigger className="w-[4.5rem] h-7 text-sm border-dashed text-muted-foreground mx-auto" data-testid={`select-sv-booking-${booking.bookingId}`}>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="ho">HO</SelectItem>
                                                    <SelectItem value="sp">SP</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-center">
                                              {canDispute ? (
                                                <Checkbox
                                                  checked={isDisputed}
                                                  onCheckedChange={() => toggleDispute(booking.bookingId, booking)}
                                                  className="h-4 w-4"
                                                  data-testid={`checkbox-sv-dispute-${booking.bookingId}`}
                                                />
                                              ) : (
                                                <span className="text-xs text-muted-foreground">-</span>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-center">
                                              <div className="flex justify-center">
                                                <Input
                                                  type="number"
                                                  step="0.01"
                                                  value={rawInputValues[booking.bookingId] !== undefined ? rawInputValues[booking.bookingId] : (amountPaidTotals[booking.bookingId] !== undefined ? amountPaidTotals[booking.bookingId] : pricePayable)}
                                                  onChange={(e) => handleAmountPaidTotalChange(booking.bookingId, e.target.value)}
                                                  onBlur={() => handleAmountPaidTotalBlur(booking.bookingId, booking.hoNet, booking.spNet)}
                                                  disabled={lockedBookingIds.has(booking.bookingId)}
                                                  className={`w-20 h-6 text-xs font-mono text-right px-1 ${lockedBookingIds.has(booking.bookingId) ? 'cursor-not-allowed opacity-60 border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-950/30' : amountPaidTotals[booking.bookingId] !== undefined ? 'cursor-text border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30' : 'cursor-text border-dashed border-muted-foreground/30'}`}
                                                  data-testid={`input-total-payable-${booking.bookingId}`}
                                                />
                                              </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                              {isDisputed ? (
                                                <Input
                                                  type="number"
                                                  step="0.01"
                                                  value={disputeAmt}
                                                  onChange={(e) => updateDisputeAmount(booking.bookingId, parseFloat(e.target.value) || 0, booking)}
                                                  className="h-6 w-20 text-xs font-mono text-right ml-auto"
                                                  data-testid={`input-sv-dispute-${booking.bookingId}`}
                                                />
                                              ) : (
                                                <span className="text-xs text-muted-foreground">-</span>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-semibold">
                                              {formatCurrency(finalNet)}
                                            </TableCell>
                                          </TableRow>
                                        </Fragment>
                                      );
                                    })}
                                    </TableBody>
                                  </Table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}


          {/* Amount Paid & Dispute Settled Section */}
          {amountPaidBookings.length > 0 && (
            <div className="pt-3 mt-3 border-t">
              <Collapsible 
                open={isAmountPaidExpanded}
                onOpenChange={setIsAmountPaidExpanded}
              >
                <div className="border rounded-lg">
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-t-lg cursor-pointer hover-elevate" data-testid="trigger-amount-paid-section">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={isAmountPaidExpanded ? "Collapse Amount Paid" : "Expand Amount Paid"}>
                          {isAmountPaidExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-medium">Amount Paid & Dispute Settled</span>
                        <Badge variant="secondary" className="text-xs">
                          {amountPaidBookings.length}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs text-muted-foreground">
                          Paid: {formatCurrency(amountPaidBookings.reduce((s, b) => s + (b.amountPaid || 0), 0))} {currency}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          Settled: {formatCurrency(amountPaidBookings.reduce((s, b) => s + (b.disputeSettled || 0), 0))} {currency}
                        </span>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t">
                      <div className="flex items-center justify-between px-3 py-1.5 border-b">
                        <Select
                          value=""
                          onValueChange={(v) => updateAmountPaidBulkSelection(v as "ho" | "sp")}
                        >
                          <SelectTrigger className="w-28 h-7 text-xs" data-testid="select-amount-paid-bulk-net">
                            <SelectValue placeholder="Bulk Net" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ho">All HO Net</SelectItem>
                            <SelectItem value="sp">All SP Net</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); setIsAmountPaidModalOpen(true); }}
                          data-testid="btn-manage-disputes"
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1.5" />
                          Manage Disputes
                        </Button>
                      </div>
                      <div className="grid grid-cols-[minmax(100px,1fr)_minmax(80px,1fr)_80px_80px_70px_100px_90px_90px_100px] gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground sticky top-0 z-50 border-b">
                        <div>Booking ID</div>
                        <div>Reason</div>
                        <div className="text-right">HO Net</div>
                        <div className="text-right">SP Net</div>
                        <div className="text-center">Net</div>
                        <div className="text-center">Total Payable</div>
                        <div className="text-right">Amt Paid</div>
                        <div>Dispute Status</div>
                        <div className="text-right">Net Payable</div>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {amountPaidBookings.map((booking) => {
                          const totalPayable = getAmountPaidTotal(booking);
                          const netType = localSelections[booking.bookingId] || "sp";
                          const statusVal = disputeStatusEdits[booking.bookingId] ?? booking.disputeStatus ?? "";
                          const needsVid = hasPaymentMismatch(booking);
                          return (
                            <Fragment key={booking.bookingId}>
                            <div 
                              className="grid grid-cols-[minmax(100px,1fr)_minmax(80px,1fr)_80px_80px_70px_100px_90px_90px_100px] gap-2 px-3 py-1.5 text-xs border-t items-center"
                              data-testid={`amount-paid-row-${booking.bookingId}`}
                            >
                              <div className="font-mono truncate" title={booking.bookingId}>
                                {booking.bookingId}
                              </div>
                              <div className="truncate" title={booking.reason}>
                                <Badge variant="outline" className="text-xs">
                                  {booking.reason}
                                </Badge>
                              </div>
                              <div className="text-right font-mono">
                                {formatCurrency(booking.hoNet)}
                              </div>
                              <div className="text-right font-mono">
                                {formatCurrency(booking.spNet)}
                              </div>
                              <div className="flex justify-center">
                                {lockedBookingIds.has(booking.bookingId) ? (
                                  <span className="text-xs font-medium text-violet-600 dark:text-violet-400">Locked</span>
                                ) : (
                                  <Select
                                    value={netType}
                                    onValueChange={(v) => {
                                      updateSelection(booking.bookingId, v as "ho" | "sp", booking);
                                    }}
                                  >
                                    <SelectTrigger className="w-[4.5rem] h-7 text-sm" data-testid={`select-net-type-amtpaid-${booking.bookingId}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="ho">HO</SelectItem>
                                      <SelectItem value="sp">SP</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                              <div className="flex justify-center">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={rawInputValues[booking.bookingId] !== undefined ? rawInputValues[booking.bookingId] : (amountPaidTotals[booking.bookingId] !== undefined ? amountPaidTotals[booking.bookingId] : totalPayable)}
                                  onChange={(e) => handleAmountPaidTotalChange(booking.bookingId, e.target.value)}
                                  onBlur={() => handleAmountPaidTotalBlur(booking.bookingId, booking.hoNet, booking.spNet)}
                                  disabled={lockedBookingIds.has(booking.bookingId)}
                                  className={`w-20 h-6 text-xs font-mono text-right px-1 ${lockedBookingIds.has(booking.bookingId) ? 'cursor-not-allowed opacity-60 border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-950/30' : amountPaidTotals[booking.bookingId] !== undefined ? 'cursor-text border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30' : 'cursor-text border-dashed border-muted-foreground/40'}`}
                                  data-testid={`input-total-payable-${booking.bookingId}`}
                                />
                              </div>
                              <div className="text-right font-mono text-blue-600 dark:text-blue-400">
                                {booking.amountPaid != null ? formatCurrency(booking.amountPaid) : "-"}
                              </div>
                              <div>
                                {statusVal ? (
                                  <Badge variant={statusVal === "OPEN" ? "destructive" : "secondary"} className="text-xs">
                                    {statusVal}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </div>
                              <div className="text-right font-mono font-semibold" data-testid={`net-price-payable-${booking.bookingId}`}>
                                {formatCurrency(totalPayable - (booking.amountPaid || 0))}
                              </div>
                            </div>
                            {needsVid && (
                              <div className="flex items-center gap-2 px-3 py-1 bg-violet-50/40 dark:bg-violet-950/20 border-t">
                                {dominantPaymentMethod && booking.paymentMethod && (
                                  <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700 dark:text-violet-300">
                                    {booking.paymentMethod} → {dominantPaymentMethod}
                                  </Badge>
                                )}
                                <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium whitespace-nowrap">Final Vendor ID:</span>
                                <Input
                                  type="text"
                                  className="h-5 text-[10px] w-32 font-mono border-violet-200 dark:border-violet-800 bg-white dark:bg-background"
                                  placeholder="Enter Vendor ID"
                                  value={finalVendorIds.get(booking.bookingId) || ""}
                                  onChange={(e) => updateVendorId(booking.bookingId, e.target.value)}
                                  onBlur={() => saveVendorCorrection(booking.bookingId, finalVendorIds.get(booking.bookingId) || "")}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveVendorCorrection(booking.bookingId, finalVendorIds.get(booking.bookingId) || ""); }}
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`input-vendor-id-amtpaid-${booking.bookingId}`}
                                />
                                {finalVendorIds.get(booking.bookingId)?.trim() ? (
                                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                                )}
                              </div>
                            )}
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </div>
          )}

          {/* Already Reconciled Summary */}
          {alreadyReconciledBookings.length > 0 && (
            <div className="grid grid-cols-12 items-center gap-2 pt-3 mt-3 border-t">
              <div className="col-span-8 flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm font-medium truncate">Already Reconciled ({alreadyReconciledBookings.length} bookings)</p>
              </div>
              <p className="col-span-4 text-lg font-bold font-mono text-right" data-testid="text-already-reconciled-total">
                {formatCurrency(alreadyReconciledTotal)} {currency}
              </p>
            </div>
          )}

          <div className="grid grid-cols-12 items-center gap-2 pt-3 mt-3 border-t">
            <button 
              type="button"
              className="col-span-8 text-sm font-medium text-foreground hover:text-primary underline-offset-2 hover:underline cursor-pointer flex items-center gap-1 min-w-0 text-left"
              onClick={() => setShowSummaryModal(true)}
              data-testid="button-show-summary"
            >
              <span className="truncate">Payable for bookings reconciled</span>
              <Calculator className="h-3 w-3 opacity-60 shrink-0" />
            </button>
            <p className="col-span-4 text-lg font-bold font-mono text-right" data-testid="text-base-amount">
              {formatCurrency(baseAmount)} {currency}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Adjustments</p>
              <Button
                size="sm"
                variant="outline"
                onClick={addAdjustment}
                data-testid="button-add-adjustment"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Row
              </Button>
            </div>

            {!allVendorIdsComplete && (secondaryVendorBookings.length > 0 || bookings.some(b => hasPaymentMismatch(b))) && (
              <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md flex items-center gap-2" data-testid="vendor-id-warning">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200">Final Vendor IDs must be set for all Secondary Vendor bookings and payment method mismatch bookings before applying.</p>
              </div>
            )}

            {validationError && (
              <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{validationError}</p>
              </div>
            )}

            <div className="grid grid-cols-12 gap-2 px-2 py-1 bg-muted/50 rounded-t-md text-xs font-medium text-muted-foreground">
              <div className="col-span-3">Nature</div>
              <div className="col-span-3">Reference No</div>
              <div className="col-span-2">Add/Less</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2"></div>
            </div>

            <div className="space-y-2 mt-2">
              {localAdjustments.map((adj, index) => {
                const isDisputeAdjustment = adj.nature === "Open Dispute Adjustments";
                const isPreset = adj.isPreset === true;
                
                return (
                  <div
                    key={adj.id}
                    className="grid grid-cols-12 gap-2 items-center"
                    data-testid={`row-adjustment-${index}`}
                  >
                    <div className="col-span-3">
                      {isPreset ? (
                        <div 
                          className="h-8 px-3 flex items-center text-sm bg-muted/50 rounded-md border"
                          data-testid={`text-nature-${index}`}
                        >
                          {adj.nature}
                        </div>
                      ) : (
                        <Input
                          placeholder="Enter nature..."
                          value={adj.nature}
                          onChange={(e) => updateAdjustment(adj.id, "nature", e.target.value)}
                          className="h-8"
                          data-testid={`input-nature-${index}`}
                        />
                      )}
                    </div>

                    <div className="col-span-3">
                      {isDisputeAdjustment ? (
                        <div 
                          className="h-8 px-3 flex items-center text-sm text-muted-foreground bg-muted/50 rounded-md border"
                          data-testid={`text-dispute-ref-${index}`}
                        >
                          From file data
                        </div>
                      ) : (
                        <ScrollArea className="w-full">
                          <Input
                            placeholder="Reference..."
                            value={adj.reference}
                            onChange={(e) => updateAdjustment(adj.id, "reference", e.target.value)}
                            className="h-8"
                            data-testid={`input-reference-${index}`}
                          />
                        </ScrollArea>
                      )}
                    </div>

                    <div className="col-span-2">
                      {isDisputeAdjustment ? (
                        <div className="h-8 px-3 flex items-center text-sm bg-muted/50 rounded-md border">
                          Less
                        </div>
                      ) : (
                        <Select
                          value={adj.type}
                          onValueChange={(v) => updateAdjustment(adj.id, "type", v)}
                        >
                          <SelectTrigger className="h-8" data-testid={`select-type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Add</SelectItem>
                            <SelectItem value="less">Less</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <div className="col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={adj.amount || ""}
                        onChange={(e) => updateAdjustment(adj.id, "amount", parseFloat(e.target.value) || 0)}
                        className={`font-mono h-8 ${isDisputeAdjustment ? "bg-muted" : ""}`}
                        readOnly={isDisputeAdjustment}
                        data-testid={`input-amount-${index}`}
                      />
                    </div>

                    <div className="col-span-2 flex justify-end">
                      {!isPreset && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAdjustment(adj.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          aria-label="Remove adjustment"
                          data-testid={`button-remove-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {openDisputeData.bookingCount > 0 && (
            <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/20">
              <Collapsible open={isOpenDisputeExpanded} onOpenChange={setIsOpenDisputeExpanded}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between cursor-pointer" data-testid="toggle-open-disputes">
                    <div className="flex items-center gap-2">
                      {isOpenDisputeExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <p className="text-sm font-medium">Open Dispute Adjustments</p>
                      <Badge variant="secondary" className="text-xs">{openDisputeData.bookingCount}</Badge>
                    </div>
                    <span className="font-mono font-medium text-amber-700 dark:text-amber-300 text-sm">
                      {formatCurrency(openDisputeData.total)} {currency}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 space-y-3">
                    {openDisputeData.groups.map(group => (
                      <div key={group.beId} className="space-y-1">
                        <div className="flex items-center justify-between px-2">
                          <span className="text-xs font-medium text-muted-foreground">{group.beName}</span>
                          <span className="text-xs font-mono">{formatCurrency(group.total)} {currency} · {group.rows.length} booking(s)</span>
                        </div>
                        <div className="border rounded overflow-hidden overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/30">
                                <TableHead className="text-xs py-1">Booking ID</TableHead>
                                <TableHead className="text-xs py-1">TID</TableHead>
                                <TableHead className="text-xs py-1">Adj In TID</TableHead>
                                <TableHead className="text-xs py-1 text-right">Disputed Amt</TableHead>
                                <TableHead className="text-xs py-1 text-right">Dispute Adj</TableHead>
                                <TableHead className="text-xs py-1 text-right">Adj Total</TableHead>
                                <TableHead className="text-xs py-1 text-right">Final Disc</TableHead>
                                <TableHead className="text-xs py-1 text-right">SP Net</TableHead>
                                <TableHead className="text-xs py-1 text-right">HO Net</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.rows.map(row => (
                                <TableRow key={row.bookingId} data-testid={`open-dispute-row-${row.bookingId}`}>
                                  <TableCell className="text-xs font-mono py-1">{row.bookingId}</TableCell>
                                  <TableCell className="text-xs font-mono py-1">{row.tid || "-"}</TableCell>
                                  <TableCell className="text-xs font-mono py-1">{row.adjustedInTicketId || "-"}</TableCell>
                                  <TableCell className="text-xs font-mono py-1 text-right text-amber-700 dark:text-amber-300">
                                    {formatCurrency(row.disputedAmount ?? 0)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono py-1 text-right">
                                    {formatCurrency(row.disputeAdjustment ?? 0)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono py-1 text-right">
                                    {formatCurrency(row.disputeAdjustedTotal ?? 0)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono py-1 text-right">
                                    {formatCurrency(row.finalDiscrepancyTotal ?? 0)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono py-1 text-right">{formatCurrency(row.spNetInHo)}</TableCell>
                                  <TableCell className="text-xs font-mono py-1 text-right">{formatCurrency(row.hoNet)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          <Separator />

          <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
            <p className="text-sm text-muted-foreground mb-1">Final Amount Payable</p>
            <p
              className="text-3xl font-bold font-mono text-primary"
              data-testid="text-final-amount"
            >
              {formatCurrency(finalAmount)} {currency}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Base ({formatCurrency(baseAmount)})
              {localAdjustments.map((adj) => (
                <span key={adj.id}>
                  {adj.type === "add" ? " + " : " - "}
                  {formatCurrency(adj.amount)}
                </span>
              ))}
              {amountPaidNetPayableTotal !== 0 && (
                <span className="text-muted-foreground">
                  {amountPaidNetPayableTotal > 0 ? " + " : " - "}Amt Paid Net Payable ({formatCurrency(Math.abs(amountPaidNetPayableTotal))})
                </span>
              )}
            </p>
            {totalAmountPaid > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Total Amount Already Paid (deducted per booking): <span className="font-mono font-semibold">{formatCurrency(totalAmountPaid)} {currency}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 p-4 border-t flex-shrink-0">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancel
        </Button>
        <Button onClick={handleApply} data-testid="button-apply">
          Apply
        </Button>
        {isConfirmed && (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={isExporting} data-testid="button-export-report-dropdown">
                  {isExporting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Exporting…
                    </span>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Export Report
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-excel">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportGSheet} data-testid="menu-export-gsheet">
                  <SiGooglesheets className="h-4 w-4 mr-2" />
                  Google Sheets
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {gSheetUrl && (
              <a
                href={gSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline underline-offset-2 hover:opacity-80 font-medium"
                data-testid="link-gsheet-amount-payable"
              >
                Open Google Sheet →
              </a>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!selectedReasonModal} onOpenChange={(open) => !open && setSelectedReasonModal(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>
              Discrepancy Analysis: {selectedReasonModal === "MTB" ? "Multiple Tickets Booked" : 
                selectedReasonModal === "NPD" ? "Net Price Discrepancy" :
                selectedReasonModal === "Unmapped" ? "Unmapped Bookings" :
                selectedReasonModal}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {selectedReasonModal && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">TID</TableHead>
                    <TableHead className="font-semibold text-right">Discrepancy USD</TableHead>
                    <TableHead className="font-semibold">Fulfilment Method</TableHead>
                    <TableHead className="font-semibold text-center">Times Charged</TableHead>
                    <TableHead className="font-semibold">Booking Date</TableHead>
                    <TableHead className="font-semibold text-center">BID Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const filteredRows = allRows.filter(r => r.reason === selectedReasonModal);
                    const groupedByTid = new Map<string, typeof filteredRows>();
                    for (const row of filteredRows) {
                      const tid = row.tid || row.bookingId;
                      if (!groupedByTid.has(tid)) {
                        groupedByTid.set(tid, []);
                      }
                      groupedByTid.get(tid)!.push(row);
                    }
                    
                    return Array.from(groupedByTid.entries()).map(([tid, rows]) => {
                      const totalDiscrepancy = rows.reduce((sum, r) => sum + (r.differenceUsd || 0), 0);
                      const firstRow = rows[0];
                      return (
                        <TableRow key={tid}>
                          <TableCell className="font-mono">{tid}</TableCell>
                          <TableCell className={`text-right font-mono ${totalDiscrepancy < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {totalDiscrepancy.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>{firstRow.fulfillmentIdentifier || "-"}</TableCell>
                          <TableCell className="text-center">{rows.length > 1 ? `${rows.length}x` : "1x"}</TableCell>
                          <TableCell>{firstRow.bookingCreationDate || "-"}</TableCell>
                          <TableCell className="text-center">{rows.length}</TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Apply Confirmation Dialog */}
      <Dialog open={showApplyConfirmation} onOpenChange={setShowApplyConfirmation}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Amount Payable</DialogTitle>
            <DialogDescription>
              Do you confirm the amount payable to SP?
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 my-4">
            <p className="text-sm text-muted-foreground">Final Amount Payable</p>
            <p className="text-2xl font-bold font-mono text-primary">
              {formatCurrency(pendingApplyData?.amount || finalAmount)} {currency}
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={handleCancelApply}
              data-testid="button-confirm-no"
            >
              No
            </Button>
            <Button
              onClick={handleConfirmApply}
              data-testid="button-confirm-yes"
            >
              Yes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Calculation Summary Modal */}
      <Dialog open={showSummaryModal} onOpenChange={setShowSummaryModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              Calculation Summary (Base Amount)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Reconciled ({reconciledBookings.length}):</span>
              <span className="font-mono text-sm">{formatCurrency(reconciledTotal)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Discrepancy ({discrepancyBookings.length}):</span>
              <span className="font-mono text-sm">{formatCurrency(discrepancyTotal)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Cancellations ({cancellationBookings.length}):</span>
              <span className="font-mono text-sm">{formatCurrency(Math.abs(cancellationsTotal))}</span>
            </div>
            {secondaryVendorBookings.length > 0 && (
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">Secondary Vendor ({secondaryVendorBookings.length}):</span>
                <span className="font-mono text-sm">{formatCurrency(secondaryVendorTotal)}</span>
              </div>
            )}
            {alreadyReconciledBookings.length > 0 && (
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-muted-foreground">Already Reconciled ({alreadyReconciledBookings.length}):</span>
                <span className="font-mono text-sm">{formatCurrency(alreadyReconciledTotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-4 mt-2 border-t-2 border-primary/20">
              <span className="font-bold text-base">Base Amount:</span>
              <span className="font-mono text-lg font-bold text-primary">{formatCurrency(baseAmount)} {currency}</span>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setShowSummaryModal(false)}
              data-testid="button-close-summary"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Consolidated Manage Disputes Modal */}
      <Dialog open={isAmountPaidModalOpen} onOpenChange={(open) => { if (!open) { 
        if (runId) {
          const overrides: Record<string, { disputeAdj?: number; discrepancyAdj?: number; finalDispute?: number; ticketId?: string; status?: string }> = {};
          for (const b of amountPaidBookings) {
            const hasAnyData = (b.disputedAmount != null && b.disputedAmount !== 0) || 
              (b.disputeAdjustment != null) || (b.discrepancyAmount != null) || 
              (b.disputeStatus != null && b.disputeStatus !== "") ||
              disputeAdjEdits[b.bookingId] !== undefined || discrepancyAdjEdits[b.bookingId] !== undefined ||
              ticketIdEdits[b.bookingId] !== undefined || disputeStatusEdits[b.bookingId] !== undefined;
            if (!hasAnyData) continue;
            const dAdj = disputeAdjEdits[b.bookingId] !== undefined ? disputeAdjEdits[b.bookingId] : (b.disputeAdjustment ?? 0);
            const discAdj = discrepancyAdjEdits[b.bookingId] !== undefined ? discrepancyAdjEdits[b.bookingId] : (b.discrepancyAmount ?? 0);
            const finalD = (b.disputedAmount ?? 0) - dAdj - discAdj;
            const tId = ticketIdEdits[b.bookingId] !== undefined ? ticketIdEdits[b.bookingId] : (b.adjustedInTicketId ?? "");
            const st = disputeStatusEdits[b.bookingId] ?? b.disputeStatus ?? "";
            overrides[b.bookingId] = { disputeAdj: dAdj, discrepancyAdj: discAdj, finalDispute: finalD, ticketId: tId, status: st };
          }
          if (Object.keys(overrides).length > 0) {
            apiRequest("POST", "/api/dispute-overrides", { runId, overrides }).catch(console.error);
          }
        }
        setBulkDisputeAdj(""); setBulkDiscrepancyAdj(""); setBulkTicketId(""); setModalSearchQuery(""); setBulkActionsExpanded(false); setIsAmountPaidModalOpen(false); } }}>
        <DialogContent className="max-w-7xl max-h-[85vh] flex flex-col" data-testid="dialog-manage-disputes">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Manage Disputes & Adjustments
            </DialogTitle>
            <DialogDescription>
              {amountPaidBookings.length} bookings with Amount Paid or Dispute data
            </DialogDescription>
          </DialogHeader>

          {/* Search & Bulk Actions Toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by Booking ID..."
                value={modalSearchQuery}
                onChange={(e) => setModalSearchQuery(e.target.value)}
                className="h-8 text-xs pl-8 cursor-text"
                data-testid="modal-search-booking-id"
              />
              {modalSearchQuery && (
                <button
                  type="button"
                  onClick={() => setModalSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  data-testid="modal-search-clear"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {(() => {
                const filtered = modalSearchQuery
                  ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                  : amountPaidBookings;
                return `${filtered.length} of ${amountPaidBookings.length} bookings`;
              })()}
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkActionsExpanded(!bulkActionsExpanded)}
              data-testid="btn-toggle-bulk-actions"
            >
              {bulkActionsExpanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
              Bulk Actions
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDisputeAdjEdits({});
                setDiscrepancyAdjEdits({});
                setTicketIdEdits({});
                setDisputeStatusEdits({});
                toast({ title: "All edits reset", description: "All fields have been reverted to their original values." });
              }}
              data-testid="bulk-btn-reset-all"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset All
            </Button>
          </div>

          {/* Collapsible Bulk Actions */}
          {bulkActionsExpanded && (
            <div className="flex flex-wrap items-end gap-3 p-3 rounded-md bg-muted/30 border animate-in slide-in-from-top-1 duration-200">
              <div className="flex-1 min-w-[140px]">
                <div className="text-xs text-muted-foreground mb-1">Set All Dispute Status</div>
                <Select
                  value=""
                  onValueChange={(v) => {
                    const updates: Record<string, string> = {};
                    const filtered = modalSearchQuery
                      ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                      : amountPaidBookings;
                    filtered.forEach(b => { updates[b.bookingId] = v; });
                    setDisputeStatusEdits(prev => ({ ...prev, ...updates }));
                    toast({ title: "Status applied", description: `Set to ${v} for ${filtered.length} bookings.` });
                  }}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="bulk-select-dispute-status">
                    <SelectValue placeholder="Apply to all..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">OPEN</SelectItem>
                    <SelectItem value="CLOSED">CLOSED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <div className="text-xs text-muted-foreground mb-1">Set All Dispute Adj</div>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={bulkDisputeAdj}
                    onChange={(e) => setBulkDisputeAdj(e.target.value)}
                    className="h-8 text-xs font-mono text-right cursor-text"
                    data-testid="bulk-input-dispute-adj"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = Math.round((parseFloat(bulkDisputeAdj) || 0) * 100) / 100;
                        if (!isNaN(parseFloat(bulkDisputeAdj))) {
                          const filtered = modalSearchQuery
                            ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                            : amountPaidBookings;
                          const updates: Record<string, number> = {};
                          filtered.forEach(b => { updates[b.bookingId] = val; });
                          setDisputeAdjEdits(prev => ({ ...prev, ...updates }));
                          setBulkDisputeAdj("");
                          toast({ title: "Dispute Adj applied", description: `Set to ${val} for ${filtered.length} bookings.` });
                        }
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const val = Math.round((parseFloat(bulkDisputeAdj) || 0) * 100) / 100;
                      if (!isNaN(parseFloat(bulkDisputeAdj))) {
                        const filtered = modalSearchQuery
                          ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                          : amountPaidBookings;
                        const updates: Record<string, number> = {};
                        filtered.forEach(b => { updates[b.bookingId] = val; });
                        setDisputeAdjEdits(prev => ({ ...prev, ...updates }));
                        setBulkDisputeAdj("");
                        toast({ title: "Dispute Adj applied", description: `Set to ${val} for ${filtered.length} bookings.` });
                      }
                    }}
                    data-testid="bulk-btn-apply-dispute-adj"
                  >
                    Apply
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-w-[140px]">
                <div className="text-xs text-muted-foreground mb-1">Set All Discrepancy Adj</div>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={bulkDiscrepancyAdj}
                    onChange={(e) => setBulkDiscrepancyAdj(e.target.value)}
                    className="h-8 text-xs font-mono text-right cursor-text"
                    data-testid="bulk-input-discrepancy-adj"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = Math.round((parseFloat(bulkDiscrepancyAdj) || 0) * 100) / 100;
                        if (!isNaN(parseFloat(bulkDiscrepancyAdj))) {
                          const filtered = modalSearchQuery
                            ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                            : amountPaidBookings;
                          const updates: Record<string, number> = {};
                          filtered.forEach(b => { updates[b.bookingId] = val; });
                          setDiscrepancyAdjEdits(prev => ({ ...prev, ...updates }));
                          setBulkDiscrepancyAdj("");
                          toast({ title: "Discrepancy Adj applied", description: `Set to ${val} for ${filtered.length} bookings.` });
                        }
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const val = Math.round((parseFloat(bulkDiscrepancyAdj) || 0) * 100) / 100;
                      if (!isNaN(parseFloat(bulkDiscrepancyAdj))) {
                        const filtered = modalSearchQuery
                          ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                          : amountPaidBookings;
                        const updates: Record<string, number> = {};
                        filtered.forEach(b => { updates[b.bookingId] = val; });
                        setDiscrepancyAdjEdits(prev => ({ ...prev, ...updates }));
                        setBulkDiscrepancyAdj("");
                        toast({ title: "Discrepancy Adj applied", description: `Set to ${val} for ${filtered.length} bookings.` });
                      }
                    }}
                    data-testid="bulk-btn-apply-discrepancy-adj"
                  >
                    Apply
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-w-[140px]">
                <div className="text-xs text-muted-foreground mb-1">Set All Ticket ID</div>
                <div className="flex gap-1">
                  <Input
                    type="text"
                    placeholder="Ticket ID"
                    value={bulkTicketId}
                    onChange={(e) => setBulkTicketId(e.target.value)}
                    className="h-8 text-xs font-mono cursor-text"
                    data-testid="bulk-input-ticket-id"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && bulkTicketId) {
                        const filtered = modalSearchQuery
                          ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                          : amountPaidBookings;
                        const updates: Record<string, string> = {};
                        filtered.forEach(b => { updates[b.bookingId] = bulkTicketId; });
                        setTicketIdEdits(prev => ({ ...prev, ...updates }));
                        setBulkTicketId("");
                        toast({ title: "Ticket ID applied", description: `Set to "${bulkTicketId}" for ${filtered.length} bookings.` });
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (bulkTicketId) {
                        const filtered = modalSearchQuery
                          ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                          : amountPaidBookings;
                        const updates: Record<string, string> = {};
                        filtered.forEach(b => { updates[b.bookingId] = bulkTicketId; });
                        setTicketIdEdits(prev => ({ ...prev, ...updates }));
                        const appliedId = bulkTicketId;
                        setBulkTicketId("");
                        toast({ title: "Ticket ID applied", description: `Set to "${appliedId}" for ${filtered.length} bookings.` });
                      }
                    }}
                    data-testid="bulk-btn-apply-ticket-id"
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Data Grid */}
          <div className="flex-1 overflow-auto border rounded-md">
            {/* Column headers */}
            <div className="grid grid-cols-[140px_70px_70px_90px_80px_80px_85px_85px_80px_85px_90px_80px_80px_90px] gap-1.5 px-2 py-1.5 bg-muted/30 text-[11px] font-medium text-muted-foreground sticky top-0 z-20 border-b">
              <div className="sticky left-0 bg-muted/30 z-10">Booking ID</div>
              <div className="text-right">HO Net</div>
              <div className="text-right">SP Net</div>
              <div className="text-right">Total Payable</div>
              <div className="text-right">Amt Paid</div>
              <div className="text-right">Disputed Amt</div>
              <div className="text-right">Disp. Adj Total</div>
              <div className="text-right">Disc. Adj Total</div>
              <div className="text-right">Dispute Adj</div>
              <div className="text-right">Discrepancy Adj</div>
              <div className="text-right">Final Dispute Amt</div>
              <div>Status</div>
              <div className="text-right">Ticket ID</div>
              <div className="text-right">Net Payable</div>
            </div>
            {/* Data rows */}
            {(() => {
              const filteredBookings = modalSearchQuery
                ? amountPaidBookings.filter(b => b.bookingId.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                : amountPaidBookings;
              return filteredBookings.map((booking) => {
                const totalPayable = getAmountPaidTotal(booking);
                const effectiveDisputedAmount = booking.disputedAmount;
                const statusVal = disputeStatusEdits[booking.bookingId] ?? booking.disputeStatus ?? "";
                const currentDisputeAdj = disputeAdjEdits[booking.bookingId] !== undefined ? disputeAdjEdits[booking.bookingId] : (booking.disputeAdjustment ?? 0);
                const currentDiscrepancyAdj = discrepancyAdjEdits[booking.bookingId] !== undefined ? discrepancyAdjEdits[booking.bookingId] : (booking.discrepancyAmount ?? 0);
                const finalDisputeAmt = (booking.disputedAmount ?? 0) - currentDisputeAdj - currentDiscrepancyAdj;
                const hasDisputeAdjEdit = disputeAdjEdits[booking.bookingId] !== undefined;
                const hasDiscrepancyAdjEdit = discrepancyAdjEdits[booking.bookingId] !== undefined;
                const hasTicketIdEdit = ticketIdEdits[booking.bookingId] !== undefined;
                return (
                  <div
                    key={booking.bookingId}
                    className="grid grid-cols-[140px_70px_70px_90px_80px_80px_85px_85px_80px_85px_90px_80px_80px_90px] gap-1.5 px-2 py-1 text-xs border-t items-center transition-colors hover:bg-muted/20"
                    data-testid={`modal-row-${booking.bookingId}`}
                  >
                    <div className="font-mono truncate sticky left-0 bg-background z-10 pr-1" title={booking.bookingId}>
                      {booking.bookingId}
                    </div>
                    <div className="text-right font-mono">{formatCurrency(booking.hoNet)}</div>
                    <div className="text-right font-mono">{formatCurrency(booking.spNet)}</div>
                    <div className="text-right font-mono">{formatCurrency(totalPayable)}</div>
                    <div className="text-right font-mono text-blue-600 dark:text-blue-400">
                      {booking.amountPaid != null ? formatCurrency(booking.amountPaid) : "-"}
                    </div>
                    <div className="text-right font-mono" data-testid={`modal-disputed-amt-${booking.bookingId}`}>
                      {effectiveDisputedAmount != null && effectiveDisputedAmount !== 0 ? formatCurrency(effectiveDisputedAmount) : "-"}
                    </div>
                    <div className="text-right font-mono bg-blue-50/50 dark:bg-blue-950/20 rounded-sm px-0.5" data-testid={`modal-dispute-adj-total-${booking.bookingId}`}>
                      {booking.disputeAdjustedTotal != null && booking.disputeAdjustedTotal !== 0 ? formatCurrency(booking.disputeAdjustedTotal) : "-"}
                    </div>
                    <div className="text-right font-mono bg-blue-50/50 dark:bg-blue-950/20 rounded-sm px-0.5" data-testid={`modal-discrepancy-adj-${booking.bookingId}`}>
                      {booking.finalDiscrepancyTotal != null && booking.finalDiscrepancyTotal !== 0 ? formatCurrency(booking.finalDiscrepancyTotal) : "-"}
                    </div>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        value={disputeAdjEdits[booking.bookingId] !== undefined ? disputeAdjEdits[booking.bookingId] : (booking.disputeAdjustment ?? "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            setDisputeAdjEdits(prev => { const n = { ...prev }; delete n[booking.bookingId]; return n; });
                          } else {
                            const num = Math.round((parseFloat(v) || 0) * 100) / 100;
                            if (!isNaN(parseFloat(v))) setDisputeAdjEdits(prev => ({ ...prev, [booking.bookingId]: num }));
                          }
                        }}
                        placeholder="0"
                        className="h-6 text-[10px] font-mono text-right cursor-text pr-5 bg-amber-50/50 dark:bg-amber-950/20"
                        data-testid={`modal-input-dispute-adj-${booking.bookingId}`}
                      />
                      {hasDisputeAdjEdit && (
                        <button
                          type="button"
                          onClick={() => setDisputeAdjEdits(prev => { const n = { ...prev }; delete n[booking.bookingId]; return n; })}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                          title="Undo edit"
                          data-testid={`modal-undo-dispute-adj-${booking.bookingId}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        value={discrepancyAdjEdits[booking.bookingId] !== undefined ? discrepancyAdjEdits[booking.bookingId] : (booking.discrepancyAmount ?? "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            setDiscrepancyAdjEdits(prev => { const n = { ...prev }; delete n[booking.bookingId]; return n; });
                          } else {
                            const num = Math.round((parseFloat(v) || 0) * 100) / 100;
                            if (!isNaN(parseFloat(v))) setDiscrepancyAdjEdits(prev => ({ ...prev, [booking.bookingId]: num }));
                          }
                        }}
                        placeholder="0"
                        className="h-6 text-[10px] font-mono text-right cursor-text pr-5 bg-amber-50/50 dark:bg-amber-950/20"
                        data-testid={`modal-input-discrepancy-adj-${booking.bookingId}`}
                      />
                      {hasDiscrepancyAdjEdit && (
                        <button
                          type="button"
                          onClick={() => setDiscrepancyAdjEdits(prev => { const n = { ...prev }; delete n[booking.bookingId]; return n; })}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                          title="Undo edit"
                          data-testid={`modal-undo-discrepancy-adj-${booking.bookingId}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className={`text-right font-mono font-semibold ${finalDisputeAmt < 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`modal-final-dispute-amt-${booking.bookingId}`}>
                      {finalDisputeAmt !== 0 ? formatCurrency(finalDisputeAmt) : "-"}
                    </div>
                    <div>
                      <Select
                        value={statusVal}
                        onValueChange={(v) => setDisputeStatusEdits(prev => ({ ...prev, [booking.bookingId]: v }))}
                      >
                        <SelectTrigger className="h-6 text-[10px]" data-testid={`modal-select-dispute-status-${booking.bookingId}`}>
                          <SelectValue placeholder="-" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OPEN">OPEN</SelectItem>
                          <SelectItem value="CLOSED">CLOSED</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="relative">
                      <Input
                        type="text"
                        value={ticketIdEdits[booking.bookingId] !== undefined ? ticketIdEdits[booking.bookingId] : (booking.adjustedInTicketId ?? "")}
                        onChange={(e) => setTicketIdEdits(prev => ({ ...prev, [booking.bookingId]: e.target.value }))}
                        placeholder="-"
                        className="h-6 text-[10px] font-mono cursor-text pr-5"
                        data-testid={`modal-input-ticket-id-${booking.bookingId}`}
                      />
                      {hasTicketIdEdit && (
                        <button
                          type="button"
                          onClick={() => setTicketIdEdits(prev => { const n = { ...prev }; delete n[booking.bookingId]; return n; })}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                          title="Undo edit"
                          data-testid={`modal-undo-ticket-id-${booking.bookingId}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="text-right font-mono font-semibold" data-testid={`modal-net-payable-${booking.bookingId}`}>
                      {formatCurrency(totalPayable - (booking.amountPaid || 0))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Summary Footer */}
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border text-xs">
            <div className="flex flex-wrap gap-4">
              <div>
                <span className="text-muted-foreground">Total Payable: </span>
                <span className="font-mono font-semibold">{formatCurrency(amountPaidBookings.reduce((s, b) => s + getAmountPaidTotal(b), 0))} {currency}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Paid: </span>
                <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{formatCurrency(amountPaidBookings.reduce((s, b) => s + (b.amountPaid || 0), 0))} {currency}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Net Payable: </span>
                <span className="font-mono font-semibold">{formatCurrency(amountPaidBookings.reduce((s, b) => s + (getAmountPaidTotal(b) - (b.amountPaid || 0)), 0))} {currency}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Final Dispute Amt: </span>
                <span className={`font-mono font-semibold ${(() => {
                  const total = amountPaidBookings.reduce((s, b) => {
                    const dAdj = disputeAdjEdits[b.bookingId] !== undefined ? disputeAdjEdits[b.bookingId] : (b.disputeAdjustment ?? 0);
                    const discAdj = discrepancyAdjEdits[b.bookingId] !== undefined ? discrepancyAdjEdits[b.bookingId] : (b.discrepancyAmount ?? 0);
                    return s + ((b.disputedAmount ?? 0) - dAdj - discAdj);
                  }, 0);
                  return total < 0 ? "text-red-600 dark:text-red-400" : "";
                })()}`}>
                  {formatCurrency(amountPaidBookings.reduce((s, b) => {
                    const dAdj = disputeAdjEdits[b.bookingId] !== undefined ? disputeAdjEdits[b.bookingId] : (b.disputeAdjustment ?? 0);
                    const discAdj = discrepancyAdjEdits[b.bookingId] !== undefined ? discrepancyAdjEdits[b.bookingId] : (b.discrepancyAmount ?? 0);
                    return s + ((b.disputedAmount ?? 0) - dAdj - discAdj);
                  }, 0))} {currency}
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Already Reconciled Workspace Dialog */}
      <Dialog open={isArWorkspaceOpen} onOpenChange={setIsArWorkspaceOpen}>
        <DialogContent className="max-w-[92vw] w-[92vw] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden [&>button.absolute]:hidden" data-testid="ar-workspace-dialog">
          <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Already Reconciled — Workspace
              <Badge variant="outline" className="ml-1 text-xs font-normal">{alreadyReconciledBookings.length} bookings</Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => setIsArWorkspaceOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <AlreadyReconciledWorkspace
            bookings={alreadyReconciledBookings.map<ArWorkspaceBooking>(b => ({
              bookingId: b.bookingId,
              tid: b.tid,
              reason: b.reason,
              hoNet: b.hoNet,
              spNet: b.spNet,
              amountPaid: b.amountPaid || 0,
              paymentMethod: b.paymentMethod,
              spPaymentMethod: b.spPaymentMethod,
              hoBeId: b.hoBeId,
              beId: b.beId,
              ticketId: b.ticketId,
            }))}
            runId={runId}
            currency={currency}
            decisions={alreadyReconciledDecisions}
            onDecisionChange={setAlreadyReconciledDecisions}
            activeDisputes={activeDisputes}
            disputeAmounts={disputeAmounts}
            onDisputeChange={(newActive, newAmounts) => {
              setActiveDisputes(newActive);
              setDisputeAmounts(newAmounts);
              if (externalOnArDisputeChange) {
                externalOnArDisputeChange(newActive, newAmounts);
              }
            }}
            billingEntityId={alreadyReconciledBookings[0]?.beId || ""}
            billingEntityName={alreadyReconciledBookings[0]?.billingEntityName || ""}
            hasPaymentMismatchFn={(b) => hasPaymentMismatch(b as BookingForPayable)}
            finalVendorIds={finalVendorIds}
            onVendorIdChange={updateVendorId}
            onVendorIdSave={saveVendorCorrection}
            dominantPaymentMethod={dominantPaymentMethod}
            onClose={() => setIsArWorkspaceOpen(false)}
            showApplyConfirm
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

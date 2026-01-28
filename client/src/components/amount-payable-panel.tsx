import { useState, useCallback, useMemo, useEffect } from "react";
import { Plus, Trash2, Calculator, ChevronDown, ChevronRight, AlertTriangle, Check, X, Eye, FileWarning, Download, Pencil, RotateCcw, XCircle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  PRESET_ADJUSTMENT_NATURES,
  createPresetAdjustments 
} from "./amount-payable-modal";
import type { PrimaryRow } from "@shared/schema";

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
}: AmountPayablePanelProps) {
  const [localAdjustments, setLocalAdjustments] = useState<Adjustment[]>(adjustments);
  const [localSelections, setLocalSelections] = useState<FinalNetSelection>(finalNetSelections);
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  // Collapsible state for grouped sections
  const [isCancellationsExpanded, setIsCancellationsExpanded] = useState(false);
  const [isAlreadyReconciledExpanded, setIsAlreadyReconciledExpanded] = useState(false);
  const [isPaymentMismatchExpanded, setIsPaymentMismatchExpanded] = useState(false);
  // Payment method mismatch: final vendor ID per booking and bulk vendor ID
  const [finalVendorIds, setFinalVendorIds] = useState<Map<string, string>>(new Map());
  const [bulkVendorId, setBulkVendorId] = useState<string>("");
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [originalDisputes, setOriginalDisputes] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);
  const [openDisputes, setOpenDisputes] = useState<Array<{ 
    displayId: string; 
    billingEntityId: string;
    billingEntityName: string;
    totalDisputeAmount: number; 
    bookingCount: number;
    actualDisputeIds: string[];
  }>>([]);
  const [disputeIdMapping, setDisputeIdMapping] = useState<Map<string, string>>(new Map());
  const [spErrorClosedAdjustments, setSpErrorClosedAdjustments] = useState<number>(0);
  // Closed disputes with editable state
  const [closedDisputes, setClosedDisputes] = useState<Array<{
    disputeId: string;
    bookingId: string;
    billingEntityName: string;
    originalAmount: number;
    closedAmount: number;
    closureType: "sp_error" | "ho_error";
    isEditing: boolean;
    editAmount: number;
    editClosureType: "sp_error" | "ho_error";
  }>>([]);
  const [isSavingClosedDispute, setIsSavingClosedDispute] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string>("");
  const [disputeErrors, setDisputeErrors] = useState<Map<string, string>>(new Map());
  const [selectedReasonModal, setSelectedReasonModal] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [isLoggingIssues, setIsLoggingIssues] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<{ 
    displayId: string; 
    billingEntityId: string;
    billingEntityName: string;
    totalDisputeAmount: number; 
    bookingCount: number;
    actualDisputeIds: string[];
  } | null>(null);
  const [closureType, setClosureType] = useState<"sp_error" | "ho_error" | null>(null);
  const [acceptHoError, setAcceptHoError] = useState(false);
  const [isClosingWithHoError, setIsClosingWithHoError] = useState(false);
  const [isClosingWithSpError, setIsClosingWithSpError] = useState(false);
  const [isReopeningDispute, setIsReopeningDispute] = useState<string | null>(null);
  const [editingClosedDispute, setEditingClosedDispute] = useState<string | null>(null);
  const [editClosedDisputeAmount, setEditClosedDisputeAmount] = useState<number>(0);
  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [pendingApplyData, setPendingApplyData] = useState<{
    adjustments: Adjustment[];
    selections: FinalNetSelection;
    amount: number;
  } | null>(null);
  // Booking-level closure state
  const [bookingClosures, setBookingClosures] = useState<Map<string, {
    disputeId: string;
    bookingId: string;
    originalAmount: number;
    adjustmentAmount: number;
    closureType: "sp_error" | "ho_error";
    confirmed: boolean;
  }>>(new Map());
  const [isLoadingBookingDetails, setIsLoadingBookingDetails] = useState(false);
  const [isProcessingClosures, setIsProcessingClosures] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const presets = createPresetAdjustments();
    const customAdjustments = adjustments.filter(a => !a.isPreset);
    setLocalAdjustments([...presets, ...customAdjustments]);
    setLocalSelections(finalNetSelections);
    
    if (runId && !disputesLoaded) {
      fetch(`/api/disputes/${runId}`)
        .then(res => res.json())
        .then(data => {
          const disputes = data.disputes || [];
          const newDisputeAmounts = new Map<string, number>();
          const newActiveDisputes = new Set<string>();
          
          // Only include OPEN disputes in active disputes (not closed ones)
          const openOnlyDisputes = disputes.filter((d: { closureStatus?: string }) => d.closureStatus === "open");
          for (const dispute of openOnlyDisputes) {
            newDisputeAmounts.set(dispute.bookingId, dispute.disputeAmount);
            newActiveDisputes.add(dispute.bookingId);
          }
          
          setDisputeAmounts(newDisputeAmounts);
          setActiveDisputes(newActiveDisputes);
          setOriginalDisputes(new Map(newDisputeAmounts));
          
          // Group ALL disputes by billing entity first (for consistent display ID mapping)
          const allGroupedByBillingEntity = new Map<string, Array<{ id: string; billingEntityId: string; billingEntityName: string; disputeAmount: number; closureStatus: string }>>();
          for (const dispute of disputes) {
            const key = `${dispute.billingEntityId}-${dispute.currency}`;
            if (!allGroupedByBillingEntity.has(key)) {
              allGroupedByBillingEntity.set(key, []);
            }
            allGroupedByBillingEntity.get(key)!.push({
              id: dispute.disputeId,
              billingEntityId: dispute.billingEntityId,
              billingEntityName: dispute.billingEntityName,
              disputeAmount: dispute.disputeAmount,
              closureStatus: dispute.closureStatus || "open",
            });
          }
          
          // Build display ID mapping from ALL disputes and create aggregated open disputes
          const disputeIdToDisplayIdMap = new Map<string, string>();
          const aggregatedDisputes: Array<{ displayId: string; billingEntityId: string; billingEntityName: string; totalDisputeAmount: number; bookingCount: number; actualDisputeIds: string[] }> = [];
          let counter = 1;
          for (const group of Array.from(allGroupedByBillingEntity.values())) {
            if (group.length === 0) continue;
            const first = group[0];
            const displayId = `DID-#${counter}`;
            
            // Map ALL dispute IDs in this group to the display ID
            for (const d of group) {
              disputeIdToDisplayIdMap.set(d.id, displayId);
            }
            
            // Only include OPEN disputes in the aggregated list for display
            const openInGroup = group.filter(d => d.closureStatus === "open");
            if (openInGroup.length > 0) {
              const totalAmount = openInGroup.reduce((sum, d) => sum + d.disputeAmount, 0);
              const roundedTotal = Math.round(totalAmount * 100) / 100;
              aggregatedDisputes.push({
                displayId,
                billingEntityId: first.billingEntityId,
                billingEntityName: first.billingEntityName,
                totalDisputeAmount: roundedTotal,
                bookingCount: openInGroup.length,
                actualDisputeIds: openInGroup.map(d => d.id),
              });
            }
            counter++;
          }
          setOpenDisputes(aggregatedDisputes);
          setDisputeIdMapping(disputeIdToDisplayIdMap);
          
          // Calculate total SP Error closed adjustments and populate closed disputes for editing
          const allClosedDisputes = disputes.filter((d: { closureStatus?: string; closureType?: string }) => 
            d.closureStatus === "closed" && (d.closureType === "sp_error" || d.closureType === "accept_ho_error")
          );
          
          // Map closed disputes for editing
          const closedDisputesForEdit = allClosedDisputes.map((d: { 
            disputeId: string; 
            bookingId: string; 
            billingEntityName: string;
            disputeAmount: number;
            closedByAdjustmentAmount?: number;
            closureType: string;
          }) => ({
            disputeId: d.disputeId,
            bookingId: d.bookingId,
            billingEntityName: d.billingEntityName,
            originalAmount: d.disputeAmount,
            closedAmount: d.closedByAdjustmentAmount ?? d.disputeAmount,
            closureType: (d.closureType === "accept_ho_error" ? "ho_error" : "sp_error") as "sp_error" | "ho_error",
            isEditing: false,
            editAmount: d.closedByAdjustmentAmount ?? d.disputeAmount,
            editClosureType: (d.closureType === "accept_ho_error" ? "ho_error" : "sp_error") as "sp_error" | "ho_error",
          }));
          setClosedDisputes(closedDisputesForEdit);
          
          // Calculate SP Error total from current closedAmount values
          const spErrorTotal = closedDisputesForEdit
            .filter((d: { closureType: string }) => d.closureType === "sp_error")
            .reduce((sum: number, d: { closedAmount: number }) => sum + d.closedAmount, 0);
          setSpErrorClosedAdjustments(spErrorTotal);
          setDisputesLoaded(true);
        })
        .catch(err => {
          console.error("Failed to load existing disputes:", err);
          setDisputeAmounts(new Map());
          setActiveDisputes(new Set());
          setOriginalDisputes(new Map());
          setDisputesLoaded(true);
        });
    }
  }, [runId, disputesLoaded, adjustments, finalNetSelections]);

  const reconciledBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason === "Reconciled"), 
    [bookings]
  );

  // Cancellation reasons to group together
  const cancellationReasons = [
    "Cancelled-SP error",
    "Cancelled-Insured Booking",
    "Cancelled-Check for Charge loss",
    "Cancelled-DSS policy",
  ];

  // Regular discrepancy bookings (excludes cancellations)
  const discrepancyBookings = useMemo(() => 
    (bookings || []).filter(b => 
      b.reason !== "Reconciled" && 
      !b.reason.startsWith("Already Reconciled") && 
      !b.isSecondaryVendor &&
      !cancellationReasons.includes(b.reason)
    ), 
    [bookings]
  );

  // Cancellation bookings grouped separately
  const cancellationBookings = useMemo(() => 
    (bookings || []).filter(b => cancellationReasons.includes(b.reason) && !b.isSecondaryVendor), 
    [bookings]
  );

  // Already Reconciled bookings with decision state
  const alreadyReconciledBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason.startsWith("Already Reconciled")), 
    [bookings]
  );

  // Already Reconciled decision state: { bookingId: { decision, remarks, adjustmentType, adjustmentAmount } }
  const [alreadyReconciledDecisions, setAlreadyReconciledDecisions] = useState<Map<string, {
    decision: string;
    remarks: string;
    adjustmentType: "add" | "less";
    adjustmentAmount: number;
  }>>(new Map());

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
    return grouped;
  }, [discrepancyBookings]);

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

  // Group cancellation bookings by reason AND tid
  const cancellationsByReasonAndTid = useMemo(() => {
    const result: Record<string, Record<string, BookingForPayable[]>> = {};
    for (const booking of cancellationBookings) {
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
  }, [cancellationBookings]);

  // Secondary Vendor bookings - using isSecondaryVendor flag
  const secondaryVendorBookings = useMemo(() => {
    return bookings.filter(b => b.isSecondaryVendor);
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

  // Payment Method Mismatch: bookings where HO payment method differs from SP payment method
  const paymentMismatchBookings = useMemo(() => {
    return bookings.filter(b => {
      // Only include if both payment methods are present and they differ
      if (!b.paymentMethod || !b.spPaymentMethod) return false;
      return b.paymentMethod.toLowerCase().trim() !== b.spPaymentMethod.toLowerCase().trim();
    });
  }, [bookings]);

  // Group Payment Mismatch bookings by TID
  const paymentMismatchByTid = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const booking of paymentMismatchBookings) {
      const tid = booking.tid || booking.bookingId;
      if (!grouped[tid]) {
        grouped[tid] = [];
      }
      grouped[tid].push(booking);
    }
    return grouped;
  }, [paymentMismatchBookings]);

  const getFinalNetPrice = useCallback((booking: BookingForPayable): number => {
    // Reconciled bookings always use SP Net
    if (booking.reason === "Reconciled" || booking.reason === "Unmapped") {
      return booking.spNet;
    }
    const selection = localSelections[booking.bookingId] || "sp";
    const pricePayable = selection === "ho" ? booking.hoNet : booking.spNet;
    
    if (activeDisputes.has(booking.bookingId)) {
      const disputeAmt = disputeAmounts.get(booking.bookingId) || 0;
      return pricePayable - disputeAmt;
    }
    
    return pricePayable;
  }, [localSelections, activeDisputes, disputeAmounts]);

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

  // Group closed disputes by displayId for display in adjustments section (only SP Error disputes)
  const groupedClosedDisputes = useMemo(() => {
    const groups = new Map<string, {
      displayId: string;
      totalAmount: number;
      closureType: "sp_error" | "ho_error";
      bookingCount: number;
    }>();
    
    // Only include SP Error disputes since they reduce Amount Payable
    const spErrorDisputes = closedDisputes.filter(d => d.closureType === "sp_error");
    
    for (const dispute of spErrorDisputes) {
      // Use the pre-computed mapping from the fetch to get display ID
      const displayId = disputeIdMapping.get(dispute.disputeId) || dispute.disputeId;
      const existing = groups.get(displayId);
      if (existing) {
        existing.totalAmount += dispute.closedAmount;
        existing.bookingCount += 1;
      } else {
        groups.set(displayId, {
          displayId,
          totalAmount: dispute.closedAmount,
          closureType: dispute.closureType,
          bookingCount: 1,
        });
      }
    }
    
    return Array.from(groups.values());
  }, [closedDisputes, disputeIdMapping]);

  // Calculate Already Reconciled adjustments from decisions
  const alreadyReconciledAdjustment = useMemo(() => {
    let total = 0;
    alreadyReconciledDecisions.forEach((decision) => {
      if (decision.adjustmentAmount > 0) {
        if (decision.adjustmentType === "add") {
          total += decision.adjustmentAmount;
        } else {
          total -= decision.adjustmentAmount;
        }
      }
    });
    return total;
  }, [alreadyReconciledDecisions]);

  // Already Reconciled bookings base total (use SP Net by default)
  const alreadyReconciledTotal = useMemo(() => 
    alreadyReconciledBookings.reduce((sum, b) => sum + b.spNet, 0), 
    [alreadyReconciledBookings]
  );

  const baseAmount = reconciledTotal + discrepancyTotal + alreadyReconciledTotal + secondaryVendorTotal;

  const finalAmount = useMemo(() => {
    const adjustmentsResult = localAdjustments.reduce((total, adj) => {
      if (adj.type === "add") {
        return total + adj.amount;
      } else {
        return total - adj.amount;
      }
    }, baseAmount);
    
    // Deduct SP Error closed dispute adjustments and apply Already Reconciled adjustments
    const result = adjustmentsResult - spErrorClosedAdjustments + alreadyReconciledAdjustment;
    return Math.round(result * 100) / 100;
  }, [baseAmount, localAdjustments, spErrorClosedAdjustments, alreadyReconciledAdjustment]);

  const updateSelection = useCallback((bookingId: string, value: "ho" | "sp", booking?: BookingForPayable) => {
    setLocalSelections(prev => ({ ...prev, [bookingId]: value }));
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

  const updateReasonSelection = useCallback((reason: string, value: "ho" | "sp") => {
    const reasonBookings = bookingsByReason[reason] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of reasonBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of reasonBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [bookingsByReason]);

  const updateTidSelection = useCallback((reason: string, tid: string, value: "ho" | "sp") => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of tidBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
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

  // Secondary Vendor bulk selection functions
  const updateSecondaryVendorReasonSelection = useCallback((reason: string, value: "ho" | "sp") => {
    const reasonBookings = secondaryVendorByReason[reason] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of reasonBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of reasonBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [secondaryVendorByReason]);

  const updateSecondaryVendorTidSelection = useCallback((reason: string, tid: string, value: "ho" | "sp") => {
    const tidBookings = secondaryVendorByReasonAndTid[reason]?.[tid] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of tidBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
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
    return Math.abs(booking.hoNet - finalNet);
  }, [getFinalNetPrice]);

  const toggleDispute = useCallback((bookingId: string, booking: BookingForPayable) => {
    if (!isBookingDisputable(booking)) return;
    
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
    setDisputeAmounts(prev => new Map(prev).set(bookingId, amount));
  }, [getMaxDisputeAmount]);

  const updateReasonDispute = useCallback((reason: string, action: "all" | "clear") => {
    const reasonBookings = bookingsByReason[reason] || [];
    if (action === "all") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
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
    } else {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
    }
  }, [bookingsByReason, isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

  // Cancellation-specific bulk handlers
  const updateCancellationReasonSelection = useCallback((reason: string, value: "ho" | "sp") => {
    const reasonBookings = cancellationsByReason[reason] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of reasonBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of reasonBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [cancellationsByReason]);

  const updateCancellationReasonDispute = useCallback((reason: string, action: "all" | "clear") => {
    const reasonBookings = cancellationsByReason[reason] || [];
    if (action === "all") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
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
    } else {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
    }
  }, [cancellationsByReason, isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

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

  // Secondary Vendor dispute functions
  const updateSecondaryVendorReasonDispute = useCallback((reason: string, action: "all" | "clear") => {
    const reasonBookings = secondaryVendorByReason[reason] || [];
    if (action === "all") {
      const newDisputes = new Set(activeDisputes);
      const newAmounts = new Map(disputeAmounts);
      for (const b of reasonBookings) {
        if (isBookingDisputable(b)) {
          newDisputes.add(b.bookingId);
          if (!newAmounts.has(b.bookingId)) {
            newAmounts.set(b.bookingId, getMaxDisputeAmount(b));
          }
        }
      }
      setActiveDisputes(newDisputes);
      setDisputeAmounts(newAmounts);
    } else {
      const newDisputes = new Set(activeDisputes);
      const newAmounts = new Map(disputeAmounts);
      for (const b of reasonBookings) {
        newDisputes.delete(b.bookingId);
        newAmounts.delete(b.bookingId);
      }
      setActiveDisputes(newDisputes);
      setDisputeAmounts(newAmounts);
    }
  }, [secondaryVendorByReason, activeDisputes, disputeAmounts, isBookingDisputable, getMaxDisputeAmount]);

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
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        return { ...a, [field]: value };
      })
    );
    setValidationError("");
  }, []);

  const updateAdjustmentDisputes = useCallback((adjustmentId: string, selectedIds: string[]) => {
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== adjustmentId) return a;
        
        const totalAmount = openDisputes
          .filter(d => selectedIds.includes(d.displayId))
          .reduce((sum, d) => sum + d.totalDisputeAmount, 0);
        
        const roundedAmount = Math.round(totalAmount * 100) / 100;
        
        return {
          ...a,
          selectedDisputeIds: selectedIds,
          reference: selectedIds.join(", "),
          amount: roundedAmount,
        };
      })
    );
  }, [openDisputes]);

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
          const selection = localSelections[booking.bookingId] || "ho";
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
        await apiRequest("DELETE", `/api/disputes/${runId}`, { bookingIds: removedDisputes });
      }
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
      
      setOriginalDisputes(new Map(disputeAmounts));
    } finally {
      setIsLoggingDisputes(false);
    }
  }, [runId, disputeAmounts, originalDisputes, bookings, activeDisputes, localSelections, toast]);

  const openDisputeDialog = useCallback(async (dispute: typeof selectedDispute) => {
    if (!dispute || !runId) return;
    
    setSelectedDispute(dispute);
    setClosureType(null);
    setAcceptHoError(false);
    setIsLoadingBookingDetails(true);
    
    try {
      // Fetch booking details for each dispute ID
      const response = await fetch(`/api/disputes/details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeIds: dispute.actualDisputeIds, runId }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const initialClosures = new Map<string, {
          disputeId: string;
          bookingId: string;
          originalAmount: number;
          adjustmentAmount: number;
          closureType: "sp_error" | "ho_error";
          confirmed: boolean;
        }>();
        
        for (const d of data.disputes || []) {
          initialClosures.set(d.disputeId, {
            disputeId: d.disputeId,
            bookingId: d.bookingId,
            originalAmount: d.disputeAmount,
            adjustmentAmount: d.disputeAmount, // Default to original amount
            closureType: "sp_error", // Default to SP Error
            confirmed: false,
          });
        }
        setBookingClosures(initialClosures);
      }
    } catch (error) {
      console.error("Failed to load booking details:", error);
    } finally {
      setIsLoadingBookingDetails(false);
    }
  }, [runId]);

  const closeDisputeDialog = useCallback(() => {
    setSelectedDispute(null);
    setClosureType(null);
    setAcceptHoError(false);
    setBookingClosures(new Map());
  }, []);

  // Update booking closure settings
  const updateBookingClosure = useCallback((disputeId: string, updates: Partial<{
    adjustmentAmount: number;
    closureType: "sp_error" | "ho_error";
    confirmed: boolean;
  }>) => {
    setBookingClosures(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(disputeId);
      if (existing) {
        newMap.set(disputeId, { ...existing, ...updates });
      }
      return newMap;
    });
  }, []);

  // Calculate summary totals for booking closures
  const closureSummary = useMemo(() => {
    let spErrorTotal = 0;
    let hoErrorTotal = 0;
    let confirmedCount = 0;
    
    for (const closure of Array.from(bookingClosures.values())) {
      if (closure.confirmed) {
        confirmedCount++;
        if (closure.closureType === "sp_error") {
          spErrorTotal += closure.adjustmentAmount;
        } else {
          hoErrorTotal += closure.adjustmentAmount;
        }
      }
    }
    
    return { spErrorTotal, hoErrorTotal, confirmedCount, totalBookings: bookingClosures.size };
  }, [bookingClosures]);

  // Handle processing all confirmed booking closures
  const handleProcessBookingClosures = useCallback(async () => {
    if (!runId || !selectedDispute || closureSummary.confirmedCount === 0) return;
    
    // Enforce HO Error confirmation - must be checked if any HO errors are being closed
    if (closureSummary.hoErrorTotal > 0 && !acceptHoError) {
      toast({
        title: "HO Error Confirmation Required",
        description: "Please confirm that HO Error bookings are Headout's responsibility.",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessingClosures(true);
    try {
      const closures: Array<{
        disputeId: string;
        adjustmentAmount: number;
        closureType: "sp_error" | "ho_error";
      }> = [];
      
      for (const closure of Array.from(bookingClosures.values())) {
        if (closure.confirmed) {
          // Client-side validation: cap adjustment to original amount
          const validatedAmount = Math.min(closure.adjustmentAmount, closure.originalAmount);
          if (validatedAmount < 0) continue;
          
          closures.push({
            disputeId: closure.disputeId,
            adjustmentAmount: validatedAmount,
            closureType: closure.closureType,
          });
        }
      }
      
      const response = await apiRequest("POST", "/api/disputes/close-bookings", { closures, runId });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to close bookings");
      }
      
      const result = await response.json();
      
      // Download HO Error report if any HO errors were closed
      if (result.hoErrorDisputeIds && result.hoErrorDisputeIds.length > 0) {
        const downloadResponse = await fetch("/api/disputes/accept-ho-error/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disputeIds: result.hoErrorDisputeIds }),
        });
        if (downloadResponse.ok) {
          const blob = await downloadResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `HO_Error_Closure_${selectedDispute.displayId.replace(/#/g, "")}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }
      }
      
      // Show errors if any
      if (result.errors && result.errors.length > 0) {
        toast({
          title: "Some bookings failed to close",
          description: `${result.closedDisputes?.length || 0} closed, ${result.errors.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Bookings Closed",
          description: `${closureSummary.confirmedCount} booking(s) closed successfully.`,
        });
      }
      
      setDisputesLoaded(false);
      closeDisputeDialog();
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to close bookings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessingClosures(false);
    }
  }, [runId, selectedDispute, bookingClosures, closureSummary, acceptHoError, closeDisputeDialog, toast]);

  // Toggle edit mode for a closed dispute
  const toggleClosedDisputeEdit = useCallback((disputeId: string) => {
    setClosedDisputes(prev => prev.map(d => 
      d.disputeId === disputeId 
        ? { ...d, isEditing: !d.isEditing, editAmount: d.closedAmount, editClosureType: d.closureType }
        : d
    ));
  }, []);

  // Update edit values for a closed dispute
  const updateClosedDisputeEdit = useCallback((disputeId: string, updates: { editAmount?: number; editClosureType?: "sp_error" | "ho_error" }) => {
    setClosedDisputes(prev => prev.map(d => 
      d.disputeId === disputeId 
        ? { ...d, ...updates }
        : d
    ));
  }, []);

  // Save edited closed dispute
  const saveClosedDisputeEdit = useCallback(async (disputeId: string) => {
    const dispute = closedDisputes.find(d => d.disputeId === disputeId);
    if (!dispute) return;
    
    // Validate amount
    const cappedAmount = Math.min(dispute.editAmount, dispute.originalAmount);
    if (cappedAmount < 0) {
      toast({
        title: "Invalid Amount",
        description: "Adjustment amount cannot be negative.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSavingClosedDispute(disputeId);
    try {
      const response = await apiRequest("PATCH", `/api/disputes/${encodeURIComponent(disputeId)}`, {
        closedByAdjustmentAmount: cappedAmount,
        closureType: dispute.editClosureType === "ho_error" ? "accept_ho_error" : "sp_error",
      });
      
      if (!response.ok) {
        throw new Error("Failed to update dispute");
      }
      
      // Update local state
      setClosedDisputes(prev => prev.map(d => 
        d.disputeId === disputeId 
          ? { 
              ...d, 
              closedAmount: cappedAmount, 
              closureType: dispute.editClosureType,
              isEditing: false 
            }
          : d
      ));
      
      // Recalculate SP Error total
      const newSpErrorTotal = closedDisputes
        .map(d => d.disputeId === disputeId 
          ? { ...d, closedAmount: cappedAmount, closureType: dispute.editClosureType }
          : d
        )
        .filter(d => d.closureType === "sp_error")
        .reduce((sum, d) => sum + d.closedAmount, 0);
      setSpErrorClosedAdjustments(newSpErrorTotal);
      
      toast({
        title: "Dispute Updated",
        description: "The closed dispute has been updated successfully.",
      });
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingClosedDispute(null);
    }
  }, [closedDisputes, runId, toast]);

  // Cancel edit mode
  const cancelClosedDisputeEdit = useCallback((disputeId: string) => {
    setClosedDisputes(prev => prev.map(d => 
      d.disputeId === disputeId 
        ? { ...d, isEditing: false, editAmount: d.closedAmount, editClosureType: d.closureType }
        : d
    ));
  }, []);

  // Reopen a closed dispute (set back to open status)
  const reopenClosedDispute = useCallback(async (disputeId: string) => {
    setIsSavingClosedDispute(disputeId);
    try {
      const response = await apiRequest("PATCH", `/api/disputes/${encodeURIComponent(disputeId)}`, {
        closureStatus: "open",
        closureType: null,
        closedByAdjustmentAmount: null,
        closedAt: null,
      });
      
      if (!response.ok) {
        throw new Error("Failed to reopen dispute");
      }
      
      // Remove from closed disputes and reload
      setDisputesLoaded(false);
      
      toast({
        title: "Dispute Reopened",
        description: "The dispute is now open and can be managed again.",
      });
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reopen dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingClosedDispute(null);
    }
  }, [runId, toast]);

  const handleAcceptHoError = useCallback(async () => {
    if (!runId || !acceptHoError || !selectedDispute) return;
    
    const disputeIds = selectedDispute.actualDisputeIds;
    if (disputeIds.length === 0) return;
    
    setIsClosingWithHoError(true);
    try {
      const closeResponse = await apiRequest("POST", "/api/disputes/accept-ho-error", { disputeIds });
      if (!closeResponse.ok) {
        const errorData = await closeResponse.json();
        throw new Error(errorData.error || "Failed to close disputes");
      }
      
      const downloadResponse = await fetch("/api/disputes/accept-ho-error/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeIds }),
      });
      if (!downloadResponse.ok) {
        throw new Error("Failed to download report");
      }
      const blob = await downloadResponse.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `HO_Error_Closure_${selectedDispute.displayId.replace(/#/g, "")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Dispute Closed",
        description: `${selectedDispute.displayId} closed as HO Error. Report downloaded.`,
      });
      
      setDisputesLoaded(false);
      closeDisputeDialog();
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to close dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsClosingWithHoError(false);
    }
  }, [runId, acceptHoError, selectedDispute, closeDisputeDialog, toast]);

  const handleCloseAsSpError = useCallback(async () => {
    if (!runId || !selectedDispute) return;
    
    const disputeIds = selectedDispute.actualDisputeIds;
    if (disputeIds.length === 0) return;
    
    setIsClosingWithSpError(true);
    try {
      const response = await apiRequest("POST", "/api/disputes/close-sp-error", { disputeIds });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to close disputes");
      }
      
      toast({
        title: "Dispute Closed",
        description: `${selectedDispute.displayId} closed as SP Error.`,
      });
      
      setDisputesLoaded(false);
      closeDisputeDialog();
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to close dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsClosingWithSpError(false);
    }
  }, [runId, selectedDispute, closeDisputeDialog, toast]);

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

  const handleReopenDispute = useCallback(async (disputeId: string) => {
    setIsReopeningDispute(disputeId);
    try {
      const response = await fetch("/api/disputes/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reopen dispute");
      }
      
      // Remove from closed disputes
      setClosedDisputes(prev => prev.filter(d => d.disputeId !== disputeId));
      
      // Recalculate SP Error total
      setSpErrorClosedAdjustments(prev => {
        const closedDispute = closedDisputes.find(d => d.disputeId === disputeId);
        if (closedDispute && closedDispute.closureType === "sp_error") {
          return prev - closedDispute.closedAmount;
        }
        return prev;
      });
      
      // Refresh disputes to show reopened dispute in open list
      setDisputesLoaded(false);
      
      toast({
        title: "Dispute Reopened",
        description: "The dispute has been reopened and is now available for review.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reopen dispute",
        variant: "destructive",
      });
    } finally {
      setIsReopeningDispute(null);
    }
  }, [closedDisputes, toast]);

  const handleStartEditClosedDispute = useCallback((disputeId: string, currentAmount: number) => {
    setEditingClosedDispute(disputeId);
    setEditClosedDisputeAmount(currentAmount);
  }, []);

  const handleSaveEditClosedDispute = useCallback(async (disputeId: string) => {
    const dispute = closedDisputes.find(d => d.disputeId === disputeId);
    if (!dispute) return;
    
    // Validate: can't exceed original amount
    if (editClosedDisputeAmount > dispute.originalAmount) {
      toast({
        title: "Invalid Amount",
        description: `Amount cannot exceed the original dispute amount of ${formatCurrency(dispute.originalAmount)}`,
        variant: "destructive",
      });
      return;
    }
    
    setIsSavingClosedDispute(disputeId);
    try {
      // Update the dispute on the backend with new closure amount
      const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/update-closure`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closedByAdjustmentAmount: editClosedDisputeAmount }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update dispute");
      }
      
      // Update local state
      const oldAmount = dispute.closedAmount;
      const newAmount = editClosedDisputeAmount;
      
      setClosedDisputes(prev => prev.map(d => 
        d.disputeId === disputeId 
          ? { ...d, closedAmount: newAmount }
          : d
      ));
      
      // Recalculate SP Error total if it's an SP Error dispute
      if (dispute.closureType === "sp_error") {
        setSpErrorClosedAdjustments(prev => prev - oldAmount + newAmount);
      }
      
      setEditingClosedDispute(null);
      
      toast({
        title: "Dispute Updated",
        description: "The dispute amount has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update dispute",
        variant: "destructive",
      });
    } finally {
      setIsSavingClosedDispute(null);
    }
  }, [closedDisputes, editClosedDisputeAmount, toast]);

  const handleCancelEditClosedDispute = useCallback(() => {
    setEditingClosedDispute(null);
    setEditClosedDisputeAmount(0);
  }, []);

  const handleApply = useCallback(async () => {
    setValidationError("");
    
    const manualAdjustments = localAdjustments.filter(a => !a.isPreset);
    for (const adj of manualAdjustments) {
      if (!adj.nature.trim() || !adj.reference.trim() || adj.amount === 0) {
        setValidationError("Please fill in all fields (Nature, Reference No, Amount) for manually added adjustment rows before applying.");
        return;
      }
    }
    
    // Convert Already Reconciled decisions into adjustment entries
    const alreadyReconciledAdjustmentEntries: Adjustment[] = [];
    alreadyReconciledDecisions.forEach((decision, bookingId) => {
      if (decision.adjustmentAmount > 0 && decision.decision) {
        const decisionLabel = decision.decision.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        alreadyReconciledAdjustmentEntries.push({
          id: `ar-${bookingId}`,
          nature: `Already Reconciled - ${decisionLabel}`,
          reference: `${bookingId}${decision.remarks ? ` - ${decision.remarks}` : ""}`,
          type: decision.adjustmentType,
          amount: decision.adjustmentAmount,
          isPreset: true,
        });
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
  }, [localAdjustments, localSelections, finalAmount, alreadyReconciledDecisions]);

  const handleConfirmApply = useCallback(async () => {
    if (!pendingApplyData) return;
    
    setShowApplyConfirmation(false);
    
    // Auto-close disputes that match adjustments
    if (runId) {
      const disputeAdjustments = pendingApplyData.adjustments.filter(
        a => a.nature === "Open Dispute Adjustments" && a.amount > 0
      );
      
      for (const adj of disputeAdjustments) {
        let selectedAggregated: typeof openDisputes = [];
        
        // Check if selectedDisputeIds is populated (from dropdown selection)
        if (adj.selectedDisputeIds && adj.selectedDisputeIds.length > 0) {
          selectedAggregated = openDisputes.filter(
            d => adj.selectedDisputeIds!.includes(d.displayId)
          );
        } else if (adj.reference && adj.reference.trim()) {
          // Parse reference field for manually typed DID patterns like "DID-#1, DID-#2"
          const didPattern = /DID-#\d+/g;
          const matches = adj.reference.match(didPattern);
          if (matches && matches.length > 0) {
            selectedAggregated = openDisputes.filter(
              d => matches.includes(d.displayId)
            );
          }
        }
        
        if (selectedAggregated.length === 0) continue;
        
        // Calculate total dispute amount from selected DIDs
        const selectedTotal = selectedAggregated.reduce((sum, d) => sum + d.totalDisputeAmount, 0);
        
        // Collect all actual dispute IDs from selected aggregated groups
        const actualDisputeIds = selectedAggregated.flatMap(d => d.actualDisputeIds);
        
        // Round for comparison
        const roundedAdjAmount = Math.round(adj.amount * 100) / 100;
        const roundedSelectedTotal = Math.round(selectedTotal * 100) / 100;
        
        // Only close if amounts match exactly
        if (roundedAdjAmount === roundedSelectedTotal && actualDisputeIds.length > 0) {
          try {
            await apiRequest("POST", "/api/disputes/close", {
              disputeIds: actualDisputeIds,
              adjustmentAmount: adj.amount,
            });
            
            // Show success message for dispute creation
            toast({
              title: "Dispute Created",
              description: `${actualDisputeIds.length} dispute(s) logged to the Dispute Tracker.`,
            });
          } catch (err) {
            console.error("Failed to close disputes:", err);
          }
        }
      }
      
      // Re-invalidate to pick up closed disputes
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    }
    
    onApply(pendingApplyData.adjustments, pendingApplyData.selections, pendingApplyData.amount);
    setPendingApplyData(null);
  }, [pendingApplyData, runId, openDisputes, onApply, toast]);

  const handleCancelApply = useCallback(() => {
    setShowApplyConfirmation(false);
    setPendingApplyData(null);
  }, []);

  const formatCurrency = (value: number) => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 items-center">
              <div className="col-span-6 flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Reconciled</span>
                <Badge variant="secondary" className="text-xs">{reconciledBookings.length}</Badge>
              </div>
              <div className="col-span-6 text-right">
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
              <div className="border rounded-lg overflow-hidden border-amber-300 dark:border-amber-700">
                <CollapsibleTrigger asChild>
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 items-center cursor-pointer hover-elevate">
                    <div className="col-span-6 flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        {isAlreadyReconciledExpanded ? (
                          <ChevronDown className="h-4 w-4 text-amber-600" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-amber-600" />
                        )}
                      </Button>
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Already Reconciled</span>
                      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        {alreadyReconciledBookings.length}
                      </Badge>
                    </div>
                    <div className="col-span-6 text-right">
                      <span className="text-xs text-muted-foreground">
                        {isAlreadyReconciledExpanded ? "Decide payment for each booking" : "Click to expand"}
                      </span>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="max-h-96 overflow-y-auto">
                    <div className="grid grid-cols-12 gap-1 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-t">
                  <div className="col-span-1">TID</div>
                  <div className="col-span-1">Booking ID</div>
                  <div className="col-span-1 text-right">HO Net</div>
                  <div className="col-span-1 text-right">SP Net</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2">Decision</div>
                  <div className="col-span-2">Remarks</div>
                  <div className="col-span-1">Add/Less</div>
                  <div className="col-span-1 text-right">Amount</div>
                </div>
                {alreadyReconciledBookings.map((booking) => {
                  const decision = alreadyReconciledDecisions.get(booking.bookingId);
                  return (
                    <div 
                      key={booking.bookingId} 
                      className="grid grid-cols-12 gap-1 px-3 py-2 border-t items-center text-xs"
                      data-testid={`already-reconciled-row-${booking.bookingId}`}
                    >
                      <div className="col-span-1 font-mono truncate" title={booking.tid}>{booking.tid || "-"}</div>
                      <div className="col-span-1 font-mono truncate" title={booking.bookingId}>{booking.bookingId}</div>
                      <div className="col-span-1 text-right font-mono">{formatCurrency(booking.hoNet)}</div>
                      <div className="col-span-1 text-right font-mono">{formatCurrency(booking.spNet)}</div>
                      <div className="col-span-2">
                        <Badge 
                          variant="secondary" 
                          className={`text-xs ${booking.reason.includes("Same") ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"}`}
                        >
                          {booking.reason.includes("Same") ? "Same BE" : "Diff BE"}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        <Select
                          value={decision?.decision || ""}
                          onValueChange={(v) => {
                            const newDecisions = new Map(alreadyReconciledDecisions);
                            newDecisions.set(booking.bookingId, {
                              decision: v,
                              remarks: decision?.remarks || "",
                              adjustmentType: decision?.adjustmentType || "less",
                              adjustmentAmount: decision?.adjustmentAmount || 0,
                            });
                            setAlreadyReconciledDecisions(newDecisions);
                          }}
                        >
                          <SelectTrigger className="text-xs" data-testid={`select-decision-${booking.bookingId}`}>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cancellation">Cancellation</SelectItem>
                            <SelectItem value="multiple_tickets">Multiple Tickets</SelectItem>
                            <SelectItem value="partial_fulfillment">Partial Fulfillment</SelectItem>
                            <SelectItem value="manual_error">Manual Error</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Input
                          className="text-xs"
                          placeholder="Remarks..."
                          value={decision?.remarks || ""}
                          onChange={(e) => {
                            const newDecisions = new Map(alreadyReconciledDecisions);
                            newDecisions.set(booking.bookingId, {
                              decision: decision?.decision || "",
                              remarks: e.target.value,
                              adjustmentType: decision?.adjustmentType || "less",
                              adjustmentAmount: decision?.adjustmentAmount || 0,
                            });
                            setAlreadyReconciledDecisions(newDecisions);
                          }}
                          data-testid={`input-remarks-${booking.bookingId}`}
                        />
                      </div>
                      <div className="col-span-1">
                        <Select
                          value={decision?.adjustmentType || "less"}
                          onValueChange={(v) => {
                            const newDecisions = new Map(alreadyReconciledDecisions);
                            newDecisions.set(booking.bookingId, {
                              decision: decision?.decision || "",
                              remarks: decision?.remarks || "",
                              adjustmentType: v as "add" | "less",
                              adjustmentAmount: decision?.adjustmentAmount || 0,
                            });
                            setAlreadyReconciledDecisions(newDecisions);
                          }}
                        >
                          <SelectTrigger className="text-xs" data-testid={`select-addless-${booking.bookingId}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Add</SelectItem>
                            <SelectItem value="less">Less</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1">
                        <Input
                          type="number"
                          className="text-xs text-right font-mono"
                          placeholder="0.00"
                          value={decision?.adjustmentAmount || ""}
                          onChange={(e) => {
                            const newDecisions = new Map(alreadyReconciledDecisions);
                            newDecisions.set(booking.bookingId, {
                              decision: decision?.decision || "",
                              remarks: decision?.remarks || "",
                              adjustmentType: decision?.adjustmentType || "less",
                              adjustmentAmount: parseFloat(e.target.value) || 0,
                            });
                            setAlreadyReconciledDecisions(newDecisions);
                          }}
                          data-testid={`input-amount-${booking.bookingId}`}
                        />
                      </div>
                    </div>
                  );
                })}
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
              <div className="border rounded-lg overflow-hidden border-red-300 dark:border-red-700">
                <CollapsibleTrigger asChild>
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 items-center cursor-pointer hover-elevate">
                    <div className="col-span-6 flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        {isCancellationsExpanded ? (
                          <ChevronDown className="h-4 w-4 text-red-600" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-red-600" />
                        )}
                      </Button>
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700 dark:text-red-400">Cancellations</span>
                      <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                        {cancellationBookings.length}
                      </Badge>
                    </div>
                    <div className="col-span-6 text-right">
                      <span className="text-xs text-muted-foreground">
                        {isCancellationsExpanded ? "View cancellation types" : "Click to expand"}
                      </span>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2 p-3 border-t">
                    {Object.entries(cancellationsByReasonAndTid).map(([reason, tidGroups]) => {
                      const reasonBookings = cancellationsByReason[reason] || [];
                      const reasonTotal = reasonBookings.reduce((sum, b) => {
                        const netType = localSelections[b.bookingId] || "sp";
                        const pricePayable = netType === "ho" ? b.hoNet : b.spNet;
                        const disputeAmt = disputeAmounts.get(b.bookingId) || 0;
                        return sum + pricePayable - disputeAmt;
                      }, 0);
                      const displayName = reason.replace("Cancelled-", "");

                      return (
                        <Collapsible
                          key={reason}
                          open={expandedReasons.has(reason)}
                          onOpenChange={() => toggleReason(reason)}
                        >
                          <div className="border rounded-lg overflow-hidden border-red-200 dark:border-red-800/50">
                            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-red-50/50 dark:bg-red-950/20 items-center">
                              <div className="col-span-4 flex items-center gap-2">
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    {expandedReasons.has(reason) ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </Button>
                                </CollapsibleTrigger>
                                <Button
                                  variant="ghost"
                                  className="p-0 h-auto font-semibold text-sm hover:text-primary hover:bg-transparent text-red-700 dark:text-red-400"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReasonModal(reason);
                                  }}
                                  data-testid={`button-view-reason-${reason}`}
                                >
                                  {displayName}
                                  <Eye className="h-3 w-3 ml-1 opacity-50" />
                                </Button>
                                <Badge variant="secondary" className="text-xs">
                                  {reasonBookings.length}
                                </Badge>
                              </div>
                              <div className="col-span-2 flex justify-center">
                                <Select
                                  value=""
                                  onValueChange={(v) => updateCancellationReasonSelection(reason, v as "ho" | "sp")}
                                >
                                  <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-cancellation-reason-${reason}`}>
                                    <SelectValue placeholder="Bulk Net" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ho">All HO Net</SelectItem>
                                    <SelectItem value="sp">All SP Net</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="col-span-2 flex justify-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => updateCancellationReasonDispute(reason, "all")}
                                  data-testid={`button-dispute-all-cancellation-${reason}`}
                                >
                                  Dispute All
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-muted-foreground"
                                  onClick={() => updateCancellationReasonDispute(reason, "clear")}
                                  data-testid={`button-clear-cancellation-${reason}`}
                                >
                                  Clear
                                </Button>
                              </div>
                              <div className="col-span-4 text-right font-mono text-sm font-semibold text-red-700 dark:text-red-400">
                                {formatCurrency(reasonTotal)} {currency}
                              </div>
                            </div>

                            <CollapsibleContent>
                              <div className="grid grid-cols-18 gap-1 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-t">
                                <div className="col-span-2">TID / Booking ID</div>
                                <div className="col-span-2 text-right">HO Net</div>
                                <div className="col-span-2 text-right">SP Net</div>
                                <div className="col-span-1 text-center">Net</div>
                                <div className="col-span-1 text-center">Dispute</div>
                                <div className="col-span-2 text-right">Price Payable</div>
                                <div className="col-span-3 text-right">Dispute Amt</div>
                                <div className="col-span-5 text-right">Final Reconciled Net</div>
                              </div>

                              <div className="max-h-80 overflow-y-auto">
                                {Object.entries(tidGroups).map(([tid, tidBookings]) => {
                                  const tidKeyStr = `${reason}:${tid}`;
                                  const isTidExpanded = expandedTids.has(tidKeyStr);

                                  return (
                                    <div key={tid} className="border-t">
                                      <Collapsible
                                        open={isTidExpanded}
                                        onOpenChange={() => toggleTid(tidKeyStr)}
                                      >
                                        <div className="grid grid-cols-18 gap-1 px-3 py-2 items-center hover:bg-muted/20">
                                          <div className="col-span-2 flex items-center gap-1">
                                            <CollapsibleTrigger asChild>
                                              <Button variant="ghost" size="icon" className="h-5 w-5">
                                                {isTidExpanded ? (
                                                  <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                  <ChevronRight className="h-3 w-3" />
                                                )}
                                              </Button>
                                            </CollapsibleTrigger>
                                            <span className="font-mono text-xs truncate" title={tid}>
                                              {tid}
                                            </span>
                                            <Badge variant="outline" className="text-xs ml-1">
                                              {tidBookings.length}
                                            </Badge>
                                          </div>
                                          <div className="col-span-16" />
                                        </div>

                                        <CollapsibleContent>
                                          {tidBookings.map((booking) => {
                                            const netType = localSelections[booking.bookingId] || "sp";
                                            const pricePayable = netType === "ho" ? booking.hoNet : booking.spNet;
                                            const disputeAmt = disputeAmounts.get(booking.bookingId) || 0;
                                            const isDisputed = activeDisputes.has(booking.bookingId);
                                            const finalNet = pricePayable - disputeAmt;

                                            return (
                                              <div
                                                key={booking.bookingId}
                                                className="grid grid-cols-18 gap-1 px-3 py-1.5 items-center text-xs border-t bg-muted/10"
                                                data-testid={`booking-row-${booking.bookingId}`}
                                              >
                                                <div className="col-span-2 pl-6 font-mono truncate" title={booking.bookingId}>
                                                  {booking.bookingId}
                                                </div>
                                                <div className="col-span-2 text-right font-mono">
                                                  {formatCurrency(booking.hoNet)}
                                                </div>
                                                <div className="col-span-2 text-right font-mono">
                                                  {formatCurrency(booking.spNet)}
                                                </div>
                                                <div className="col-span-1 flex justify-center">
                                                  <Select
                                                    value={netType}
                                                    onValueChange={(v) =>
                                                      setLocalSelections((prev) => ({
                                                        ...prev,
                                                        [booking.bookingId]: v as "ho" | "sp",
                                                      }))
                                                    }
                                                  >
                                                    <SelectTrigger className="w-14 h-6 text-xs">
                                                      <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      <SelectItem value="ho">HO</SelectItem>
                                                      <SelectItem value="sp">SP</SelectItem>
                                                    </SelectContent>
                                                  </Select>
                                                </div>
                                                <div className="col-span-1 flex justify-center">
                                                  <Checkbox
                                                    checked={isDisputed}
                                                    onCheckedChange={(checked) => {
                                                      const newActive = new Set(activeDisputes);
                                                      if (checked) {
                                                        newActive.add(booking.bookingId);
                                                        setDisputeAmounts((prev) => {
                                                          const updated = new Map(prev);
                                                          updated.set(
                                                            booking.bookingId,
                                                            Math.abs(booking.hoNet - booking.spNet)
                                                          );
                                                          return updated;
                                                        });
                                                      } else {
                                                        newActive.delete(booking.bookingId);
                                                        setDisputeAmounts((prev) => {
                                                          const updated = new Map(prev);
                                                          updated.delete(booking.bookingId);
                                                          return updated;
                                                        });
                                                      }
                                                      setActiveDisputes(newActive);
                                                    }}
                                                    data-testid={`checkbox-dispute-${booking.bookingId}`}
                                                  />
                                                </div>
                                                <div className="col-span-2 text-right font-mono">
                                                  {formatCurrency(pricePayable)}
                                                </div>
                                                <div className="col-span-3 text-right">
                                                  {isDisputed && (
                                                    <Input
                                                      type="number"
                                                      className="w-full h-6 text-xs text-right font-mono"
                                                      value={disputeAmt || ""}
                                                      onChange={(e) => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setDisputeAmounts((prev) => {
                                                          const updated = new Map(prev);
                                                          updated.set(booking.bookingId, val);
                                                          return updated;
                                                        });
                                                      }}
                                                      data-testid={`input-dispute-${booking.bookingId}`}
                                                    />
                                                  )}
                                                </div>
                                                <div className="col-span-5 text-right font-mono font-semibold">
                                                  {formatCurrency(finalNet)} {currency}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </CollapsibleContent>
                                      </Collapsible>
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
                        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 items-center">
                          <div className="col-span-4 flex items-center gap-2">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
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
                          <div className="col-span-2 flex justify-center">
                            {reason === "Unmapped" ? (
                              <span className="text-xs text-muted-foreground">SP Net only</span>
                            ) : (
                              <Select
                                value=""
                                onValueChange={(v) => updateReasonSelection(reason, v as "ho" | "sp")}
                              >
                                <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-reason-${reason}`}>
                                  <SelectValue placeholder="Bulk Net" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ho">All HO Net</SelectItem>
                                  <SelectItem value="sp">All SP Net</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="col-span-2 flex justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => updateReasonDispute(reason, "all")}
                              data-testid={`button-dispute-all-${reason}`}
                            >
                              Dispute All
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-muted-foreground"
                              onClick={() => updateReasonDispute(reason, "clear")}
                              data-testid={`button-clear-${reason}`}
                            >
                              Clear
                            </Button>
                          </div>
                          <div className="col-span-4 text-right font-mono text-sm font-semibold">
                            {formatCurrency(reasonTotal)} {currency}
                          </div>
                        </div>

                        <CollapsibleContent>
                          <div className="grid grid-cols-18 gap-1 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-t">
                            <div className="col-span-2">TID / Booking ID</div>
                            <div className="col-span-2 text-right">HO Net</div>
                            <div className="col-span-2 text-right">SP Net</div>
                            <div className="col-span-1 text-center">Net</div>
                            <div className="col-span-1 text-center">Dispute</div>
                            <div className="col-span-2 text-right">Price Payable</div>
                            <div className="col-span-3 text-right">Dispute Amt</div>
                            <div className="col-span-5 text-right">Final Reconciled Net</div>
                          </div>

                          <div className="max-h-80 overflow-y-auto">
                            {Object.entries(tidGroups).map(([tid, tidBookings]) => {
                              const tidKeyStr = `${reason}:${tid}`;
                              const isTidExpanded = expandedTids.has(tidKeyStr);
                              return (
                                <Collapsible
                                  key={tid}
                                  open={isTidExpanded}
                                  onOpenChange={() => toggleTid(tidKeyStr)}
                                >
                                  <div className="border-t">
                                    <div className="grid grid-cols-18 gap-1 px-3 py-2 bg-background items-center">
                                      <div className="col-span-2 flex items-center gap-1">
                                        <CollapsibleTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                                            {isTidExpanded ? (
                                              <ChevronDown className="h-3 w-3" />
                                            ) : (
                                              <ChevronRight className="h-3 w-3" />
                                            )}
                                          </Button>
                                        </CollapsibleTrigger>
                                        <div className="min-w-0 flex-1">
                                          <span className="font-medium text-xs truncate block" title={tid}>
                                            {tid}
                                          </span>
                                          <span className="text-xs text-muted-foreground">
                                            {tidBookings.length} booking{tidBookings.length > 1 ? "s" : ""}
                                          </span>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant={selectedIssues.has(`${reason}:${tid}`) ? "secondary" : "ghost"}
                                          className={`h-5 px-1.5 text-xs shrink-0 ${selectedIssues.has(`${reason}:${tid}`) ? "bg-amber-100 dark:bg-amber-900" : ""}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleIssueSelection(reason, tid);
                                          }}
                                          data-testid={`button-select-issue-tid-${tid}`}
                                        >
                                          <FileWarning className={`h-3 w-3 ${selectedIssues.has(`${reason}:${tid}`) ? "text-amber-600 dark:text-amber-400" : ""}`} />
                                        </Button>
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + b.hoNet, 0))}
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + b.spNet, 0))}
                                      </div>
                                      <div className="col-span-1 flex justify-center">
                                        {reason === "Unmapped" ? (
                                          <span className="text-xs text-muted-foreground">SP</span>
                                        ) : (
                                          <Select
                                            value=""
                                            onValueChange={(v) => updateTidSelection(reason, tid, v as "ho" | "sp")}
                                          >
                                            <SelectTrigger className="w-12 h-6 text-xs" data-testid={`select-tid-${tid}`}>
                                              <SelectValue placeholder="All" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="ho">HO</SelectItem>
                                              <SelectItem value="sp">SP</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        )}
                                      </div>
                                      <div className="col-span-1 flex justify-center items-center">
                                        {(() => {
                                          const { disputed, disputable } = getTidDisputeCount(reason, tid);
                                          if (disputable === 0) return <span className="text-xs text-muted-foreground">-</span>;
                                          return (
                                            <Checkbox
                                              checked={disputed === disputable}
                                              onCheckedChange={() => toggleTidDispute(reason, tid)}
                                              className="h-4 w-4"
                                              data-testid={`checkbox-dispute-tid-${tid}`}
                                            />
                                          );
                                        })()}
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => {
                                          const sel = localSelections[b.bookingId] || "sp";
                                          return s + (sel === "ho" ? b.hoNet : b.spNet);
                                        }, 0))}
                                      </div>
                                      <div className="col-span-3 text-right font-mono text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => {
                                          if (!activeDisputes.has(b.bookingId)) return s;
                                          return s + (disputeAmounts.get(b.bookingId) || 0);
                                        }, 0))}
                                      </div>
                                      <div className="col-span-5 text-right font-mono text-xs font-semibold">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                                      </div>
                                    </div>
                                    
                                    <CollapsibleContent>
                                      <div className="bg-muted/20">
                                        {tidBookings.map((booking) => {
                                          const currentSelection = localSelections[booking.bookingId] || "sp";
                                          const canDispute = isBookingDisputable(booking);
                                          const isDisputed = activeDisputes.has(booking.bookingId);
                                          const maxDispute = getMaxDisputeAmount(booking);
                                          const currentDisputeAmt = disputeAmounts.get(booking.bookingId) ?? maxDispute;
                                          const pricePayable = currentSelection === "ho" ? booking.hoNet : booking.spNet;
                                          return (
                                            <div 
                                              key={booking.bookingId} 
                                              className="grid grid-cols-18 gap-1 px-3 py-1.5 border-t border-dashed items-center"
                                            >
                                              <div className="col-span-2 pl-6">
                                                <span className="text-xs text-muted-foreground truncate block" title={booking.bookingId}>
                                                  {booking.bookingId}
                                                </span>
                                              </div>
                                              <div className="col-span-2 text-right font-mono text-xs text-muted-foreground">
                                                {formatCurrency(booking.hoNet)}
                                              </div>
                                              <div className="col-span-2 text-right font-mono text-xs text-muted-foreground">
                                                {formatCurrency(booking.spNet)}
                                              </div>
                                              <div className="col-span-1 flex justify-center">
                                                {reason === "Unmapped" ? (
                                                  <span className="text-xs text-muted-foreground">SP</span>
                                                ) : (
                                                  <Select
                                                    value={currentSelection}
                                                    onValueChange={(v) => updateSelection(booking.bookingId, v as "ho" | "sp", booking)}
                                                  >
                                                    <SelectTrigger 
                                                      className="w-12 h-5 text-xs" 
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
                                              </div>
                                              <div className="col-span-1 flex justify-center items-center">
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
                                              </div>
                                              <div className="col-span-2 text-right font-mono text-xs">
                                                {formatCurrency(pricePayable)}
                                              </div>
                                              <div className="col-span-3 text-right">
                                                {canDispute && isDisputed ? (
                                                  <div className="flex flex-col items-end">
                                                    <Input
                                                      type="number"
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
                                              </div>
                                              <div className="col-span-5 text-right font-mono text-xs">
                                                {formatCurrency(getFinalNetPrice(booking))}
                                              </div>
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
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}

              {(selectedIssues.size > 0 || activeDisputes.size > 0) && (
                <div className="flex justify-end items-center pt-3 mt-3 border-t gap-2">
                  {selectedIssues.size > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleLogIssues}
                      disabled={isLoggingIssues}
                      className="h-7 text-xs"
                      data-testid="button-log-issues"
                    >
                      <FileWarning className="h-3 w-3 mr-1" />
                      {isLoggingIssues ? "Logging..." : `Log Issues (${selectedIssues.size})`}
                    </Button>
                  )}
                  {activeDisputes.size > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleLogDisputes}
                      disabled={isLoggingDisputes}
                      className="h-7 text-xs"
                      data-testid="button-log-disputes"
                    >
                      {isLoggingDisputes ? "Logging..." : `Log Disputes (${activeDisputes.size})`}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Secondary Vendor Section - Full Interactive (BE ID Mismatch) */}
          {secondaryVendorBookings.length > 0 && (
            <div className="space-y-3 pt-4 mt-4 border-t-2 border-dashed border-amber-500/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <p className="text-base font-semibold text-amber-700 dark:text-amber-400">
                    Secondary Vendor (BE ID Mismatch)
                  </p>
                  <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                    {secondaryVendorBookings.length} bookings
                  </Badge>
                </div>
                <p className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400" data-testid="text-secondary-vendor-total">
                  {formatCurrency(secondaryVendorTotal)} {currency}
                </p>
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
                    <div className="border border-amber-300 dark:border-amber-700 rounded-lg overflow-hidden bg-amber-50/30 dark:bg-amber-950/20">
                      <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-amber-100/50 dark:bg-amber-900/30 items-center">
                        <div className="col-span-4 flex items-center gap-2">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              {expandedReasons.has(`sv-${reason}`) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">{reason}</span>
                          <Badge variant="secondary" className="text-xs bg-amber-200 dark:bg-amber-800">
                            {reasonBookings.length}
                          </Badge>
                        </div>
                        <div className="col-span-2 flex justify-center">
                          {reason !== "Reconciled" && reason !== "Unmapped" && (
                            <Select
                              value=""
                              onValueChange={(v) => updateSecondaryVendorReasonSelection(reason, v as "ho" | "sp")}
                            >
                              <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-sv-reason-${reason}`}>
                                <SelectValue placeholder="Bulk Net" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ho">All HO Net</SelectItem>
                                <SelectItem value="sp">All SP Net</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <div className="col-span-2 flex justify-center gap-1">
                          {reason !== "Reconciled" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={() => updateSecondaryVendorReasonDispute(reason, "all")}
                                data-testid={`button-sv-dispute-all-${reason}`}
                              >
                                Dispute All
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-muted-foreground"
                                onClick={() => updateSecondaryVendorReasonDispute(reason, "clear")}
                                data-testid={`button-sv-clear-${reason}`}
                              >
                                Clear
                              </Button>
                            </>
                          )}
                        </div>
                        <div className="col-span-4 text-right font-mono text-sm font-semibold text-amber-800 dark:text-amber-300">
                          {formatCurrency(reasonTotal)} {currency}
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className="grid grid-cols-18 gap-1 px-3 py-1.5 bg-amber-50/50 dark:bg-amber-950/30 text-xs font-medium text-muted-foreground border-t border-amber-200 dark:border-amber-800">
                          <div className="col-span-2">TID / Booking ID</div>
                          <div className="col-span-2 text-right">HO Net</div>
                          <div className="col-span-2 text-right">SP Net</div>
                          <div className="col-span-1 text-center">Net</div>
                          <div className="col-span-1 text-center">Dispute</div>
                          <div className="col-span-2 text-right">Price Payable</div>
                          <div className="col-span-3 text-right">Dispute Amt</div>
                          <div className="col-span-5 text-right">Final Reconciled Net</div>
                        </div>

                        <div className="max-h-80 overflow-y-auto">
                          {Object.entries(tidGroups).map(([tid, tidBookings]) => {
                            const tidKeyStr = svTidKey(tid);
                            const isTidExpanded = expandedTids.has(tidKeyStr);
                            return (
                              <Collapsible
                                key={tid}
                                open={isTidExpanded}
                                onOpenChange={() => toggleTid(tidKeyStr)}
                              >
                                <div className="border-t border-amber-200 dark:border-amber-800">
                                  <div className="grid grid-cols-18 gap-1 px-3 py-2 bg-amber-50/30 dark:bg-amber-950/10 items-center">
                                    <div className="col-span-2 flex items-center gap-1">
                                      <CollapsibleTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                                          {isTidExpanded ? (
                                            <ChevronDown className="h-3 w-3" />
                                          ) : (
                                            <ChevronRight className="h-3 w-3" />
                                          )}
                                        </Button>
                                      </CollapsibleTrigger>
                                      <div className="min-w-0 flex-1">
                                        <span className="font-medium text-xs truncate block" title={tid}>
                                          {tid}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {tidBookings.length} booking{tidBookings.length > 1 ? "s" : ""}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="col-span-2 text-right font-mono text-xs">
                                      {formatCurrency(tidBookings.reduce((s, b) => s + b.hoNet, 0))}
                                    </div>
                                    <div className="col-span-2 text-right font-mono text-xs">
                                      {formatCurrency(tidBookings.reduce((s, b) => s + b.spNet, 0))}
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                      {reason !== "Reconciled" && reason !== "Unmapped" && (
                                        <Select
                                          value=""
                                          onValueChange={(v) => updateSecondaryVendorTidSelection(reason, tid, v as "ho" | "sp")}
                                        >
                                          <SelectTrigger className="w-12 h-6 text-xs" data-testid={`select-sv-tid-${tid}`}>
                                            <SelectValue placeholder="All" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="ho">HO</SelectItem>
                                            <SelectItem value="sp">SP</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      )}
                                    </div>
                                    <div className="col-span-1 flex justify-center items-center">
                                      {(() => {
                                        if (reason === "Reconciled") return <span className="text-xs text-muted-foreground">-</span>;
                                        const { disputed, disputable } = getSecondaryVendorTidDisputeCount(reason, tid);
                                        if (disputable === 0) return <span className="text-xs text-muted-foreground">-</span>;
                                        return (
                                          <Checkbox
                                            checked={disputed === disputable}
                                            onCheckedChange={() => toggleSecondaryVendorTidDispute(reason, tid)}
                                            className="h-4 w-4"
                                            data-testid={`checkbox-sv-dispute-tid-${tid}`}
                                          />
                                        );
                                      })()}
                                    </div>
                                    <div className="col-span-2 text-right font-mono text-xs">
                                      {formatCurrency(tidBookings.reduce((s, b) => {
                                        if (reason === "Reconciled") return s + b.spNet;
                                        const sel = localSelections[b.bookingId] || "sp";
                                        return s + (sel === "ho" ? b.hoNet : b.spNet);
                                      }, 0))}
                                    </div>
                                    <div className="col-span-3 text-right font-mono text-xs">
                                      {formatCurrency(tidBookings.reduce((s, b) => {
                                        if (!activeDisputes.has(b.bookingId)) return s;
                                        return s + (disputeAmounts.get(b.bookingId) || 0);
                                      }, 0))}
                                    </div>
                                    <div className="col-span-5 text-right font-mono text-xs font-semibold">
                                      {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))} {currency}
                                    </div>
                                  </div>

                                  <CollapsibleContent>
                                    {tidBookings.map((booking) => {
                                      const selection = localSelections[booking.bookingId] || "sp";
                                      const isDisputed = activeDisputes.has(booking.bookingId);
                                      const disputeAmt = disputeAmounts.get(booking.bookingId) || 0;
                                      const pricePayable = reason === "Reconciled" ? booking.spNet : (selection === "ho" ? booking.hoNet : booking.spNet);
                                      const finalNet = getFinalNetPrice(booking);
                                      const canDispute = reason !== "Reconciled" && isBookingDisputable(booking);

                                      return (
                                        <div
                                          key={booking.bookingId}
                                          className="grid grid-cols-18 gap-1 px-3 py-1.5 bg-amber-50/20 dark:bg-amber-950/5 items-center border-t border-amber-100 dark:border-amber-900"
                                        >
                                          <div className="col-span-2 pl-6">
                                            <span className="text-xs font-mono">{booking.bookingId}</span>
                                          </div>
                                          <div className="col-span-2 text-right font-mono text-xs">
                                            {formatCurrency(booking.hoNet)}
                                          </div>
                                          <div className="col-span-2 text-right font-mono text-xs">
                                            {formatCurrency(booking.spNet)}
                                          </div>
                                          <div className="col-span-1 flex justify-center">
                                            {reason === "Reconciled" ? (
                                              <span className="text-xs text-muted-foreground">SP</span>
                                            ) : (
                                              <Select
                                                value={selection}
                                                onValueChange={(v) => updateSelection(booking.bookingId, v as "ho" | "sp", booking)}
                                              >
                                                <SelectTrigger className="w-12 h-6 text-xs" data-testid={`select-sv-booking-${booking.bookingId}`}>
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="ho">HO</SelectItem>
                                                  <SelectItem value="sp">SP</SelectItem>
                                                </SelectContent>
                                              </Select>
                                            )}
                                          </div>
                                          <div className="col-span-1 flex justify-center">
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
                                          </div>
                                          <div className="col-span-2 text-right font-mono text-xs">
                                            {formatCurrency(pricePayable)}
                                          </div>
                                          <div className="col-span-3 text-right">
                                            {isDisputed ? (
                                              <Input
                                                type="number"
                                                value={disputeAmt}
                                                onChange={(e) => updateDisputeAmount(booking.bookingId, parseFloat(e.target.value) || 0, booking)}
                                                className="h-6 w-20 text-xs font-mono text-right ml-auto"
                                                data-testid={`input-sv-dispute-${booking.bookingId}`}
                                              />
                                            ) : (
                                              <span className="text-xs text-muted-foreground">-</span>
                                            )}
                                          </div>
                                          <div className="col-span-5 text-right font-mono text-xs font-semibold">
                                            {formatCurrency(finalNet)} {currency}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
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

          {/* Payment Method Mismatch Section */}
          {paymentMismatchBookings.length > 0 && (
            <div className="space-y-3 pt-4 mt-4 border-t-2 border-dashed border-violet-500/50">
              <Collapsible open={isPaymentMismatchExpanded} onOpenChange={setIsPaymentMismatchExpanded}>
                <div className="flex items-center justify-between mb-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 p-0 h-auto">
                      {isPaymentMismatchExpanded ? (
                        <ChevronDown className="h-5 w-5 text-violet-600" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-violet-600" />
                      )}
                      <CreditCard className="h-5 w-5 text-violet-600" />
                      <p className="text-base font-semibold text-violet-700 dark:text-violet-400">
                        Payment Method Mismatch
                      </p>
                      <Badge variant="outline" className="border-violet-500 text-violet-700 dark:text-violet-400">
                        {paymentMismatchBookings.length} bookings
                      </Badge>
                    </Button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent>
                  {/* Bulk Update Section */}
                  <div className="flex items-center gap-3 mb-4 p-3 bg-violet-50/50 dark:bg-violet-950/20 rounded-lg border border-violet-200 dark:border-violet-800">
                    <Label className="text-sm font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap">
                      Bulk Update Final Vendor ID:
                    </Label>
                    <Input
                      type="text"
                      placeholder="Enter Vendor ID"
                      value={bulkVendorId}
                      onChange={(e) => setBulkVendorId(e.target.value)}
                      className="w-48 h-8 text-sm"
                      data-testid="input-bulk-vendor-id"
                    />
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 bg-violet-600"
                      disabled={!bulkVendorId.trim()}
                      onClick={() => {
                        const newMap = new Map(finalVendorIds);
                        for (const booking of paymentMismatchBookings) {
                          newMap.set(booking.bookingId, bulkVendorId.trim());
                        }
                        setFinalVendorIds(newMap);
                        toast({
                          title: "Bulk Update Applied",
                          description: `Updated ${paymentMismatchBookings.length} bookings with Vendor ID: ${bulkVendorId.trim()}`,
                        });
                      }}
                      data-testid="button-bulk-update-vendor"
                    >
                      Bulk Update
                    </Button>
                  </div>

                  {/* TID-level grouping */}
                  <div className="space-y-2">
                    {Object.entries(paymentMismatchByTid).map(([tid, tidBookings]) => {
                      const tidKey = `pm:${tid}`;
                      const isTidExpanded = expandedTids.has(tidKey);

                      return (
                        <Collapsible
                          key={tid}
                          open={isTidExpanded}
                          onOpenChange={() => toggleTid(tidKey)}
                        >
                          <div className="border border-violet-300 dark:border-violet-700 rounded-lg overflow-hidden bg-violet-50/30 dark:bg-violet-950/20">
                            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-violet-100/50 dark:bg-violet-900/30 items-center">
                              <div className="col-span-6 flex items-center gap-2">
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    {isTidExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </Button>
                                </CollapsibleTrigger>
                                <span className="font-mono text-sm font-medium text-violet-800 dark:text-violet-300 truncate" title={tid}>
                                  TID: {tid}
                                </span>
                                <Badge variant="secondary" className="text-xs bg-violet-200 dark:bg-violet-800">
                                  {tidBookings.length} bookings
                                </Badge>
                              </div>
                              <div className="col-span-3 text-sm text-muted-foreground">
                                HO Vendor ID
                              </div>
                              <div className="col-span-3 text-sm text-muted-foreground">
                                Final Vendor ID
                              </div>
                            </div>

                            <CollapsibleContent>
                              {tidBookings.map((booking) => {
                                const finalVendorId = finalVendorIds.get(booking.bookingId) || "";

                                return (
                                  <div
                                    key={booking.bookingId}
                                    className="grid grid-cols-12 gap-2 px-3 py-2 items-center text-sm border-t border-violet-200 dark:border-violet-800 hover:bg-violet-50/50 dark:hover:bg-violet-950/30"
                                    data-testid={`payment-mismatch-row-${booking.bookingId}`}
                                  >
                                    <div className="col-span-6 pl-8">
                                      <span className="font-mono text-xs text-muted-foreground">
                                        {booking.bookingId}
                                      </span>
                                    </div>
                                    <div className="col-span-3">
                                      <span className="font-mono text-xs">
                                        {booking.hoBeId || "-"}
                                      </span>
                                    </div>
                                    <div className="col-span-3">
                                      <Input
                                        type="text"
                                        placeholder="Enter Vendor ID"
                                        value={finalVendorId}
                                        onChange={(e) => {
                                          const newMap = new Map(finalVendorIds);
                                          newMap.set(booking.bookingId, e.target.value);
                                          setFinalVendorIds(newMap);
                                        }}
                                        className="h-7 text-xs font-mono"
                                        data-testid={`input-final-vendor-${booking.bookingId}`}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Already Reconciled Summary */}
          {alreadyReconciledBookings.length > 0 && (
            <div className="flex justify-between items-center pt-3 mt-3 border-t">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-medium">Already Reconciled ({alreadyReconciledBookings.length} bookings)</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-bold font-mono" data-testid="text-already-reconciled-total">
                  {formatCurrency(alreadyReconciledTotal)} {currency}
                </p>
                {alreadyReconciledAdjustment !== 0 && (
                  <span className="text-sm font-mono text-amber-600">
                    ({alreadyReconciledAdjustment > 0 ? "+" : ""}{formatCurrency(alreadyReconciledAdjustment)})
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-3 mt-3 border-t">
            <p className="text-sm font-medium">Payable for bookings reconciled</p>
            <p className="text-lg font-bold font-mono" data-testid="text-base-amount">
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
                const hasClosedDisputes = isDisputeAdjustment && groupedClosedDisputes.length > 0;
                const closedDisputeIds = groupedClosedDisputes.map(g => g.displayId).join(", ");
                const closedDisputeTotal = groupedClosedDisputes.reduce((sum, g) => sum + g.totalAmount, 0);
                const closedBookingCount = groupedClosedDisputes.reduce((sum, g) => sum + g.bookingCount, 0);
                
                return (
                  <div
                    key={adj.id}
                    className={`grid grid-cols-12 gap-2 items-center ${
                      hasClosedDisputes 
                        ? "p-2 rounded-md bg-green-50/50 dark:bg-green-950/20 border border-green-200 dark:border-green-800" 
                        : ""
                    }`}
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
                        hasClosedDisputes ? (
                          <div 
                            className="h-8 px-3 flex items-center text-sm font-mono bg-transparent"
                            data-testid={`text-closed-disputes-ref-${index}`}
                          >
                            {closedDisputeIds}
                          </div>
                        ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="h-8 w-full justify-start text-left font-normal"
                              data-testid={`select-disputes-${index}`}
                            >
                              {adj.selectedDisputeIds && adj.selectedDisputeIds.length > 0 ? (
                                <span className="truncate">
                                  {adj.selectedDisputeIds.length} dispute{adj.selectedDisputeIds.length > 1 ? "s" : ""} selected
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Select disputes...</span>
                              )}
                              <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-2" align="start">
                            {openDisputes.length === 0 ? (
                              <p className="text-sm text-muted-foreground p-2">No open disputes</p>
                            ) : (
                              <div className="space-y-1 max-h-48 overflow-y-auto">
                                {openDisputes.map((dispute) => {
                                  const isSelected = adj.selectedDisputeIds?.includes(dispute.displayId) || false;
                                  return (
                                    <div
                                      key={dispute.displayId}
                                      className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                                      onClick={() => {
                                        const currentIds = adj.selectedDisputeIds || [];
                                        const newIds = isSelected
                                          ? currentIds.filter(id => id !== dispute.displayId)
                                          : [...currentIds, dispute.displayId];
                                        updateAdjustmentDisputes(adj.id, newIds);
                                      }}
                                    >
                                      <Checkbox checked={isSelected} />
                                      <div className="flex-1">
                                        <span className="text-sm font-medium">{dispute.displayId}</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                          ({formatCurrency(dispute.totalDisputeAmount)} {currency})
                                        </span>
                                        {dispute.bookingCount > 1 && (
                                          <span className="text-xs text-muted-foreground ml-1">
                                            ({dispute.bookingCount} bookings)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                        )
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
                      {hasClosedDisputes ? (
                        <Badge 
                          variant="default"
                          className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        >
                          Less (SP)
                        </Badge>
                      ) : isDisputeAdjustment ? (
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
                      {hasClosedDisputes ? (
                        <div 
                          className="h-8 px-3 flex items-center justify-end text-sm font-mono font-medium text-green-700 dark:text-green-300"
                          data-testid={`text-closed-amount-${index}`}
                        >
                          -{formatCurrency(closedDisputeTotal)}
                        </div>
                      ) : (
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={adj.amount || ""}
                          onChange={(e) => updateAdjustment(adj.id, "amount", parseFloat(e.target.value) || 0)}
                          className={`font-mono h-8 ${isDisputeAdjustment ? "bg-muted" : ""}`}
                          readOnly={isDisputeAdjustment}
                          data-testid={`input-amount-${index}`}
                        />
                      )}
                    </div>

                    <div className="col-span-2 flex justify-end">
                      {hasClosedDisputes ? (
                        <Badge variant="outline" className="text-xs">
                          {closedBookingCount} booking{closedBookingCount > 1 ? "s" : ""}
                        </Badge>
                      ) : !isPreset && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAdjustment(adj.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
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

          {openDisputes.length > 0 && (
            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium mb-3">Open Disputes</p>
              <div className="space-y-1">
                {openDisputes.map((dispute) => (
                  <div
                    key={dispute.displayId}
                    className="flex items-center gap-3 p-2 rounded hover-elevate cursor-pointer"
                    onClick={() => openDisputeDialog(dispute)}
                    data-testid={`dispute-row-${dispute.displayId}`}
                  >
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-sm font-mono font-medium">{dispute.displayId}</span>
                      <span className="text-xs text-muted-foreground">
                        {dispute.billingEntityName}
                      </span>
                    </div>
                    <span className="text-sm font-mono">
                      {formatCurrency(dispute.totalDisputeAmount)} {currency}
                    </span>
                    {dispute.bookingCount > 1 && (
                      <Badge variant="secondary" className="text-xs">
                        {dispute.bookingCount} bookings
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {spErrorClosedAdjustments > 0 && (
            <div className="border border-green-200 dark:border-green-800 rounded-lg p-3 bg-green-50 dark:bg-green-950/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">SP Error Deductions</p>
                </div>
                <span className="font-mono font-medium text-green-800 dark:text-green-200">
                  -{formatCurrency(spErrorClosedAdjustments)} {currency}
                </span>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Closed disputes where supplier pays - deducted from Amount Payable
              </p>
              
              {/* Show individual closed SP Error disputes with Edit and Reopen buttons */}
              {closedDisputes.filter(d => d.closureType === "sp_error").length > 0 && (
                <div className="mt-3 space-y-2">
                  {closedDisputes
                    .filter(d => d.closureType === "sp_error")
                    .map(dispute => (
                      <div
                        key={dispute.disputeId}
                        className="flex items-center justify-between gap-2 p-2 bg-white/50 dark:bg-black/20 rounded border border-green-200/50 dark:border-green-800/50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-green-700 dark:text-green-300 truncate">
                              {dispute.bookingId}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {dispute.billingEntityName}
                            </span>
                          </div>
                          {editingClosedDispute === dispute.disputeId ? (
                            <div className="flex items-center gap-2 mt-1">
                              <Input
                                type="number"
                                value={editClosedDisputeAmount}
                                onChange={(e) => setEditClosedDisputeAmount(parseFloat(e.target.value) || 0)}
                                className="h-6 w-24 text-xs font-mono"
                                step="0.01"
                                min="0"
                                max={dispute.originalAmount}
                                data-testid={`input-edit-amount-${dispute.disputeId}`}
                              />
                              <span className="text-xs text-muted-foreground">
                                / {formatCurrency(dispute.originalAmount)}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSaveEditClosedDispute(dispute.disputeId)}
                                disabled={isSavingClosedDispute === dispute.disputeId}
                                className="h-6 px-2 text-xs text-green-600 hover:text-green-700"
                                data-testid={`button-save-edit-${dispute.disputeId}`}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelEditClosedDispute}
                                className="h-6 px-2 text-xs text-muted-foreground"
                                data-testid={`button-cancel-edit-${dispute.disputeId}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm font-mono text-green-800 dark:text-green-200">
                              -{formatCurrency(dispute.closedAmount)} {currency}
                            </span>
                          )}
                        </div>
                        {editingClosedDispute !== dispute.disputeId && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStartEditClosedDispute(dispute.disputeId, dispute.closedAmount)}
                              className="h-7 px-2 text-xs hover:bg-green-100 dark:hover:bg-green-900/50"
                              data-testid={`button-edit-${dispute.disputeId}`}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReopenDispute(dispute.disputeId)}
                              disabled={isReopeningDispute === dispute.disputeId}
                              className="h-7 px-2 text-xs hover:bg-green-100 dark:hover:bg-green-900/50"
                              data-testid={`button-reopen-${dispute.disputeId}`}
                            >
                              <RotateCcw className={`h-3 w-3 mr-1 ${isReopeningDispute === dispute.disputeId ? 'animate-spin' : ''}`} />
                              Reopen
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
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
              {spErrorClosedAdjustments > 0 && (
                <span className="text-green-600 dark:text-green-400">
                  {" - "}SP Error Deductions ({formatCurrency(spErrorClosedAdjustments)})
                </span>
              )}
              {alreadyReconciledAdjustment !== 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {alreadyReconciledAdjustment > 0 ? " + " : " - "}Already Reconciled Adj ({formatCurrency(Math.abs(alreadyReconciledAdjustment))})
                </span>
              )}
            </p>
          </div>
        </div>
      </ScrollArea>

      <div className="flex justify-end gap-2 p-4 border-t flex-shrink-0">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancel
        </Button>
        <Button onClick={handleApply} data-testid="button-apply">
          Apply
        </Button>
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

      <Dialog open={!!selectedDispute} onOpenChange={(open) => {
        if (!open) {
          closeDisputeDialog();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Close Dispute - {selectedDispute?.displayId}</DialogTitle>
            <DialogDescription>
              {selectedDispute?.billingEntityName} · {selectedDispute?.bookingCount} booking(s)
            </DialogDescription>
          </DialogHeader>
          
          {selectedDispute && (
            <div className="flex-1 flex flex-col min-h-0 space-y-4 overflow-hidden">
              {isLoadingBookingDetails ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-muted-foreground">Loading booking details...</span>
                </div>
              ) : (
                <>
                  <ScrollArea className="flex-1 min-h-0 pr-4">
                    <div className="space-y-3">
                      {Array.from(bookingClosures.values()).map((closure) => (
                        <div 
                          key={closure.disputeId}
                          className={`p-3 rounded-lg border ${closure.confirmed ? "border-primary/50 bg-primary/5" : "border-border"}`}
                          data-testid={`booking-closure-row-${closure.bookingId}`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={closure.confirmed}
                              onCheckedChange={(checked) => 
                                updateBookingClosure(closure.disputeId, { confirmed: checked === true })
                              }
                              data-testid={`checkbox-confirm-${closure.bookingId}`}
                            />
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-sm font-medium">{closure.bookingId}</span>
                                <span className="text-xs text-muted-foreground">
                                  Dispute: {formatCurrency(closure.originalAmount)} {currency}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <Label className="text-xs text-muted-foreground">Adjustment Amount</Label>
                                  <Input
                                    type="number"
                                    value={closure.adjustmentAmount}
                                    onChange={(e) => 
                                      updateBookingClosure(closure.disputeId, { 
                                        adjustmentAmount: parseFloat(e.target.value) || 0 
                                      })
                                    }
                                    className="h-8 font-mono"
                                    data-testid={`input-adjustment-${closure.bookingId}`}
                                  />
                                </div>
                                <div className="w-32">
                                  <Label className="text-xs text-muted-foreground">Error Type</Label>
                                  <Select
                                    value={closure.closureType}
                                    onValueChange={(value: "sp_error" | "ho_error") => 
                                      updateBookingClosure(closure.disputeId, { closureType: value })
                                    }
                                  >
                                    <SelectTrigger className="h-8" data-testid={`select-error-type-${closure.bookingId}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="sp_error">SP Error</SelectItem>
                                      <SelectItem value="ho_error">HO Error</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  
                  <Separator className="flex-shrink-0" />
                  
                  <div className="flex-shrink-0 space-y-3">
                    <p className="text-sm font-medium">Summary</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">SP Error (Deducted)</p>
                        <p className="font-mono font-medium text-sm">
                          {formatCurrency(closureSummary.spErrorTotal)} {currency}
                        </p>
                      </div>
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">HO Error (Absorbed)</p>
                        <p className="font-mono font-medium text-sm">
                          {formatCurrency(closureSummary.hoErrorTotal)} {currency}
                        </p>
                      </div>
                    </div>
                    
                    {closureSummary.hoErrorTotal > 0 && (
                      <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <Checkbox
                          id="accept-ho-error-all"
                          checked={acceptHoError}
                          onCheckedChange={(checked) => setAcceptHoError(checked === true)}
                          data-testid="checkbox-accept-ho-error-all"
                        />
                        <Label
                          htmlFor="accept-ho-error-all"
                          className="text-xs cursor-pointer flex-1"
                        >
                          I confirm the HO Error bookings are Headout's responsibility
                        </Label>
                      </div>
                    )}
                    
                    <Button
                      onClick={handleProcessBookingClosures}
                      disabled={
                        isProcessingClosures || 
                        closureSummary.confirmedCount === 0 ||
                        (closureSummary.hoErrorTotal > 0 && !acceptHoError)
                      }
                      className="w-full"
                      data-testid="button-process-closures"
                    >
                      {isProcessingClosures ? (
                        "Processing..."
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Close {closureSummary.confirmedCount} Booking(s)
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
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
    </div>
  );
}

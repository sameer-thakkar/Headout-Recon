import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Check, Gavel, FileWarning, AlertTriangle, X as XIcon,
  BarChart3, PanelTopClose, PanelTop, CheckCheck, Calculator, Loader2,
  Sparkles, Zap, Pencil, Save
} from "lucide-react";
import type { DiscrepancyAnalysisRow, PrimaryRow } from "@shared/schema";
import { driTeams } from "@shared/schema";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const strValue = String(value);
  const numValue = Number(strValue);
  if (!isNaN(numValue) && numValue > 1000 && numValue < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + numValue * 24 * 60 * 60 * 1000);
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  }
  const dateStr = strValue.split("T")[0];
  const [year, month, day] = dateStr.split("-");
  if (year && month && day && year.length === 4) return `${day}/${month}/${year}`;
  return strValue;
}

interface TidGroup {
  tid: string;
  bookings: PrimaryRow[];
  spNet: number;
  hoNet: number;
  discLc: number;
  discUsd: number;
  bidCount: number;
  fulfillmentMethods: string[];
  hasPax: boolean;
}

interface DiscrepancySummaryWorkspaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string | null;
  runId: string | null;
  primaryRows: PrimaryRow[];
  secondaryVendorRows: PrimaryRow[];
  unmappedRows: PrimaryRow[];
  analysisRows: DiscrepancyAnalysisRow[];
  isLoadingAnalysis: boolean;
  billingEntityId?: string;
  billingEntityName?: string;
  currency?: string;
}

function analyzeTakeRateInsight(bookings: PrimaryRow[]): string | null {
  const withHsp = bookings.filter(b => b.headoutSellingPrice && b.headoutSellingPrice > 0);
  if (withHsp.length < 2) return null;
  const rates = withHsp.map(b => {
    const hsp = b.headoutSellingPrice!;
    const hoTake = ((hsp - (b.hoNet || 0)) / hsp) * 100;
    const actualTake = ((hsp - (b.spNetInHo || 0)) / hsp) * 100;
    return { hoTake, actualTake, gap: hoTake - actualTake };
  });
  const avgGap = rates.reduce((s, r) => s + r.gap, 0) / rates.length;
  if (Math.abs(avgGap) < 0.5) return null;
  const avgHo = rates.reduce((s, r) => s + r.hoTake, 0) / rates.length;
  const avgActual = rates.reduce((s, r) => s + r.actualTake, 0) / rates.length;
  const lossCount = rates.filter(r => r.actualTake < 0).length;
  if (lossCount > 0) {
    return `Margin erosion: HO expected ${avgHo.toFixed(1)}% but actual is ${avgActual.toFixed(1)}%. ${lossCount}/${rates.length} bookings sold at loss.`;
  }
  if (avgGap > 0) {
    return `Take rate gap: HO expected ${avgHo.toFixed(1)}% vs actual ${avgActual.toFixed(1)}% (${Math.abs(avgGap).toFixed(1)}pp shortfall).`;
  }
  return `SP charging below agreed rate: actual ${avgActual.toFixed(1)}% vs expected ${avgHo.toFixed(1)}%.`;
}

export function DiscrepancySummaryWorkspace({
  open,
  onOpenChange,
  reason,
  runId,
  primaryRows,
  secondaryVendorRows,
  unmappedRows,
  analysisRows,
  isLoadingAnalysis,
  billingEntityId,
  billingEntityName,
  currency,
}: DiscrepancySummaryWorkspaceProps) {
  const { toast } = useToast();
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [highlightedTid, setHighlightedTid] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");
  const [selectedTids, setSelectedTids] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [bulkScope, setBulkScope] = useState<"all" | "selected">("all");

  const [issueOpen, setIssueOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [issueDescription, setIssueDescription] = useState("");
  const [issuePriority, setIssuePriority] = useState<string>("medium");
  const [issueDriTeam, setIssueDriTeam] = useState<string>("");
  const [disputedBookings, setDisputedBookings] = useState<Set<string>>(new Set());
  const [paxOpen, setPaxOpen] = useState(false);
  const [paxTid, setPaxTid] = useState<TidGroup | null>(null);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});
  const [issueModalTid, setIssueModalTid] = useState<TidGroup | null>(null);

  const [showTidBreakdown, setShowTidBreakdown] = useState(false);
  const [showTakeAction, setShowTakeAction] = useState(false);
  const [takeActionPrice, setTakeActionPrice] = useState<"sp" | "ho">("sp");
  const [takeActionDisputes, setTakeActionDisputes] = useState<Set<string>>(new Set());
  const [takeActionIssues, setTakeActionIssues] = useState<Set<string>>(new Set());
  const [disputePaxExpanded, setDisputePaxExpanded] = useState<string | null>(null);
  const [disputePaxPrices, setDisputePaxPrices] = useState<Record<string, Record<string, { tap?: string; dispute?: string }>>>({});
  const [step2Collapsed, setStep2Collapsed] = useState(false);
  const [step3Collapsed, setStep3Collapsed] = useState(true);
  const [bookingSelections, setBookingSelections] = useState<Record<string, "sp" | "ho" | "custom">>({});
  const [bookingCustomPrices, setBookingCustomPrices] = useState<Record<string, string>>({});
  const [bookingEditMode, setBookingEditMode] = useState<Record<string, boolean>>({});
  const [savedBookings, setSavedBookings] = useState<Set<string>>(new Set());
  const [bidDisputeActive, setBidDisputeActive] = useState<Set<string>>(new Set());
  const [bidDisputeAmounts, setBidDisputeAmounts] = useState<Record<string, number>>({});
  const [bidTapOverrides, setBidTapOverrides] = useState<Record<string, string>>({});

  const isMTB = reason === "Multiple Tickets Booked";
  const isNPD = reason === "Net Price Discrepancy";

  useEffect(() => {
    setShowTidBreakdown(false);
  }, [reason]);

  const filteredAnalysis = useMemo(() => {
    if (!analysisRows || !reason) return [];
    const filtered = analysisRows.filter(row => row.reason === reason);
    if (isNPD) return [...filtered].sort((a, b) => (a.discrepancyUsd ?? 0) - (b.discrepancyUsd ?? 0));
    return filtered;
  }, [analysisRows, reason, isNPD]);

  const allRows = useMemo(() => [...primaryRows, ...secondaryVendorRows, ...unmappedRows], [primaryRows, secondaryVendorRows, unmappedRows]);

  const tidGroups = useMemo((): TidGroup[] => {
    if (!reason) return [];
    const reasonRows = allRows.filter(r => r.reason === reason);
    const tidMap = new Map<string, PrimaryRow[]>();
    for (const r of reasonRows) {
      const tid = r.tid || r.bookingId;
      if (!tidMap.has(tid)) tidMap.set(tid, []);
      tidMap.get(tid)!.push(r);
    }
    return Array.from(tidMap.entries()).map(([tid, bookings]) => {
      const spNet = bookings.reduce((s, b) => s + (b.spNetInHo || 0), 0);
      const hoNet = bookings.reduce((s, b) => s + (b.hoNet || 0), 0);
      const fmSet = new Set<string>();
      let hasPax = false;
      bookings.forEach(b => {
        if (b.fulfillmentMethod) fmSet.add(b.fulfillmentMethod);
        if (b.paxBreakdown && b.paxBreakdown.length > 0) hasPax = true;
      });
      return {
        tid,
        bookings,
        spNet: Math.round(spNet * 100) / 100,
        hoNet: Math.round(hoNet * 100) / 100,
        discLc: Math.round((hoNet - spNet) * 100) / 100,
        discUsd: 0,
        bidCount: bookings.length,
        fulfillmentMethods: Array.from(fmSet),
        hasPax,
      };
    }).sort((a, b) => Math.abs(b.discLc) - Math.abs(a.discLc));
  }, [allRows, reason]);

  const detectedDriTeam = useMemo(() => {
    const match = allRows.find(r => r.reason === reason && r.driTeam);
    return match?.driTeam || "Tech";
  }, [allRows, reason]);

  const predictiveInsight = useMemo(() => {
    if (!reason || tidGroups.length === 0) return null;
    const topTid = tidGroups[0];
    return analyzeTakeRateInsight(topTid.bookings);
  }, [tidGroups, reason]);

  const priceOverrideMutation = useMutation({
    mutationFn: async ({ bookingIds, selection, customPrices }: { bookingIds: string[]; selection: "ho" | "sp"; customPrices?: Record<string, number> }) => {
      if (!runId) throw new Error("No active run");
      const overrides: Record<string, { totalAmountPayable: number; selection: "ho" | "sp" }> = {};
      bookingIds.forEach(id => {
        if (customPrices && customPrices[id] !== undefined) {
          overrides[id] = { totalAmountPayable: customPrices[id], selection };
        } else {
          const row = allRows.find(r => r.bookingId === id);
          const amt = selection === "ho" ? (row?.hoNet || 0) : (row?.spNetInHo || 0);
          overrides[id] = { totalAmountPayable: amt, selection };
        }
      });
      await apiRequest("POST", "/api/price-overrides", { runId, overrides });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs", runId] });
    },
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ bookingIds }: { bookingIds: string[] }) => {
      if (!runId) throw new Error("No active run");
      const disputes = bookingIds.map(bookingId => {
        const row = allRows.find(r => r.bookingId === bookingId);
        return {
          bookingId,
          ticketId: row?.ticketId || "",
          tid: row?.tid || bookingId,
          disputeAmount: Math.abs((row?.spNetInHo || 0) - (row?.hoNet || 0)),
          reconciledNet: row?.spNetInHo || 0,
        };
      });
      await apiRequest("POST", `/api/disputes/${runId}`, { disputes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes", runId] });
    },
  });

  const issueMutation = useMutation({
    mutationFn: async ({ bookingIds, description, priority, driTeam }: { bookingIds: string[]; description: string; priority: string; driTeam: string }) => {
      if (!runId) throw new Error("No active run");
      const totalDiscLc = tidGroups.reduce((s, t) => s + Math.abs(t.discLc), 0);
      await apiRequest("POST", "/api/issues", {
        runId,
        billingEntityId: billingEntityId || "",
        billingEntityName: billingEntityName || "",
        currency: currency || "USD",
        discrepancyLocal: totalDiscLc,
        discrepancyUsd: totalDiscLc,
        reason: reason || "",
        driTeam,
        bookingIds,
        errorBucket: reason || "",
        rca: description || "",
        issueStatus: priority === "high" ? "urgent" : priority === "low" ? "low-priority" : "open",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/issues", runId] });
    },
  });

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));
  const resolveMultiple = (tids: string[]) => setResolvedTids(prev => { const next = new Set(prev); tids.forEach(t => next.add(t)); return next; });

  const toggleSelect = (tid: string) => {
    setSelectedTids(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else next.add(tid); return next; });
  };

  const filteredTids = tidGroups.filter(t =>
    !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) ||
    t.bookings.some(b => b.bookingId?.toLowerCase().includes(tidSearch.toLowerCase()))
  );

  const toggleSelectAll = () => {
    const unresolved = filteredTids.filter(t => !resolvedTids.has(t.tid));
    if (selectedTids.size === unresolved.length) setSelectedTids(new Set());
    else setSelectedTids(new Set(unresolved.map(t => t.tid)));
  };

  const handleAnalysisClick = (tid: string) => {
    setHighlightedTid(tid);
    setExpandedTid(tid);
    setTimeout(() => {
      document.getElementById(`ws-tid-${tid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightedTid(null), 3000);
  };

  const getBulkTids = () => bulkScope === "all" ? tidGroups.map(t => t.tid) : Array.from(selectedTids);
  const getBulkTidData = () => bulkScope === "all" ? tidGroups : tidGroups.filter(t => selectedTids.has(t.tid));
  const getBulkBookingIds = () => {
    const tids = getBulkTids();
    const tidSet = new Set(tids);
    return tidGroups.filter(t => tidSet.has(t.tid)).flatMap(t => t.bookings.map(b => b.bookingId));
  };

  const handleBulkAction = useCallback((action: string) => {
    const tids = getBulkTids();
    const bookingIds = getBulkBookingIds();
    if (action === "ho" || action === "sp") {
      priceOverrideMutation.mutate({ bookingIds, selection: action }, {
        onSuccess: () => {
          resolveMultiple(tids);
          flash(`${tids.length} TIDs → ${action === "sp" ? "SP" : "HO"} Net applied`);
          toast({ title: "Price overrides saved", description: `Applied ${action.toUpperCase()} Net to ${bookingIds.length} bookings` });
        },
        onError: (err) => {
          toast({ title: "Failed to apply", description: String(err), variant: "destructive" });
        },
      });
    } else if (action === "dispute") {
      disputeMutation.mutate({ bookingIds }, {
        onSuccess: () => {
          setDisputedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
          flash(`Dispute raised for ${tids.length} TIDs (${bookingIds.length} bookings)`);
          toast({ title: "Disputes created", description: `${bookingIds.length} dispute records created` });
        },
        onError: (err) => {
          toast({ title: "Dispute creation failed", description: String(err), variant: "destructive" });
        },
      });
    } else if (action === "issue") {
      setIssueOpen(true);
    }
    setSelectedTids(new Set());
    setBulkConfirm(null);
  }, [tidGroups, selectedTids, bulkScope, priceOverrideMutation, disputeMutation, toast]);

  const getBookingFinalPrice = useCallback((b: PrimaryRow): number => {
    const sel = bookingSelections[b.bookingId];
    if (sel === "custom") {
      const v = parseFloat(bookingCustomPrices[b.bookingId] || "0");
      return isNaN(v) ? (b.spNetInHo || 0) : v;
    }
    if (sel === "ho") return b.hoNet || 0;
    return b.spNetInHo || 0;
  }, [bookingSelections, bookingCustomPrices]);

  const getBidSelection = useCallback((bookingId: string): "ho" | "sp" | "custom" => {
    const sel = bookingSelections[bookingId];
    if (sel === "ho") return "ho";
    if (sel === "custom") return "custom";
    return "sp";
  }, [bookingSelections]);

  const updateBidSelection = useCallback((bookingId: string, value: "ho" | "sp") => {
    setBookingSelections(prev => ({ ...prev, [bookingId]: value }));
    setBookingCustomPrices(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    setBookingEditMode(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    setSavedBookings(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
    if (value === "ho") {
      setBidDisputeActive(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
      setBidDisputeAmounts(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    }
  }, []);

  const getBidFinalNet = useCallback((b: PrimaryRow): number => {
    const rawSel = bookingSelections[b.bookingId];
    if (rawSel === "custom") {
      const v = parseFloat(bookingCustomPrices[b.bookingId] || "0");
      return isNaN(v) ? (b.spNetInHo || 0) : v;
    }
    const sel = getBidSelection(b.bookingId);
    return sel === "ho" ? (b.hoNet || 0) : (b.spNetInHo || 0);
  }, [getBidSelection, bookingSelections, bookingCustomPrices]);

  const getBidMaxDispute = useCallback((b: PrimaryRow): number => {
    return Math.round(Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100;
  }, []);

  const getBidDisputeAmount = useCallback((bookingId: string): number => {
    return bidDisputeAmounts[bookingId] || 0;
  }, [bidDisputeAmounts]);

  const getEffectiveTap = useCallback((b: PrimaryRow): number => {
    const base = getBidFinalNet(b);
    const override = bidTapOverrides[b.bookingId];
    if (override === undefined || override === "") return base;
    const val = parseFloat(override);
    if (isNaN(val)) return base;
    const minTap = Math.round(base * 0.9 * 100) / 100;
    const maxTap = Math.round(base * 1.1 * 100) / 100;
    return Math.round(Math.min(Math.max(val, minTap), maxTap) * 100) / 100;
  }, [getBidFinalNet, bidTapOverrides]);

  const setBidDisputeAmountForBooking = useCallback((bookingId: string, amount: number, booking?: PrimaryRow) => {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded <= 0) {
      setBidDisputeActive(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
      setBidDisputeAmounts(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    } else {
      let clamped = rounded;
      if (booking) {
        const maxD = Math.round(Math.abs((booking.hoNet || 0) - (booking.spNetInHo || 0)) * 100) / 100;
        if (clamped > maxD) clamped = maxD;
      }
      setBidDisputeAmounts(prev => ({ ...prev, [bookingId]: clamped }));
    }
  }, []);

  const activateBidDispute = useCallback((bookingId: string, b: PrimaryRow) => {
    setBidDisputeActive(prev => { const n = new Set(prev); n.add(bookingId); return n; });
    const maxD = Math.round(Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100;
    setBidDisputeAmounts(prev => ({ ...prev, [bookingId]: maxD }));
    setBookingSelections(prev => ({ ...prev, [bookingId]: "sp" }));
    setSavedBookings(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
  }, []);

  const handleTidBulkDispute = useCallback((tid: TidGroup, action: "all" | "clear") => {
    tid.bookings.forEach(b => {
      const sel = getBidSelection(b.bookingId);
      if (action === "all" && (sel === "sp" || sel === "custom")) {
        setBidDisputeActive(prev => { const n = new Set(prev); n.add(b.bookingId); return n; });
        const maxD = Math.round(Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100;
        setBidDisputeAmounts(prev => ({ ...prev, [b.bookingId]: maxD }));
      } else if (action === "clear") {
        setBidDisputeActive(prev => { const n = new Set(prev); n.delete(b.bookingId); return n; });
        setBidDisputeAmounts(prev => { const n = { ...prev }; delete n[b.bookingId]; return n; });
      }
    });
  }, [getBidSelection]);

  const handleBookingSave = useCallback((b: PrimaryRow) => {
    const sel = bookingSelections[b.bookingId] || "sp";
    const finalSel = sel === "custom" ? "sp" : sel;
    const customPrices: Record<string, number> = {};
    if (sel === "custom") {
      customPrices[b.bookingId] = getBookingFinalPrice(b);
    }
    priceOverrideMutation.mutate({ bookingIds: [b.bookingId], selection: finalSel, customPrices: Object.keys(customPrices).length > 0 ? customPrices : undefined }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); next.add(b.bookingId); return next; });
        flash(`${b.bookingId} → price saved`);
      },
      onError: (err) => {
        toast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [bookingSelections, getBookingFinalPrice, priceOverrideMutation, toast]);

  const handleTidSaveAll = useCallback((tid: TidGroup) => {
    const customPrices: Record<string, number> = {};
    const bookingIds = tid.bookings.map(b => b.bookingId);
    tid.bookings.forEach(b => {
      customPrices[b.bookingId] = getBookingFinalPrice(b);
    });
    priceOverrideMutation.mutate({ bookingIds, selection: "sp", customPrices }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        resolve(tid.tid);
        flash(`${tid.tid} → all booking prices saved`);
      },
      onError: (err) => {
        toast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [getBookingFinalPrice, priceOverrideMutation, toast]);

  const handleTidAction = useCallback((tid: TidGroup, action: "sp" | "ho") => {
    const bookingIds = tid.bookings.map(b => b.bookingId);
    setBookingSelections(prev => {
      const next = { ...prev };
      bookingIds.forEach(id => { next[id] = action; });
      return next;
    });
    setBookingCustomPrices(prev => {
      const next = { ...prev };
      bookingIds.forEach(id => { delete next[id]; });
      return next;
    });
    setBookingEditMode(prev => {
      const next = { ...prev };
      bookingIds.forEach(id => { delete next[id]; });
      return next;
    });
    if (action === "ho") {
      setBidDisputeActive(prev => { const n = new Set(prev); bookingIds.forEach(id => n.delete(id)); return n; });
      setBidDisputeAmounts(prev => { const n = { ...prev }; bookingIds.forEach(id => { delete n[id]; }); return n; });
    }
    priceOverrideMutation.mutate({ bookingIds, selection: action }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        resolve(tid.tid);
        setExpandedTid(null);
        flash(`${tid.tid} → ${action === "sp" ? "SP" : "HO"} Net applied`);
      },
      onError: (err) => {
        toast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [priceOverrideMutation, toast]);

  const handleTidDispute = useCallback((tid: TidGroup) => {
    const bookingIds = tid.bookings.map(b => b.bookingId);
    disputeMutation.mutate({ bookingIds }, {
      onSuccess: () => {
        setDisputedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        flash(`Dispute raised for ${tid.tid} (${bookingIds.length} bookings)`);
      },
      onError: (err) => {
        toast({ title: "Dispute failed", description: String(err), variant: "destructive" });
      },
    });
  }, [disputeMutation, toast]);

  const [issueScopeTids, setIssueScopeTids] = useState<string[] | null>(null);

  const handleTidIssue = useCallback((tid: TidGroup) => {
    setIssueModalTid(tid);
    setIssueScopeTids([tid.tid]);
    setIssueDriTeam("");
    setIssuePriority("medium");
    const insight = analyzeTakeRateInsight(tid.bookings);
    setIssueDescription(insight || "");
  }, []);

  const handleSubmitIssue = useCallback(() => {
    const scopedGroups = issueScopeTids
      ? tidGroups.filter(t => issueScopeTids.includes(t.tid))
      : tidGroups;
    const bookingIds = scopedGroups.flatMap(t => t.bookings.map(b => b.bookingId));
    issueMutation.mutate({
      bookingIds,
      description: issueDescription,
      priority: issuePriority,
      driTeam: issueDriTeam || detectedDriTeam,
    }, {
      onSuccess: () => {
        flash("Issue logged successfully");
        toast({ title: "Issue created", description: `Issue logged for ${reason}` });
        setIssueOpen(false);
        setIssueModalTid(null);
        setIssueDescription("");
      },
      onError: (err) => {
        toast({ title: "Issue creation failed", description: String(err), variant: "destructive" });
      },
    });
  }, [tidGroups, issueScopeTids, issueDescription, issuePriority, issueDriTeam, detectedDriTeam, reason, issueMutation, toast]);

  const handleBulkDispute = useCallback(() => {
    const bookingIds = tidGroups.flatMap(t => t.bookings.map(b => b.bookingId));
    disputeMutation.mutate({ bookingIds }, {
      onSuccess: () => {
        setDisputedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        flash(`Disputes raised for all ${tidGroups.length} TIDs`);
        toast({ title: "Disputes created", description: `${bookingIds.length} dispute records` });
        setDisputeOpen(false);
      },
      onError: (err) => {
        toast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [tidGroups, disputeMutation, toast]);

  const clearDisputesMutation = useMutation({
    mutationFn: async ({ bookingIds }: { bookingIds: string[] }) => {
      if (!runId) throw new Error("No active run");
      await apiRequest("DELETE", `/api/disputes/${runId}/bulk`, { bookingIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes", runId] });
    },
  });

  const handleClearAllDisputes = useCallback(() => {
    const bookingIds = tidGroups.flatMap(t => t.bookings.map(b => b.bookingId));
    clearDisputesMutation.mutate({ bookingIds }, {
      onSuccess: () => {
        setDisputedBookings(new Set());
        flash("All disputes cleared");
        setDisputeOpen(false);
        toast({ title: "Disputes cleared", description: `${bookingIds.length} disputes removed` });
      },
      onError: (err) => {
        toast({ title: "Failed to clear disputes", description: String(err), variant: "destructive" });
      },
    });
  }, [tidGroups, runId, clearDisputesMutation, toast]);

  const openDiscrepancyAction = (action: string) => { setBulkScope("all"); setBulkConfirm(action); };
  const openSelectionAction = (action: string) => { setBulkScope("selected"); setBulkConfirm(action); };

  const totalDisc = tidGroups.reduce((s, t) => s + Math.abs(t.discLc), 0);
  const resolvedCount = tidGroups.filter(t => resolvedTids.has(t.tid)).length;
  const totalDisputeAmount = useMemo(() => {
    return tidGroups.flatMap(t => t.bookings)
      .filter(b => !disputedBookings.has(b.bookingId))
      .reduce((s, b) => s + Math.abs((b.spNetInHo || 0) - (b.hoNet || 0)), 0);
  }, [tidGroups, disputedBookings]);

  if (!reason) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setExpandedTid(null);
        setAnalysisOpen(true);
        setResolvedTids(new Set());
        setSelectedTids(new Set());
        setBulkConfirm(null);
        setTidSearch("");
        setFeedback(null);
        setIssueOpen(false);
        setIssueModalTid(null);
        setDisputeOpen(false);
        setIssueDescription("");
        setIssueScopeTids(null);
        setDisputedBookings(new Set());
        setPaxOpen(false);
        setPaxTid(null);
        setPaxPrices({});
        setShowTidBreakdown(false);
        setShowTakeAction(false);
        setTakeActionPrice("sp");
        setTakeActionDisputes(new Set());
        setTakeActionIssues(new Set());
        setDisputePaxExpanded(null);
        setDisputePaxPrices({});
      }
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0" data-testid="discrepancy-workspace">
        <div className="border-b px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{reason}</span>
            <Badge variant="secondary" className="text-xs">{tidGroups.reduce((s, t) => s + t.bidCount, 0)} bookings</Badge>
            <Badge variant="outline" className="text-xs">{tidGroups.length} TIDs</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {resolvedCount > 0 && (
              <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <CheckCircle2 className="h-3 w-3 mr-1" />{resolvedCount}/{tidGroups.length}
              </Badge>
            )}
          </div>
        </div>

        {feedback && (
          <div className="mx-4 mt-2 px-3 py-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md flex items-center gap-2 text-sm text-green-700 dark:text-green-300 animate-in fade-in duration-200">
            <CheckCircle2 className="h-4 w-4" />{feedback}
          </div>
        )}

        {predictiveInsight && (
          <div className="mx-4 mt-2 px-3 py-2 rounded-md border border-violet-200 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 flex items-start gap-2 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 flex-shrink-0 mt-0.5" />
            <span className="text-violet-800 dark:text-violet-300">{predictiveInsight}</span>
          </div>
        )}

        <div className="flex-1 overflow-auto flex flex-col min-h-0">
          <div className="flex-shrink-0 border-b">
            <div
              className="flex items-center justify-between px-4 py-2 bg-violet-50/70 dark:bg-violet-950/30 border-b cursor-pointer hover:bg-violet-50 dark:hover:bg-violet-950/50"
              onClick={() => setAnalysisOpen(!analysisOpen)}
              data-testid="analysis-panel-toggle"
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Discrepancy Analysis</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700">
                  {filteredAnalysis.length} TIDs
                </Badge>
                <span className="text-[11px] text-violet-600 dark:text-violet-400">Click a row to jump to actions ↓</span>
              </div>
              {analysisOpen ? <PanelTopClose className="h-4 w-4 text-violet-500" /> : <PanelTop className="h-4 w-4 text-violet-500" />}
            </div>
            {analysisOpen && (
              <div className="max-h-[32vh] overflow-auto">
                {isLoadingAnalysis ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading analysis...
                  </div>
                ) : filteredAnalysis.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No analysis data available</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="h-8 bg-violet-50/40 dark:bg-violet-950/20">
                        <TableHead className="py-1.5 text-xs pl-4">TID</TableHead>
                        <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                        <TableHead className="py-1.5 text-xs">Fulfilment</TableHead>
                        {isMTB && (
                          <>
                            <TableHead className="py-1.5 text-xs">Times Charged</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BID Count</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BID Count Dur.</TableHead>
                            <TableHead className="py-1.5 text-xs">DRI Team</TableHead>
                          </>
                        )}
                        {isNPD && (
                          <>
                            <TableHead className="py-1.5 text-xs text-right">HO Rate</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Actual</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Disc %</TableHead>
                            <TableHead className="py-1.5 text-xs text-center">Loss?</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Loss USD</TableHead>
                          </>
                        )}
                        <TableHead className="py-1.5 text-xs">Start</TableHead>
                        <TableHead className="py-1.5 text-xs">End</TableHead>
                        <TableHead className="py-1.5 text-xs text-right">BIDs w/ Disc</TableHead>
                        <TableHead className="py-1.5 text-xs text-right pr-4">BIDs Dur.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAnalysis.map((row, i) => (
                        <TableRow
                          key={`${row.tid}-${i}`}
                          className={`h-9 cursor-pointer hover:bg-violet-50/60 dark:hover:bg-violet-950/40 ${resolvedTids.has(row.tid) ? "opacity-50" : ""}`}
                          onClick={() => handleAnalysisClick(row.tid)}
                          data-testid={`analysis-row-${row.tid}`}
                        >
                          <TableCell className="py-1.5 pl-4 font-mono text-sm text-primary font-medium">
                            <div className="flex items-center gap-1.5">
                              {resolvedTids.has(row.tid) && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                              {row.tid}
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono text-sm text-red-600 dark:text-red-400">{fmt(row.discrepancyUsd)}</TableCell>
                          <TableCell className="py-1.5 text-sm">{row.fulfillmentMethod}</TableCell>
                          {isMTB && (
                            <>
                              <TableCell className="py-1.5 text-sm">{row.timesCharged}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidWithDiscrepancy}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidsInDuration}</TableCell>
                              <TableCell className="py-1.5 text-sm">{row.driTeam}</TableCell>
                            </>
                          )}
                          {isNPD && (
                            <>
                              <TableCell className="py-1.5 text-right font-mono text-sm">{row.hoTakeRatePercent?.toFixed(2) ?? "—"}%</TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${(row.actualTakeRatePercent ?? 0) < 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                {row.actualTakeRatePercent?.toFixed(2) ?? "—"}%
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${row.discrepancyPercentRange?.startsWith("-") ? "text-red-600 dark:text-red-400" : ""}`}>
                                {row.discrepancyPercentRange || "—"}
                              </TableCell>
                              <TableCell className="py-1.5 text-center">
                                <Badge variant={row.soldAtLoss === "Yes" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                                  {row.soldAtLoss || "—"}
                                </Badge>
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${(row.lossUsd ?? 0) > 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                {row.lossUsd != null ? fmt(row.lossUsd) : "—"}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="py-1.5 text-sm">{formatDate(row.startDate)}</TableCell>
                          <TableCell className="py-1.5 text-sm">{formatDate(row.endDate)}</TableCell>
                          <TableCell className="py-1.5 text-right text-sm">{row.countBidWithDiscrepancy}</TableCell>
                          <TableCell className="py-1.5 text-right text-sm pr-4">{row.countBidsInDuration}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto px-4 pb-4 pt-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Actions</span>
                <Badge variant="secondary" className="text-xs">{tidGroups.length} TIDs</Badge>
              </div>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search TIDs / BIDs..." className="h-8 pl-8 w-48 text-xs" value={tidSearch} onChange={e => setTidSearch(e.target.value)} data-testid="workspace-tid-search" />
              </div>
            </div>

            {!bulkConfirm && !showTakeAction && (
              <div className="rounded-lg border bg-muted/30 dark:bg-muted/10 px-4 py-3 flex items-center gap-4 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">All {tidGroups.length} TIDs:</span>
                <div className="h-4 w-px bg-border" />
                <Button size="sm" className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shrink-0" onClick={() => { setShowTakeAction(true); setTakeActionPrice("sp"); setTakeActionDisputes(new Set()); setTakeActionIssues(new Set()); setDisputePaxExpanded(null); setDisputePaxPrices({}); }} data-testid="take-action-btn">
                  <Zap className="h-3.5 w-3.5" /> Take Action
                </Button>
                <span className="text-xs text-muted-foreground">Set price, raise disputes &amp; log issues in one guided flow</span>
              </div>
            )}

            {showTakeAction && !bulkConfirm && (() => {
              const allTids = tidGroups;
              const isSp = takeActionPrice === "sp";
              const totalSp = allTids.reduce((s, t) => s + t.spNet, 0);
              const totalHo = allTids.reduce((s, t) => s + t.hoNet, 0);
              const totalPayable = isSp ? totalSp : totalHo;
              const totalDiff = Math.abs(totalSp - totalHo);

              const getDisputeDiff = (t: TidGroup) => {
                if (t.hasPax) {
                  const tidPaxEdits = disputePaxPrices[t.tid];
                  if (tidPaxEdits && Object.keys(tidPaxEdits).length > 0) {
                    const allPax = t.bookings.flatMap(b => b.paxBreakdown || []);
                    return allPax.reduce((s, p) => {
                      const k = `${p.paxType}__${p.unitPrice}`;
                      const entry = tidPaxEdits[k];
                      const disp = entry?.dispute !== undefined && entry.dispute !== "" ? parseFloat(entry.dispute) : (p.unitPrice - (p.priceNet / p.count || 0));
                      return s + Math.abs(disp) * p.count;
                    }, 0);
                  }
                }
                return Math.abs(t.spNet - t.hoNet);
              };

              const getTidTap = (t: TidGroup) => {
                if (t.hasPax) {
                  const tidPaxEdits = disputePaxPrices[t.tid];
                  if (tidPaxEdits && Object.keys(tidPaxEdits).length > 0) {
                    const allPax = t.bookings.flatMap(b => b.paxBreakdown || []);
                    return allPax.reduce((s, p) => {
                      const k = `${p.paxType}__${p.unitPrice}`;
                      const entry = tidPaxEdits[k];
                      const tap = entry?.tap !== undefined && entry.tap !== "" ? parseFloat(entry.tap) : p.unitPrice;
                      return s + tap * p.count;
                    }, 0);
                  }
                }
                return isSp ? t.spNet : t.hoNet;
              };

              const disputeTotal = allTids.filter(t => takeActionDisputes.has(t.tid)).reduce((s, t) => s + getDisputeDiff(t), 0);
              const disputeCount = takeActionDisputes.size;
              const issueCount = takeActionIssues.size;

              const toggleDisputeTid = (tid: string) => { setTakeActionDisputes(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else { next.add(tid); setStep2Collapsed(false); } return next; }); };
              const toggleIssueTid = (tid: string) => { setTakeActionIssues(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else { next.add(tid); setStep3Collapsed(false); } return next; }); };

              const summaryParts = [isSp ? "SP Net" : "HO Net"];
              if (disputeCount > 0) summaryParts.push(`${disputeCount} dispute${disputeCount > 1 ? "s" : ""}`);
              if (issueCount > 0) summaryParts.push(`${issueCount} issue${issueCount > 1 ? "s" : ""}`);

              return (
                <div className="rounded-lg border-2 border-primary/30 bg-background p-4 space-y-4 animate-in fade-in duration-200" data-testid="take-action-panel">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Zap className="h-4 w-4 text-primary" />
                      Take Action — All {allTids.length} TIDs
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setShowTakeAction(false); setTakeActionDisputes(new Set()); }} data-testid="close-take-action">
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">Step 1: Select Price</div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className={`h-8 text-xs gap-1.5 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-transparent border border-blue-300 text-blue-700 hover:bg-blue-50"}`} onClick={() => { setTakeActionPrice("sp"); setTakeActionDisputes(new Set()); }} data-testid="take-action-sp">
                        <TrendingUp className="h-3.5 w-3.5" /> SP Net {isSp && <Check className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" className={`h-8 text-xs gap-1.5 ${!isSp ? "bg-green-700 hover:bg-green-800 text-white" : "bg-transparent border border-green-300 text-green-700 hover:bg-green-50"}`} onClick={() => { setTakeActionPrice("ho"); setTakeActionDisputes(new Set()); }} data-testid="take-action-ho">
                        <TrendingDown className="h-3.5 w-3.5" /> HO Net {!isSp && <Check className="h-3 w-3" />}
                      </Button>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="rounded border p-2 bg-muted/30"><span className="text-muted-foreground">SP Net</span><div className={`font-mono font-semibold ${isSp ? "text-blue-700" : "text-muted-foreground"}`}>{fmt(totalSp)}</div></div>
                      <div className="rounded border p-2 bg-muted/30"><span className="text-muted-foreground">HO Net</span><div className={`font-mono font-semibold ${!isSp ? "text-green-700" : "text-muted-foreground"}`}>{fmt(totalHo)}</div></div>
                      <div className="rounded border p-2 bg-muted/30"><span className="text-muted-foreground">Difference</span><div className="font-mono font-semibold text-amber-600">{fmt(totalDiff)}</div></div>
                      <div className={`rounded border-2 p-2 ${isSp ? "border-blue-300 bg-blue-50/50" : "border-green-300 bg-green-50/50"}`}><span className="text-muted-foreground">Payable</span><div className={`font-mono font-bold ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(totalPayable)}</div></div>
                    </div>
                    {!isSp && (
                      <div className="flex items-start gap-2.5 rounded-md border-2 border-amber-400 bg-amber-50/60 px-3 py-2.5">
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 leading-relaxed">
                          You have selected HO Net. We have already been charged SP Net for this booking. Consider selecting <button className="font-semibold underline underline-offset-2 hover:text-amber-950" onClick={() => { setTakeActionPrice("sp"); setTakeActionDisputes(new Set()); }}>SP Net</button> and raising a dispute for the difference.
                        </p>
                      </div>
                    )}
                  </div>

                  {isSp && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 cursor-pointer select-none group" onClick={() => setStep2Collapsed(p => !p)} data-testid="step2-toggle">
                        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!step2Collapsed ? "rotate-90" : ""}`} />
                        <span className="text-xs font-medium text-muted-foreground">Step 2: Raise Dispute <span className="text-[10px] font-normal">(optional)</span></span>
                        {step2Collapsed && disputeCount > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 bg-amber-50">{disputeCount} TID{disputeCount > 1 ? "s" : ""} • {fmt(disputeTotal)}</Badge>
                        )}
                        {step2Collapsed && disputeCount === 0 && (
                          <span className="text-[10px] text-muted-foreground/60 italic">collapsed</span>
                        )}
                      </div>
                      {!step2Collapsed && (
                      <div className={`rounded-md border-2 overflow-hidden transition-colors ${disputeCount > 0 ? "border-amber-500 bg-amber-50/50" : "border-border bg-muted/10"}`}>
                        <div className="px-3 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <div className={`flex items-center justify-center h-7 w-7 rounded-md flex-shrink-0 ${disputeCount > 0 ? "bg-amber-100" : "bg-muted"}`}>
                              <AlertTriangle className={`h-3.5 w-3.5 ${disputeCount > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold mb-0.5">This is SP error and refund to be claimed</div>
                              <p className="text-[11px] text-muted-foreground leading-relaxed">
                                The difference will be tracked as a dispute for future settlement — either adjusted against a future invoice or absorbed.
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="border-t">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20">
                            <span className="text-[11px] font-medium text-muted-foreground">Select TIDs to dispute</span>
                            <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => { setTakeActionDisputes(prev => prev.size === allTids.length ? new Set() : new Set(allTids.map(t => t.tid))); }} data-testid="toggle-all-disputes">
                              {takeActionDisputes.size === allTids.length ? "None" : "All"}
                            </Button>
                          </div>
                          <div className="grid grid-cols-[auto_5fr_2.5fr_2.5fr_2.5fr_2.5fr_2.5fr] gap-0 px-3 py-1 border-t text-[10px] font-medium text-muted-foreground bg-muted/10">
                            <div className="w-5" />
                            <div>TID / Experience</div>
                            <div className="text-right text-blue-600">SP Net</div>
                            <div className="text-right text-green-600">HO Net</div>
                            <div className="text-right text-violet-600">TAP</div>
                            <div className="text-right text-violet-600">Dispute</div>
                            <div className="text-right text-amber-600">Difference</div>
                          </div>
                          {allTids.map(t => {
                            const isChecked = takeActionDisputes.has(t.tid);
                            const isPaxOpen = disputePaxExpanded === t.tid;
                            const tidTapTotal = getTidTap(t);
                            const tidDispTotal = getDisputeDiff(t);
                            const experience = t.bookings[0]?.experienceName || t.bookings[0]?.productName || "";
                            return (
                              <div key={t.tid}>
                                <div className={`grid grid-cols-[auto_5fr_2.5fr_2.5fr_2.5fr_2.5fr_2.5fr] gap-0 items-center px-3 py-1.5 border-t text-xs cursor-pointer hover:bg-muted/20 transition-colors ${isChecked ? "bg-amber-50/40" : ""}`} onClick={() => toggleDisputeTid(t.tid)} data-testid={`dispute-tid-${t.tid}`}>
                                  <div className="flex items-center">
                                    <Checkbox checked={isChecked} className="h-3.5 w-3.5 mr-1" />
                                    {t.hasPax && (
                                      <button className="p-0 h-4 w-4 flex items-center justify-center rounded hover:bg-muted/40 mr-0.5" onClick={e => { e.stopPropagation(); setDisputePaxExpanded(prev => prev === t.tid ? null : t.tid); }}>
                                        <ChevronRight className={`h-3 w-3 text-violet-500 transition-transform ${isPaxOpen ? "rotate-90" : ""}`} />
                                      </button>
                                    )}
                                  </div>
                                  <div className="truncate">
                                    <span className="font-mono font-medium text-primary">{t.tid}</span>
                                    {experience && <span className="text-muted-foreground text-[11px] ml-1">{experience}</span>}
                                    {t.hasPax && <span className="ml-1.5 text-[9px] font-medium text-violet-600 bg-violet-100 px-1 py-0 rounded">PAX</span>}
                                  </div>
                                  <div className="font-mono text-right text-blue-600">{fmt(t.spNet)}</div>
                                  <div className="font-mono text-right text-green-600">{fmt(t.hoNet)}</div>
                                  <div className="font-mono text-right text-violet-600 font-medium">{fmt(tidTapTotal)}</div>
                                  <div className="font-mono text-right text-violet-600 font-medium">{fmt(tidDispTotal)}</div>
                                  <div className="font-mono text-right font-medium text-amber-600">{fmt(Math.abs(t.spNet - t.hoNet))}</div>
                                </div>
                                {isPaxOpen && t.hasPax && (() => {
                                  const allPax = t.bookings.flatMap(b => b.paxBreakdown || []);
                                  const paxGroups = new Map<string, { paxType: string; count: number; spUnit: number; hoUnit: number }>();
                                  allPax.forEach(p => {
                                    const k = `${p.paxType}__${p.unitPrice}`;
                                    if (!paxGroups.has(k)) paxGroups.set(k, { paxType: p.paxType, count: 0, spUnit: p.unitPrice, hoUnit: p.priceNet / p.count || 0 });
                                    const g = paxGroups.get(k)!;
                                    g.count += p.count;
                                  });
                                  const paxRows = Array.from(paxGroups.entries());
                                  if (paxRows.length === 0) return null;
                                  return (
                                    <div className="border-t bg-violet-50/30 dark:bg-violet-950/10 px-4 py-2 ml-6">
                                      <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">Pax Dispute — compute dispute amount per pax type</span>
                                        <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 border-violet-200 text-violet-600 hover:bg-violet-100" onClick={() => { setDisputePaxPrices(prev => { const next = { ...prev }; delete next[t.tid]; return next; }); }} data-testid={`reset-pax-${t.tid}`}>Reset Defaults</Button>
                                      </div>
                                      {(() => {
                                        const summaryTap = paxRows.reduce((s, [k, r]) => {
                                          const entry = (disputePaxPrices[t.tid] || {})[k] || {};
                                          const tap = entry.tap !== undefined && entry.tap !== "" ? parseFloat(entry.tap) : r.spUnit;
                                          return s + tap * r.count;
                                        }, 0);
                                        const summaryDisp = paxRows.reduce((s, [k, r]) => {
                                          const entry = (disputePaxPrices[t.tid] || {})[k] || {};
                                          const disp = entry.dispute !== undefined && entry.dispute !== "" ? parseFloat(entry.dispute) : (r.spUnit - r.hoUnit);
                                          return s + Math.abs(disp) * r.count;
                                        }, 0);
                                        return (
                                          <div className="flex items-center gap-4 bg-violet-100/40 dark:bg-violet-900/30 rounded px-2 py-1 mb-1.5">
                                            <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">TID Total TAP</span>
                                            <span className="font-mono text-[11px] font-bold text-violet-700 dark:text-violet-300" data-testid={`pax-summary-tap-${t.tid}`}>{fmt(summaryTap)}</span>
                                            <div className="h-3 w-px bg-violet-300 dark:bg-violet-600" />
                                            <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">TID Total Dispute</span>
                                            <span className="font-mono text-[11px] font-bold text-violet-700 dark:text-violet-300" data-testid={`pax-summary-disp-${t.tid}`}>{fmt(summaryDisp)}</span>
                                          </div>
                                        );
                                      })()}
                                      <div className="border rounded overflow-hidden text-[11px]">
                                        <div className="grid grid-cols-[2fr_1fr_1.3fr_1.3fr_1.5fr_1.5fr] gap-0 px-2 py-1 bg-violet-100/50 dark:bg-violet-900/30 font-medium text-violet-700 dark:text-violet-300">
                                          <div>Pax Type</div><div className="text-right">Qty</div><div className="text-right">SP Unit</div><div className="text-right">HO Unit</div><div className="text-right">Total Amt Payable</div><div className="text-right">Dispute Amt</div>
                                        </div>
                                        {paxRows.map(([k, r]) => {
                                          const entry = (disputePaxPrices[t.tid] || {})[k] || {};
                                          const defaultTap = r.spUnit;
                                          const defaultDispute = r.spUnit - r.hoUnit;
                                          const tapVal = entry.tap !== undefined && entry.tap !== "" ? entry.tap : String(defaultTap);
                                          const dispVal = entry.dispute !== undefined && entry.dispute !== "" ? entry.dispute : String(defaultDispute);
                                          const hasTapOvr = entry.tap !== undefined && entry.tap !== "";
                                          const hasDispOvr = entry.dispute !== undefined && entry.dispute !== "";
                                          return (
                                            <div key={k} className="grid grid-cols-[2fr_1fr_1.3fr_1.3fr_1.5fr_1.5fr] gap-0 items-center px-2 py-1 border-t bg-white dark:bg-card">
                                              <div className="font-medium">{r.paxType}</div>
                                              <div className="text-right font-mono">{r.count}</div>
                                              <div className="text-right font-mono text-blue-600">{fmt(r.spUnit)}</div>
                                              <div className="text-right font-mono text-green-600">{fmt(r.hoUnit)}</div>
                                              <div className="text-right">
                                                <input type="number" step="any" className={`h-5 w-20 text-[11px] text-right font-mono border rounded px-1 ml-auto block focus:outline-none focus:ring-1 focus:ring-violet-400 ${hasTapOvr ? "border-violet-400 bg-violet-50" : ""}`} value={tapVal} onClick={e => e.stopPropagation()} onChange={e => { const val = e.target.value; if (val === "" || !isNaN(Number(val))) { const newDisp = val !== "" ? String(parseFloat(val) - r.hoUnit) : ""; setDisputePaxPrices(prev => ({ ...prev, [t.tid]: { ...(prev[t.tid] || {}), [k]: { tap: val, dispute: newDisp } } })); } }} data-testid={`pax-tap-${t.tid}-${k}`} />
                                              </div>
                                              <div className="text-right">
                                                <input type="number" step="any" className={`h-5 w-20 text-[11px] text-right font-mono border rounded px-1 ml-auto block focus:outline-none focus:ring-1 focus:ring-violet-400 ${hasDispOvr ? "border-violet-400 bg-violet-50" : ""}`} value={dispVal} onClick={e => e.stopPropagation()} onChange={e => { const val = e.target.value; if (val === "" || !isNaN(Number(val))) { const newTap = val !== "" ? String(r.hoUnit + parseFloat(val)) : ""; setDisputePaxPrices(prev => ({ ...prev, [t.tid]: { ...(prev[t.tid] || {}), [k]: { tap: newTap, dispute: val } } })); } }} data-testid={`pax-disp-${t.tid}-${k}`} />
                                              </div>
                                            </div>
                                          );
                                        })}
                                        {(() => {
                                          const tidTotalTap = paxRows.reduce((s, [k, r]) => {
                                            const entry = (disputePaxPrices[t.tid] || {})[k] || {};
                                            const tap = entry.tap !== undefined && entry.tap !== "" ? parseFloat(entry.tap) : r.spUnit;
                                            return s + tap * r.count;
                                          }, 0);
                                          const tidTotalDisp = paxRows.reduce((s, [k, r]) => {
                                            const entry = (disputePaxPrices[t.tid] || {})[k] || {};
                                            const disp = entry.dispute !== undefined && entry.dispute !== "" ? parseFloat(entry.dispute) : (r.spUnit - r.hoUnit);
                                            return s + Math.abs(disp) * r.count;
                                          }, 0);
                                          return (
                                            <div className="grid grid-cols-[2fr_1fr_1.3fr_1.3fr_1.5fr_1.5fr] gap-0 px-2 py-1.5 border-t bg-violet-100/60 dark:bg-violet-900/40 font-semibold text-[11px]">
                                              <div className="text-violet-700 dark:text-violet-300">TID Total</div>
                                              <div />
                                              <div />
                                              <div />
                                              <div className="text-right font-mono text-violet-700 dark:text-violet-300" data-testid={`pax-total-tap-${t.tid}`}>{fmt(tidTotalTap)}</div>
                                              <div className="text-right font-mono text-violet-700 dark:text-violet-300" data-testid={`pax-total-disp-${t.tid}`}>{fmt(tidTotalDisp)}</div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                          {disputeCount > 0 && (
                            <div className="flex items-center justify-between px-3 py-1.5 border-t bg-amber-50/50 text-xs font-semibold">
                              <span className="text-amber-800">{disputeCount} TID{disputeCount > 1 ? "s" : ""} selected</span>
                              <span className="font-mono text-amber-700">Total: {fmt(disputeTotal)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 cursor-pointer select-none group" onClick={() => setStep3Collapsed(p => !p)} data-testid="step3-toggle">
                      <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!step3Collapsed ? "rotate-90" : ""}`} />
                      <span className="text-xs font-medium text-muted-foreground">{isSp ? "Step 3" : "Step 2"}: Raise Issue <span className="text-[10px] font-normal">(optional)</span></span>
                      {step3Collapsed && issueCount > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-700 bg-orange-50">{issueCount} TID{issueCount > 1 ? "s" : ""}</Badge>
                      )}
                      {step3Collapsed && issueCount === 0 && (
                        <span className="text-[10px] text-muted-foreground/60 italic">collapsed</span>
                      )}
                    </div>
                    {!step3Collapsed && (
                    <div className={`rounded-md border-2 overflow-hidden transition-colors ${issueCount > 0 ? "border-orange-500 bg-orange-50/50" : "border-border bg-muted/10"}`}>
                      <div className="px-3 py-2.5">
                        <div className="flex items-start gap-2.5">
                          <div className={`flex items-center justify-center h-7 w-7 rounded-md flex-shrink-0 ${issueCount > 0 ? "bg-orange-100" : "bg-muted"}`}>
                            <FileWarning className={`h-3.5 w-3.5 ${issueCount > 0 ? "text-orange-600" : "text-muted-foreground"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold mb-0.5">This is HO error</div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              To be checked with internal teams at Headout. Selected TIDs will be logged to the Issue Tracker for investigation and resolution.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="border-t">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20">
                          <span className="text-[11px] font-medium text-muted-foreground">Select TIDs to raise issues for</span>
                          <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => { setTakeActionIssues(prev => prev.size === allTids.length ? new Set() : new Set(allTids.map(t => t.tid))); }} data-testid="toggle-all-issues">
                            {takeActionIssues.size === allTids.length ? "None" : "All"}
                          </Button>
                        </div>
                        <div className="grid grid-cols-[auto_4fr_2fr_2fr_2fr_3fr] gap-0 px-3 py-1 border-t text-[10px] font-medium text-muted-foreground bg-muted/10">
                          <div className="w-5" />
                          <div>TID / Experience</div>
                          <div className="text-right text-blue-600">SP Net</div>
                          <div className="text-right text-green-600">HO Net</div>
                          <div className="text-right text-amber-600">Difference</div>
                          <div className="text-right text-violet-600">DRI Team</div>
                        </div>
                        {allTids.map(t => {
                          const isChecked = takeActionIssues.has(t.tid);
                          const experience = t.bookings[0]?.experienceName || t.bookings[0]?.productName || "";
                          const tidDriTeam = t.bookings[0]?.driTeam || detectedDriTeam;
                          return (
                            <div key={t.tid} className={`grid grid-cols-[auto_4fr_2fr_2fr_2fr_3fr] gap-0 items-center px-3 py-1.5 border-t text-xs cursor-pointer hover:bg-muted/20 transition-colors ${isChecked ? "bg-orange-50/40" : ""}`} onClick={() => toggleIssueTid(t.tid)} data-testid={`issue-tid-${t.tid}`}>
                              <Checkbox checked={isChecked} className="h-3.5 w-3.5 mr-2" />
                              <div className="truncate">
                                <span className="font-mono font-medium text-primary">{t.tid}</span>
                                {experience && <span className="text-muted-foreground text-[11px] ml-1">{experience}</span>}
                              </div>
                              <div className="font-mono text-right text-blue-600">{fmt(t.spNet)}</div>
                              <div className="font-mono text-right text-green-600">{fmt(t.hoNet)}</div>
                              <div className="font-mono text-right text-amber-600 font-medium">{fmt(Math.abs(t.spNet - t.hoNet))}</div>
                              <div className="text-right text-violet-600 text-[11px] truncate pl-1">{tidDriTeam}</div>
                            </div>
                          );
                        })}
                        {issueCount > 0 && (() => {
                          const selectedIssue = allTids.filter(t => takeActionIssues.has(t.tid));
                          const teamCounts: Record<string, number> = {};
                          selectedIssue.forEach(t => {
                            const team = t.bookings[0]?.driTeam || detectedDriTeam;
                            team.split(", ").forEach(tm => { teamCounts[tm] = (teamCounts[tm] || 0) + 1; });
                          });
                          const teamSummary = Object.entries(teamCounts).map(([team, count]) => `${team} (${count})`).join(", ");
                          return (
                            <div className="flex items-center justify-between px-3 py-1.5 border-t bg-orange-50/50 text-xs font-semibold flex-wrap gap-1">
                              <span className="text-orange-800">{issueCount} TID{issueCount > 1 ? "s" : ""} selected</span>
                              <span className="text-violet-600 text-[11px] font-medium">{teamSummary}</span>
                              <span className="font-mono text-orange-700">Difference: {fmt(selectedIssue.reduce((s, t) => s + Math.abs(t.spNet - t.hoNet), 0))}</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t">
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setShowTakeAction(false); setTakeActionDisputes(new Set()); }} data-testid="cancel-take-action">Cancel</Button>
                    <Button size="sm" className="h-8 text-xs gap-1.5" data-testid="confirm-take-action" disabled={priceOverrideMutation.isPending || disputeMutation.isPending || issueMutation.isPending} onClick={() => {
                      const allBookingIds = allTids.flatMap(t => t.bookings.map(b => b.bookingId));
                      const flashParts: string[] = [];
                      const completeParts: string[] = [];
                      const failParts: string[] = [];

                      const finalize = () => {
                        if (completeParts.length > 0) flash(completeParts.join(" · "));
                        if (failParts.length > 0) toast({ title: "Some actions failed", description: failParts.join("; "), variant: "destructive" });
                        setShowTakeAction(false);
                        setTakeActionDisputes(new Set());
                        setSelectedTids(new Set());
                      };

                      let pendingOps = 1;
                      if (disputeCount > 0) pendingOps++;
                      if (issueCount > 0) pendingOps++;
                      let completedOps = 0;
                      const checkDone = () => { completedOps++; if (completedOps >= pendingOps) finalize(); };

                      priceOverrideMutation.mutate({ bookingIds: allBookingIds, selection: takeActionPrice }, {
                        onSuccess: () => {
                          resolveMultiple(allTids.map(t => t.tid));
                          completeParts.push(`${allTids.length} TIDs → ${isSp ? "SP" : "HO"} Net`);
                          checkDone();
                        },
                        onError: (err) => { failParts.push(`Price: ${String(err)}`); checkDone(); },
                      });

                      if (disputeCount > 0) {
                        const disputeBookingIds = allTids.filter(t => takeActionDisputes.has(t.tid)).flatMap(t => t.bookings.map(b => b.bookingId));
                        disputeMutation.mutate({ bookingIds: disputeBookingIds }, {
                          onSuccess: () => {
                            setDisputedBookings(prev => { const next = new Set(prev); disputeBookingIds.forEach(id => next.add(id)); return next; });
                            completeParts.push(`${disputeCount} dispute${disputeCount > 1 ? "s" : ""}`);
                            checkDone();
                          },
                          onError: (err) => { failParts.push(`Dispute: ${String(err)}`); checkDone(); },
                        });
                      }
                      if (issueCount > 0) {
                        const issueTids = allTids.filter(t => takeActionIssues.has(t.tid));
                        const issueBookingIds = issueTids.flatMap(t => t.bookings.map(b => b.bookingId));
                        const teamCounts: Record<string, number> = {};
                        issueTids.forEach(t => { const team = t.bookings[0]?.driTeam || detectedDriTeam; teamCounts[team] = (teamCounts[team] || 0) + 1; });
                        const primaryDriTeam = Object.entries(teamCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || detectedDriTeam;
                        issueMutation.mutate({ bookingIds: issueBookingIds, description: `Take Action: ${reason}`, priority: "medium", driTeam: primaryDriTeam }, {
                          onSuccess: () => { completeParts.push(`${issueCount} issue${issueCount > 1 ? "s" : ""}`); checkDone(); },
                          onError: (err) => { failParts.push(`Issue: ${String(err)}`); checkDone(); },
                        });
                      }
                    }}>
                      {(priceOverrideMutation.isPending || disputeMutation.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Confirm & Apply <Badge variant="secondary" className="text-[10px] ml-1 px-1.5 py-0">{summaryParts.join(" · ")}</Badge>
                    </Button>
                  </div>
                </div>
              );
            })()}

            {selectedTids.size >= 2 && !bulkConfirm && !showTakeAction && (
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200 flex-wrap">
                <div className="flex items-center gap-2">
                  <CheckCheck className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">{selectedTids.size} TIDs selected</span>
                </div>
                <div className="h-5 w-px bg-border" />
                <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openSelectionAction("sp")}>
                  <TrendingUp className="h-3 w-3" /> SP Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" onClick={() => openSelectionAction("ho")}>
                  <TrendingDown className="h-3 w-3" /> HO Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openSelectionAction("dispute")}>
                  <Gavel className="h-3 w-3" /> Dispute
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => openSelectionAction("issue")}>
                  <FileWarning className="h-3 w-3" /> Issue
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedTids(new Set())}>
                  <XIcon className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
            )}

            {bulkConfirm && (bulkConfirm === "sp" || bulkConfirm === "ho") && (() => {
              const selData = getBulkTidData();
              const isSp = bulkConfirm === "sp";
              const totalPayable = selData.reduce((s, t) => s + (isSp ? t.spNet : t.hoNet), 0);
              const totalSp = selData.reduce((s, t) => s + t.spNet, 0);
              const totalHo = selData.reduce((s, t) => s + t.hoNet, 0);
              const totalDiff = isSp ? totalSp - totalHo : 0;
              return (
                <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 p-3 space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-300">
                      {isSp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      Bulk {isSp ? "SP Net" : "HO Net"} — {bulkScope === "all" ? `All ${selData.length} TIDs` : `${selData.length} selected TIDs`}
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="rounded-md border overflow-hidden bg-white dark:bg-card max-h-48 overflow-y-auto">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b sticky top-0">
                      <div>TID</div>
                      <div className="text-right w-24 px-2 text-blue-600">SP Net</div>
                      <div className="text-right w-24 px-2 text-green-600">HO Net</div>
                      <div className="text-right w-24 px-2">Disc. LC</div>
                      <div className="text-right w-28 px-2 font-semibold text-foreground">Payable</div>
                    </div>
                    {selData.map(t => (
                      <div key={t.tid} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 border-b last:border-0 text-xs">
                        <div>
                          <span className="font-mono font-medium text-primary">{t.tid}</span>
                          <span className="text-muted-foreground ml-1.5 text-[10px]">{t.bidCount} BIDs</span>
                        </div>
                        <div className={`text-right w-24 px-2 font-mono ${isSp ? "font-semibold text-blue-700 dark:text-blue-400" : "text-muted-foreground"}`}>{fmt(t.spNet)}</div>
                        <div className={`text-right w-24 px-2 font-mono ${!isSp ? "font-semibold text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{fmt(t.hoNet)}</div>
                        <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(Math.abs(t.discLc))}</div>
                        <div className={`text-right w-28 px-2 font-mono font-semibold ${isSp ? "text-blue-700 dark:text-blue-400" : "text-green-700 dark:text-green-400"}`}>{fmt(isSp ? t.spNet : t.hoNet)}</div>
                      </div>
                    ))}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 bg-muted/30 border-t text-xs font-semibold sticky bottom-0">
                      <div className="text-muted-foreground">Total ({selData.length} TIDs)</div>
                      <div className="text-right w-24 px-2 font-mono text-blue-600">{fmt(totalSp)}</div>
                      <div className="text-right w-24 px-2 font-mono text-green-600">{fmt(totalHo)}</div>
                      <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(selData.reduce((s, t) => s + Math.abs(t.discLc), 0))}</div>
                      <div className={`text-right w-28 px-2 font-mono text-sm ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(totalPayable)}</div>
                    </div>
                  </div>
                  {isSp && totalDiff > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                      <span className="text-amber-800 dark:text-amber-300">Paying <span className="font-mono font-semibold">{fmt(totalDiff)}</span> above HO Net — consider raising disputes.</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                    <Button size="sm" className={`h-7 text-xs gap-1 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`} variant={isSp ? "default" : "outline"} onClick={() => handleBulkAction(bulkConfirm)} disabled={priceOverrideMutation.isPending} data-testid="bulk-confirm-apply">
                      {priceOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Apply {isSp ? "SP Net" : "HO Net"} to {selData.length} TIDs
                    </Button>
                  </div>
                </div>
              );
            })()}

            {bulkConfirm && bulkConfirm === "dispute" && (() => {
              const confirmData = getBulkTidData();
              return (
                <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-3 space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4" />
                      Raise Dispute for {bulkScope === "all" ? `all ${confirmData.length}` : `${confirmData.length} selected`} TIDs
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {confirmData.map(t => <Badge key={t.tid} variant="outline" className="text-xs font-mono">{t.tid}</Badge>)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleBulkAction("dispute")} disabled={disputeMutation.isPending} data-testid="bulk-confirm-dispute">
                      {disputeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Confirm & Raise Disputes
                    </Button>
                  </div>
                </div>
              );
            })()}

            {tidGroups.length === 0 && !isLoadingAnalysis && (
              <div className="text-center py-8 text-muted-foreground text-sm">No TID-level actions available for this reason</div>
            )}

            {filteredTids.length > 0 && (
              <Collapsible open={showTidBreakdown} onOpenChange={setShowTidBreakdown}>
              <div className="rounded-md border overflow-hidden">
                <CollapsibleTrigger asChild>
                  <div className="grid grid-cols-[auto_1fr_auto] gap-0 items-center h-9 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b cursor-pointer hover:bg-muted/60 transition-colors select-none" data-testid="tid-breakdown-toggle">
                    <div className="flex items-center gap-2 mr-3">
                      {showTidBreakdown ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="font-medium text-foreground">TID / BID Breakdown</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{filteredTids.length} TIDs</Badge>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{filteredTids.reduce((s, t) => s + t.bidCount, 0)} bookings</Badge>
                    </div>
                    <div />
                    <div className="text-right font-mono text-muted-foreground text-xs">{fmt(filteredTids.reduce((s, t) => s + Math.abs(t.discLc), 0))}</div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto_auto_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/30 px-3 text-xs font-medium text-muted-foreground border-b">
                  <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelectAll(); }}>
                    <Checkbox checked={selectedTids.size > 0 && selectedTids.size === filteredTids.filter(t => !resolvedTids.has(t.tid)).length} className="h-3.5 w-3.5" />
                  </div>
                  <div className="w-5" />
                  <div className="pl-2">TID</div>
                  <div className="text-left px-3 w-[5.5rem]">Fulfillment</div>
                  <div className="text-right px-3 w-[7rem]">SP Net</div>
                  <div className="text-right px-3 w-[7rem]">HO Net</div>
                  <div className="text-right px-3 w-[7rem]">Difference LC</div>
                  <div className="text-right px-3 w-[7rem] text-violet-600">TAP</div>
                  <div className="text-right px-3 w-[7rem]">totalAmountPaid</div>
                  <div className="text-right px-3 w-[7rem] text-violet-600">Dispute</div>
                  <div className="text-right px-3 w-[7.5rem] text-green-600">Balance Amt Payable</div>
                  <div className="text-center px-3 w-14 pr-4">BIDs</div>
                </div>

                {filteredTids.map(tid => {
                  const isExpanded = expandedTid === tid.tid;
                  const isResolved = resolvedTids.has(tid.tid);
                  const isHighlighted = highlightedTid === tid.tid;
                  const isSelected = selectedTids.has(tid.tid);
                  const pct = totalDisc > 0 ? ((Math.abs(tid.discLc) / totalDisc) * 100).toFixed(0) : "0";

                  return (
                    <div key={tid.tid} id={`ws-tid-${tid.tid}`} className={`transition-all duration-500 ${isResolved ? "bg-green-50/40 dark:bg-green-950/10" : ""} ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30 dark:bg-violet-950/20" : ""} ${isSelected && !isResolved ? "bg-primary/5" : ""}`} data-testid={`action-tid-${tid.tid}`}>
                      <div
                        className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto_auto_auto_auto_auto_auto] gap-0 items-center px-3 min-h-[2.75rem] cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                        onClick={() => setExpandedTid(isExpanded ? null : tid.tid)}
                      >
                        <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); if (!isResolved) toggleSelect(tid.tid); }}>
                          {!isResolved && <Checkbox checked={isSelected} className="h-3.5 w-3.5" />}
                        </div>
                        <div className="w-5 flex items-center">
                          {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="pl-2 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                            {tid.hasPax && <Badge variant="outline" className="text-[10px] px-1 py-0 text-violet-600 border-violet-200">Pax</Badge>}
                          </div>
                          {(tid.bookings[0]?.experienceName || tid.bookings[0]?.productName) && (
                            <div className="text-[10px] text-muted-foreground break-words">{tid.bookings[0]?.experienceName || tid.bookings[0]?.productName}</div>
                          )}
                        </div>
                        <div className="text-left px-3 w-[5.5rem]">
                          {tid.fulfillmentMethods.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">{tid.fulfillmentMethods.length > 1 ? "Mixed" : tid.fulfillmentMethods[0]}</span>
                          )}
                        </div>
                        <div className="text-right px-3 w-[7rem] font-mono text-sm">{fmt(tid.spNet)}</div>
                        <div className="text-right px-3 w-[7rem] font-mono text-sm">{fmt(tid.hoNet)}</div>
                        <div className="text-right px-3 w-[7rem]">
                          <span className="font-mono text-sm text-red-600 dark:text-red-400 whitespace-nowrap">{fmt(Math.abs(tid.discLc))}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">({pct}%)</span>
                        </div>
                        <div className="text-right px-3 w-[7rem] font-mono text-sm text-violet-600 font-medium">{fmt(tid.bookings.reduce((s, b) => s + getEffectiveTap(b), 0))}</div>
                        <div className="text-right px-3 w-[7rem] font-mono text-sm">{fmt(tid.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0))}</div>
                        <div className="text-right px-3 w-[7rem] font-mono text-sm text-violet-600 font-medium">{fmt(takeActionDisputes.has(tid.tid) ? Math.abs(tid.spNet - tid.hoNet) : 0)}</div>
                        <div className="text-right px-3 w-[7.5rem] font-mono text-sm text-green-600 font-medium">{fmt((() => {
                          const tidTap = tid.bookings.reduce((s, b) => s + getEffectiveTap(b), 0);
                          const tidAmtPaid = tid.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0);
                          return tidTap - tidAmtPaid;
                        })())}</div>
                        <div className="text-center px-3 w-14 text-sm pr-4">{tid.bidCount}</div>
                      </div>

                      {isExpanded && (
                        <div className="border-b bg-muted/10 dark:bg-muted/5 px-4 py-3 space-y-3">
                          <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10 flex-wrap">
                            <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleTidAction(tid, "sp")} disabled={priceOverrideMutation.isPending} data-testid={`tid-sp-net-${tid.tid}`}>
                              {priceOverrideMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />} Set SP Net
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => handleTidAction(tid, "ho")} disabled={priceOverrideMutation.isPending} data-testid={`tid-ho-net-${tid.tid}`}>
                              <TrendingDown className="h-3.5 w-3.5" /> Set HO Net
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-violet-700 border-violet-300 hover:bg-violet-50" onClick={() => {
                              setPaxTid(tid);
                              setPaxOpen(true);
                            }} data-testid={`tid-pax-${tid.tid}`}>
                              <Calculator className="h-3.5 w-3.5" /> Pax Pricing
                            </Button>
                            <div className="flex-1" />
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => handleTidDispute(tid)} disabled={disputeMutation.isPending} data-testid={`tid-dispute-${tid.tid}`}>
                              <Gavel className="h-3.5 w-3.5" /> Dispute
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => handleTidIssue(tid)} data-testid={`tid-issue-${tid.tid}`}>
                              <FileWarning className="h-3.5 w-3.5" /> Issue
                            </Button>
                          </div>

                          <div className="rounded-md border overflow-hidden bg-background">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="h-7 bg-muted/30 border-b">
                                  <th className="text-left font-medium text-muted-foreground px-2 py-1 whitespace-nowrap">Booking ID</th>
                                  <th className="text-left font-medium text-muted-foreground px-2 py-1 whitespace-nowrap">Ticket ID</th>
                                  <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">SP Net</th>
                                  <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">HO Net</th>
                                  <th className="text-center font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-[5.5rem]">Selection</th>
                                  <th className="text-center font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-[4.5rem]">Dispute</th>
                                  <th className="text-right font-medium text-violet-600 px-2 py-1 whitespace-nowrap w-24">TAP</th>
                                  <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">totalAmountPaid</th>
                                  <th className="text-right font-medium text-orange-600 px-2 py-1 whitespace-nowrap w-24">Dispute Amt</th>
                                  <th className="text-right font-medium text-green-600 px-2 py-1 whitespace-nowrap w-[7rem]">Balance Amt Payable</th>
                                  <th className="text-center font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {tid.bookings.map(b => {
                                  const selection = getBidSelection(b.bookingId);
                                  const canDispute = selection === "sp" || selection === "custom";
                                  const finalNet = getBidFinalNet(b);
                                  const effectiveTap = getEffectiveTap(b);
                                  const tapBase = finalNet;
                                  const tapMin = Math.round(tapBase * 0.9 * 100) / 100;
                                  const tapMax = Math.round(tapBase * 1.1 * 100) / 100;
                                  const hasTapOverride = bidTapOverrides[b.bookingId] !== undefined && bidTapOverrides[b.bookingId] !== "";
                                  const maxDispute = getBidMaxDispute(b);
                                  const currentDispute = canDispute ? getBidDisputeAmount(b.bookingId) : 0;
                                  const exceedsMax = currentDispute > maxDispute;
                                  const bookingAmountPaid = b.amountPaid || 0;
                                  const balanceAmountPayable = effectiveTap - bookingAmountPaid;
                                  const isSaved = savedBookings.has(b.bookingId);
                                  const hasOverride = !!bookingSelections[b.bookingId];
                                  const hasDisp = disputedBookings.has(b.bookingId);
                                  return (
                                    <tr key={b.bookingId} className={`h-9 border-b last:border-0 hover:bg-muted/20 ${hasDisp ? "bg-amber-50/50 dark:bg-amber-950/10" : ""} ${bidDisputeActive.has(b.bookingId) ? "bg-orange-50/30 dark:bg-orange-950/10" : ""}`} data-testid={`booking-row-${b.bookingId}`}>
                                      <td className="px-2 py-1">
                                        <div className="flex items-center gap-1">
                                          <span className="font-mono text-primary font-medium">{b.bookingId}</span>
                                          {hasDisp && <Badge className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-200">Disputed</Badge>}
                                          {isSaved && <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />}
                                        </div>
                                      </td>
                                      <td className="px-2 py-1 text-muted-foreground truncate max-w-[100px]" title={b.ticketId || ""} data-testid={`cell-ticketid-${b.bookingId}`}>
                                        {b.ticketId || "—"}
                                      </td>
                                      <td className="text-right px-2 py-1 font-mono text-blue-600" data-testid={`booking-sp-${b.bookingId}`}>
                                        {fmt(b.spNetInHo || 0)}
                                      </td>
                                      <td className="text-right px-2 py-1 font-mono text-green-600" data-testid={`booking-ho-${b.bookingId}`}>
                                        {fmt(b.hoNet || 0)}
                                      </td>
                                      <td className="text-center px-1 py-1">
                                        {selection === "custom" ? (
                                          <div className="flex items-center justify-center gap-1">
                                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-violet-600 border-violet-200">Custom</Badge>
                                            <Button size="sm" variant="ghost" className="h-4 px-0.5 text-[9px] text-muted-foreground" onClick={() => updateBidSelection(b.bookingId, "sp")} data-testid={`clear-custom-${b.bookingId}`}>
                                              <XIcon className="h-2.5 w-2.5" />
                                            </Button>
                                          </div>
                                        ) : (
                                          <Select value={selection} onValueChange={(v) => updateBidSelection(b.bookingId, v as "ho" | "sp")}>
                                            <SelectTrigger className="w-[4.5rem] h-5 text-xs mx-auto" data-testid={`select-booking-${b.bookingId}`}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="ho">HO</SelectItem>
                                              <SelectItem value="sp">SP</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        )}
                                      </td>
                                      <td className="text-center px-1 py-1">
                                        {canDispute ? (
                                          bidDisputeActive.has(b.bookingId) ? (
                                            <Button size="sm" variant="ghost" className="h-4 px-1 text-[9px] text-muted-foreground hover:text-foreground" onClick={() => setBidDisputeAmountForBooking(b.bookingId, 0)} data-testid={`button-clear-dispute-${b.bookingId}`}>
                                              Clear
                                            </Button>
                                          ) : (
                                            <Button size="sm" variant="outline" className="h-5 px-1.5 text-[9px]" onClick={() => activateBidDispute(b.bookingId, b)} data-testid={`button-dispute-${b.bookingId}`}>
                                              Dispute
                                            </Button>
                                          )
                                        ) : null}
                                      </td>
                                      <td className="text-right px-2 py-1" data-testid={`booking-final-${b.bookingId}`}>
                                        <div className="relative group flex justify-end items-center">
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={bidTapOverrides[b.bookingId] ?? ""}
                                            placeholder={String(Math.round(finalNet * 100) / 100)}
                                            onChange={e => setBidTapOverrides(prev => ({ ...prev, [b.bookingId]: e.target.value }))}
                                            className={`w-20 h-5 text-xs text-right font-mono px-1.5 bg-transparent border-0 border-b focus:outline-none focus:border-violet-500 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${hasTapOverride && effectiveTap !== finalNet ? 'border-violet-400 text-violet-700 dark:text-violet-300 font-medium' : 'border-transparent'}`}
                                            data-testid={`input-tap-${b.bookingId}`}
                                          />
                                          {hasTapOverride && (
                                            <button className="ml-0.5 p-0 text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0" onClick={() => setBidTapOverrides(prev => { const n = { ...prev }; delete n[b.bookingId]; return n; })} data-testid={`clear-tap-${b.bookingId}`}>
                                              <XIcon className="h-2.5 w-2.5" />
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                      <td className="text-right px-2 py-1 font-mono text-muted-foreground" data-testid={`booking-amtpaid-${b.bookingId}`}>
                                        {bookingAmountPaid > 0 ? fmt(bookingAmountPaid) : "—"}
                                      </td>
                                      <td className="text-right px-2 py-1">
                                        {bidDisputeActive.has(b.bookingId) ? (
                                          <div className="relative group flex justify-end">
                                            <Input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={currentDispute || ""}
                                              onChange={(e) => setBidDisputeAmountForBooking(b.bookingId, parseFloat(e.target.value) || 0, b)}
                                              className={`w-20 h-5 text-xs text-right font-mono px-1 ${exceedsMax ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' : ''}`}
                                              placeholder="0"
                                              data-testid={`input-dispute-booking-${b.bookingId}`}
                                            />
                                            {exceedsMax && (
                                              <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block">
                                                <div className="bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap border border-orange-300 dark:border-orange-700">
                                                  Max: {fmt(maxDispute)}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="text-right px-2 py-1 font-mono font-medium text-green-600 dark:text-green-400" data-testid={`booking-balance-${b.bookingId}`}>
                                        {fmt(balanceAmountPayable)}
                                      </td>
                                      <td className="text-center px-1 py-1">
                                        {hasOverride && !isSaved && (
                                          <button className="p-1 rounded-md bg-violet-100 hover:bg-violet-200 text-violet-700 transition-colors" onClick={() => handleBookingSave(b)} disabled={priceOverrideMutation.isPending} data-testid={`booking-save-${b.bookingId}`}>
                                            {priceOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="h-8 bg-muted/40 border-t font-semibold text-[11px]">
                                  <td className="px-2 py-1 text-muted-foreground" colSpan={2}>Total ({tid.bookings.length})</td>
                                  <td className="text-right px-2 py-1 font-mono text-blue-600">{fmt(tid.spNet)}</td>
                                  <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(tid.hoNet)}</td>
                                  <td colSpan={2} className="text-center px-1 py-1">
                                    {(() => {
                                      const disputed = tid.bookings.filter(b => bidDisputeActive.has(b.bookingId)).length;
                                      const disputable = tid.bookings.filter(b => { const s = getBidSelection(b.bookingId); return s === "sp" || s === "custom"; }).length;
                                      if (disputable === 0) return null;
                                      if (disputed > 0) {
                                        return (
                                          <Button size="sm" variant="ghost" className="h-4 px-1 text-[9px] text-muted-foreground hover:text-foreground" onClick={() => handleTidBulkDispute(tid, "clear")} data-testid={`tid-clear-dispute-${tid.tid}`}>
                                            Clear All
                                          </Button>
                                        );
                                      }
                                      return (
                                        <Button size="sm" variant="outline" className="h-5 px-1 text-[9px]" onClick={() => handleTidBulkDispute(tid, "all")} data-testid={`tid-dispute-all-${tid.tid}`}>
                                          Dispute All
                                        </Button>
                                      );
                                    })()}
                                  </td>
                                  <td className="text-right px-2 py-1 font-mono text-violet-700 font-bold">{fmt(tid.bookings.reduce((s, b) => s + getEffectiveTap(b), 0))}</td>
                                  <td className="text-right px-2 py-1 font-mono text-muted-foreground">{fmt(tid.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0))}</td>
                                  <td className="text-right px-2 py-1 font-mono text-orange-600">
                                    {(() => {
                                      const totalDisp = tid.bookings.reduce((s, b) => { const sel = getBidSelection(b.bookingId); return s + (sel === "sp" || sel === "custom" ? getBidDisputeAmount(b.bookingId) : 0); }, 0);
                                      return totalDisp > 0 ? fmt(totalDisp) : null;
                                    })()}
                                  </td>
                                  <td className="text-right px-2 py-1 font-mono text-green-600 dark:text-green-400 font-bold">
                                    {fmt(tid.bookings.reduce((s, b) => {
                                      const tap = getEffectiveTap(b);
                                      const ap = b.amountPaid || 0;
                                      return s + tap - ap;
                                    }, 0))}
                                  </td>
                                  <td className="text-center px-1 py-1">
                                    {tid.bookings.some(b => bookingSelections[b.bookingId] && !savedBookings.has(b.bookingId)) && (
                                      <button className="p-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white transition-colors" onClick={() => handleTidSaveAll(tid)} disabled={priceOverrideMutation.isPending} data-testid={`tid-save-all-${tid.tid}`}>
                                        {priceOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                </CollapsibleContent>
              </div>
              </Collapsible>
            )}

            <Dialog open={paxOpen && !!paxTid} onOpenChange={open => { if (!open) { setPaxOpen(false); setPaxTid(null); setPaxPrices({}); } }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <Calculator className="h-4 w-4 text-violet-600" />
                    Pax Pricing — {paxTid?.tid}
                  </DialogTitle>
                </DialogHeader>
                {paxTid && (() => {
                  const getPaxKey = (bookingId: string, paxType: string, unitPrice: number) => `${bookingId}__${paxType}__${unitPrice}`;
                  const getBookingPaxTotal = (b: typeof paxTid.bookings[0]) => {
                    if (!b.paxBreakdown || b.paxBreakdown.length === 0) {
                      const direct = paxPrices[b.bookingId];
                      return direct ? parseFloat(direct) || 0 : (b.spNetInHo || 0);
                    }
                    return b.paxBreakdown.reduce((s, p) => {
                      const key = getPaxKey(b.bookingId, p.paxType, p.unitPrice);
                      const edited = paxPrices[key];
                      const unit = edited ? (parseFloat(edited) || 0) : p.unitPrice;
                      return s + unit * p.count;
                    }, 0);
                  };
                  const editedCount = Object.keys(paxPrices).filter(k => paxPrices[k]).length;
                  const grandTotal = paxTid.bookings.reduce((s, b) => s + getBookingPaxTotal(b), 0);

                  return (
                    <div className="space-y-3">
                      <div className="rounded-md border overflow-hidden bg-white dark:bg-card max-h-[400px] overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0 z-10">
                            <tr className="h-7 bg-muted/30 border-b">
                              <th className="text-left font-medium text-muted-foreground px-2 py-1">Booking ID / Pax Type</th>
                              <th className="text-right font-medium text-muted-foreground px-2 py-1 w-16">Count</th>
                              <th className="text-right font-medium text-muted-foreground px-2 py-1 w-24">SP Unit</th>
                              <th className="text-right font-medium text-muted-foreground px-2 py-1 w-24">HO Unit</th>
                              <th className="text-right font-medium text-violet-600 px-2 py-1 w-28">Final Unit</th>
                              <th className="text-right font-medium text-muted-foreground px-2 py-1 w-24">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paxTid.bookings.map(b => {
                              const hasPaxRows = b.paxBreakdown && b.paxBreakdown.length > 0;
                              const bookingTotal = getBookingPaxTotal(b);
                              return (
                                <Fragment key={b.bookingId}>
                                  <tr className="h-8 border-b bg-muted/10">
                                    <td className="px-2 py-1 font-mono text-primary font-medium" colSpan={hasPaxRows ? 5 : 1}>{b.bookingId}</td>
                                    {!hasPaxRows && (
                                      <>
                                        <td className="text-right px-2 py-1 text-muted-foreground">—</td>
                                        <td className="text-right px-2 py-1 font-mono text-blue-600">{fmt(b.spNetInHo || 0)}</td>
                                        <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(b.hoNet || 0)}</td>
                                        <td className="text-right px-2 py-1">
                                          <Input
                                            className="h-6 w-24 text-xs text-right font-mono ml-auto"
                                            type="number"
                                            placeholder={String(b.spNetInHo || 0)}
                                            value={paxPrices[b.bookingId] || ""}
                                            onChange={e => setPaxPrices(prev => ({ ...prev, [b.bookingId]: e.target.value }))}
                                            data-testid={`pax-price-${b.bookingId}`}
                                          />
                                        </td>
                                      </>
                                    )}
                                    <td className="text-right px-2 py-1 font-mono font-medium">{fmt(bookingTotal)}</td>
                                  </tr>
                                  {hasPaxRows && b.paxBreakdown!.map((p, pi) => {
                                    const key = getPaxKey(b.bookingId, p.paxType, p.unitPrice);
                                    const hoUnit = p.priceNet / (p.count || 1);
                                    const editedVal = paxPrices[key];
                                    const finalUnit = editedVal ? (parseFloat(editedVal) || 0) : p.unitPrice;
                                    return (
                                      <tr key={`${b.bookingId}-${pi}`} className="h-7 border-b last:border-0">
                                        <td className="px-2 py-1 pl-6 text-muted-foreground">{p.paxType}</td>
                                        <td className="text-right px-2 py-1 font-mono">{p.count}</td>
                                        <td className="text-right px-2 py-1 font-mono text-blue-600">{fmt(p.unitPrice)}</td>
                                        <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(hoUnit)}</td>
                                        <td className="text-right px-2 py-1">
                                          <Input
                                            className="h-5 w-24 text-xs text-right font-mono ml-auto"
                                            type="number"
                                            step="any"
                                            placeholder={String(p.unitPrice)}
                                            value={paxPrices[key] || ""}
                                            onChange={e => setPaxPrices(prev => ({ ...prev, [key]: e.target.value }))}
                                            data-testid={`pax-unit-${b.bookingId}-${pi}`}
                                          />
                                        </td>
                                        <td className="text-right px-2 py-1 font-mono text-muted-foreground">{fmt(finalUnit * p.count)}</td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="h-8 bg-muted/20 border-t font-semibold">
                              <td className="px-2 py-1" colSpan={5}>Grand Total</td>
                              <td className="text-right px-2 py-1 font-mono text-violet-700">{fmt(grandTotal)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-muted-foreground">{editedCount} price{editedCount !== 1 ? "s" : ""} edited</span>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setPaxOpen(false); setPaxTid(null); setPaxPrices({}); }}>Cancel</Button>
                          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => {
                            const customPricesNum: Record<string, number> = {};
                            const affectedBookingIds: string[] = [];
                            paxTid!.bookings.forEach(b => {
                              const total = getBookingPaxTotal(b);
                              const hasPaxRows = b.paxBreakdown && b.paxBreakdown.length > 0;
                              const hasEdits = hasPaxRows
                                ? b.paxBreakdown!.some(p => !!paxPrices[getPaxKey(b.bookingId, p.paxType, p.unitPrice)])
                                : !!paxPrices[b.bookingId];
                              if (hasEdits) {
                                customPricesNum[b.bookingId] = Math.round(total * 100) / 100;
                                affectedBookingIds.push(b.bookingId);
                              }
                            });
                            if (affectedBookingIds.length === 0) { flash("No prices edited"); return; }
                            priceOverrideMutation.mutate({ bookingIds: affectedBookingIds, selection: "sp", customPrices: customPricesNum }, {
                              onSuccess: () => {
                                setBookingSelections(prev => {
                                  const next = { ...prev };
                                  affectedBookingIds.forEach(id => { next[id] = "custom"; });
                                  return next;
                                });
                                setBookingCustomPrices(prev => {
                                  const next = { ...prev };
                                  affectedBookingIds.forEach(id => { next[id] = String(customPricesNum[id]); });
                                  return next;
                                });
                                setSavedBookings(prev => {
                                  const next = new Set(prev);
                                  affectedBookingIds.forEach(id => next.add(id));
                                  return next;
                                });
                                resolve(paxTid!.tid);
                                flash(`Pax pricing applied for ${paxTid!.tid}`);
                                setPaxOpen(false);
                                setPaxTid(null);
                                setPaxPrices({});
                              },
                            });
                          }} disabled={priceOverrideMutation.isPending} data-testid="apply-pax-pricing">
                            {priceOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Apply Pax Pricing
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </DialogContent>
            </Dialog>

            <Dialog open={!!issueModalTid} onOpenChange={open => { if (!open) setIssueModalTid(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <FileWarning className="h-4 w-4 text-orange-600" />
                    Raise Issue
                  </DialogTitle>
                </DialogHeader>
                {issueModalTid && (() => {
                  const t = issueModalTid;
                  const discLc = Math.abs(t.discLc);
                  const discUsdTotal = t.bookings.reduce((s, b) => s + Math.abs(b.discrepancyUsd || 0), 0);
                  const discPcts = t.bookings.map(b => {
                    const sp = Math.abs(b.spNetInHo || 0);
                    return sp > 0 ? Math.round((Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) / sp) * 100) : 0;
                  }).filter(p => p > 0);
                  const pctMin = discPcts.length > 0 ? Math.min(...discPcts) : 0;
                  const pctMax = discPcts.length > 0 ? Math.max(...discPcts) : 0;
                  const pctDisplay = pctMin === pctMax ? `${pctMin}%` : `${pctMin}% – ${pctMax}%`;
                  const bookingDriTeams = new Set(t.bookings.map(b => b.driTeam).filter(Boolean));
                  const tidDriTeam = bookingDriTeams.size === 1 ? Array.from(bookingDriTeams)[0] : detectedDriTeam;

                  return (
                    <div className="space-y-4">
                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">TID</span>
                            <span className="font-mono font-medium text-primary">{t.tid}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Count of BIDs</span>
                            <span className="font-medium">{t.bidCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Discrepancy LC</span>
                            <span className="font-mono text-red-600 font-medium">{fmt(discLc)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Discrepancy USD</span>
                            <span className="font-mono text-red-600 font-medium">{fmt(discUsdTotal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Discrepancy %</span>
                            <span className="font-medium text-red-600">{pctDisplay}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">DRI Team</span>
                            <span className="font-medium">{tidDriTeam || "—"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
                          <Select value={issuePriority} onValueChange={setIssuePriority}>
                            <SelectTrigger className="h-8 text-xs" data-testid="issue-modal-priority">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-muted-foreground">DRI Team</label>
                          <Select value={issueDriTeam || tidDriTeam || ""} onValueChange={setIssueDriTeam}>
                            <SelectTrigger className="h-8 text-xs" data-testid="issue-modal-dri">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {driTeams.map(team => <SelectItem key={team} value={team}>{team}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Description</label>
                        <Textarea
                          className="text-xs min-h-[60px]"
                          placeholder="Describe the issue..."
                          value={issueDescription}
                          onChange={e => setIssueDescription(e.target.value)}
                          data-testid="issue-modal-description"
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSubmitIssue} disabled={issueMutation.isPending || !issueDescription.trim()} data-testid="issue-modal-submit">
                          {issueMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Log Issue
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </DialogContent>
            </Dialog>

            <Collapsible open={issueOpen} onOpenChange={setIssueOpen}>
              <CollapsibleTrigger asChild>
                <div className="rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/20 flex items-center gap-2" data-testid="issue-section-toggle">
                  <FileWarning className="h-4 w-4 text-orange-600" />
                  <span className="text-xs font-semibold text-orange-800 dark:text-orange-300">Raise Issue</span>
                  {issueOpen ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
                      <Select value={issuePriority} onValueChange={setIssuePriority}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">DRI Team</label>
                      <Select value={issueDriTeam || detectedDriTeam} onValueChange={setIssueDriTeam}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {driTeams.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-muted-foreground">Description</label>
                      {predictiveInsight && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-violet-600" onClick={() => {
                          if (predictiveInsight) setIssueDescription(prev => prev ? prev + "\n\n" + predictiveInsight : predictiveInsight);
                        }} data-testid="auto-analyze-btn">
                          <Sparkles className="h-3 w-3" /> Auto-analyze
                        </Button>
                      )}
                    </div>
                    <Textarea
                      className="text-xs min-h-[60px]"
                      placeholder="Describe the issue..."
                      value={issueDescription}
                      onChange={e => setIssueDescription(e.target.value)}
                      data-testid="issue-description"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {issueScopeTids
                        ? `${tidGroups.filter(t => issueScopeTids.includes(t.tid)).reduce((s, t) => s + t.bidCount, 0)} bookings in ${issueScopeTids.length} TID${issueScopeTids.length > 1 ? "s" : ""} (${issueScopeTids.join(", ")})`
                        : `${tidGroups.reduce((s, t) => s + t.bidCount, 0)} bookings across all ${tidGroups.length} TIDs`}
                    </span>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSubmitIssue} disabled={issueMutation.isPending || !issueDescription.trim()} data-testid="submit-issue-btn">
                      {issueMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Log Issue
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={disputeOpen} onOpenChange={setDisputeOpen}>
              <CollapsibleTrigger asChild>
                <div className="rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/20 flex items-center gap-2" data-testid="dispute-section-toggle">
                  <Gavel className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Raise Dispute</span>
                  {disputedBookings.size > 0 && (
                    <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">{disputedBookings.size} active</Badge>
                  )}
                  {disputeOpen ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded border p-2 bg-white dark:bg-card">
                      <span className="text-muted-foreground">Disputable</span>
                      <div className="font-mono font-semibold">{tidGroups.reduce((s, t) => s + t.bidCount, 0) - disputedBookings.size} bookings</div>
                    </div>
                    <div className="rounded border p-2 bg-white dark:bg-card">
                      <span className="text-muted-foreground">Total Amount</span>
                      <div className="font-mono font-semibold text-amber-700">{fmt(totalDisputeAmount)}</div>
                    </div>
                    <div className="rounded border p-2 bg-white dark:bg-card">
                      <span className="text-muted-foreground">Active Disputes</span>
                      <div className="font-mono font-semibold text-green-600">{disputedBookings.size}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={handleBulkDispute} disabled={disputeMutation.isPending} data-testid="dispute-all-btn">
                      {disputeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gavel className="h-3 w-3" />}
                      Dispute All
                    </Button>
                    {disputedBookings.size > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200" onClick={handleClearAllDisputes} disabled={clearDisputesMutation.isPending} data-testid="clear-disputes-btn">
                        {clearDisputesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XIcon className="h-3 w-3" />} Clear All
                      </Button>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        <div className="border-t bg-muted/30 dark:bg-muted/10 px-5 py-2 flex items-center justify-between flex-shrink-0 text-xs">
          <span className="text-muted-foreground">{tidGroups.length} TIDs · {tidGroups.reduce((s, t) => s + t.bidCount, 0)} bookings</span>
          <div className="flex items-center gap-4">
            <span><span className="text-muted-foreground mr-1">SP</span><span className="font-mono font-medium text-blue-700 dark:text-blue-400">{fmt(tidGroups.reduce((s, t) => s + t.spNet, 0))}</span></span>
            <span><span className="text-muted-foreground mr-1">HO</span><span className="font-mono font-medium text-green-700 dark:text-green-400">{fmt(tidGroups.reduce((s, t) => s + t.hoNet, 0))}</span></span>
            <span><span className="text-muted-foreground mr-1">Disc.</span><span className="font-mono font-semibold text-red-600 dark:text-red-400">{fmt(tidGroups.reduce((s, t) => s + Math.abs(t.discLc), 0))}</span></span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

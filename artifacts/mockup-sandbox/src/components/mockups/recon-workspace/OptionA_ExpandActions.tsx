import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Calculator, Check, Gavel, FileWarning, AlertTriangle, X as XIcon,
  BarChart3, PanelTopClose, PanelTop, CheckCheck, Trash2, Zap
} from "lucide-react";

interface TidData {
  tid: string; spNet: number; hoNet: number; discLc: number; discUsd: number;
  bidCount: number; fm: string; experience: string; hasPax: boolean;
  hoTakeRate: number; actualTakeRate: number; discPercent: string; soldAtLoss: boolean; lossUsd: number;
  startDate: string; endDate: string; bidCountWithDisc: number; bidCountInDuration: number;
  isSecondaryVendor?: boolean; driTeam: string;
}

interface BookingData {
  bookingId: string; spNet: number; hoNet: number;
  amountPaid: number; disputeSettled: number;
  disputeAmount: number; totalAmountPayable: number;
  isNegativeSp?: boolean; isAlreadyReconciled?: boolean; isUnmapped?: boolean;
  arSubReason?: string; vendorId?: string;
}

const TIDS: TidData[] = [
  { tid: "TID-90234", spNet: 5_200, hoNet: 4_850, discLc: 350, discUsd: 379.40, bidCount: 6, fm: "Freesale", experience: "Sagrada Familia Guided Tour", hasPax: true, hoTakeRate: 18.5, actualTakeRate: 12.3, discPercent: "-6.2%", soldAtLoss: false, lossUsd: 0, startDate: "01/01/2026", endDate: "31/01/2026", bidCountWithDisc: 5, bidCountInDuration: 6, driTeam: "Finance" },
  { tid: "TID-90456", spNet: 18_400, hoNet: 12_300, discLc: 6_100, discUsd: 6_612.40, bidCount: 12, fm: "Freesale", experience: "Park Güell Skip-the-Line", hasPax: true, hoTakeRate: 20.0, actualTakeRate: -3.2, discPercent: "-23.2%", soldAtLoss: true, lossUsd: 2_450, startDate: "05/01/2026", endDate: "28/01/2026", bidCountWithDisc: 12, bidCountInDuration: 12, driTeam: "Finance, Reservation Ops" },
  { tid: "TID-90789", spNet: 8_900, hoNet: 3_900, discLc: 5_000.75, discUsd: 5_420.81, bidCount: 7, fm: "Manual", experience: "Casa Batlló Night Experience", hasPax: false, hoTakeRate: 15.0, actualTakeRate: 10.8, discPercent: "-4.2%", soldAtLoss: false, lossUsd: 0, startDate: "10/01/2026", endDate: "25/01/2026", bidCountWithDisc: 6, bidCountInDuration: 7, driTeam: "Supply Ops" },
  { tid: "TID-91012", spNet: 3_100, hoNet: 2_100, discLc: 1_000, discUsd: 1_084, bidCount: 3, fm: "Freesale", experience: "Montserrat Day Trip", hasPax: false, hoTakeRate: 22.0, actualTakeRate: 18.5, discPercent: "-3.5%", soldAtLoss: false, lossUsd: 0, startDate: "15/01/2026", endDate: "20/01/2026", bidCountWithDisc: 3, bidCountInDuration: 3, isSecondaryVendor: true, driTeam: "Finance" },
];

const MOCK_BOOKINGS: Record<string, BookingData[]> = {
  "TID-90234": [
    { bookingId: "BID-1001", spNet: 850, hoNet: 800, amountPaid: 200, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 850 },
    { bookingId: "BID-1002", spNet: 920, hoNet: 850, amountPaid: 0, disputeSettled: 50, disputeAmount: 0, totalAmountPayable: 920 },
    { bookingId: "BID-1003", spNet: 1_100, hoNet: 1_050, amountPaid: 300, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 1_100 },
    { bookingId: "BID-1004", spNet: 780, hoNet: 780, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 780 },
    { bookingId: "BID-1005", spNet: 850, hoNet: 670, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 850, isAlreadyReconciled: true, arSubReason: "" },
    { bookingId: "BID-1006", spNet: 700, hoNet: 700, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 700 },
  ],
  "TID-90456": [
    { bookingId: "BID-2001", spNet: 4_600, hoNet: 3_100, amountPaid: 1_000, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 4_600 },
    { bookingId: "BID-2002", spNet: 5_200, hoNet: 3_400, amountPaid: 0, disputeSettled: 200, disputeAmount: 0, totalAmountPayable: 5_200 },
    { bookingId: "BID-2003", spNet: -1_200, hoNet: 0, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 0, isNegativeSp: true },
    { bookingId: "BID-2004", spNet: 3_800, hoNet: 2_500, amountPaid: 500, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 3_800, isUnmapped: true },
  ],
  "TID-90789": [
    { bookingId: "BID-3001", spNet: 3_200, hoNet: 1_400, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 3_200 },
    { bookingId: "BID-3002", spNet: 2_800, hoNet: 1_200, amountPaid: 500, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 2_800 },
    { bookingId: "BID-3003", spNet: 2_900, hoNet: 1_300, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 2_900 },
  ],
  "TID-91012": [
    { bookingId: "BID-4001", spNet: 1_200, hoNet: 800, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 1_200, vendorId: "VND-ORIG-001" },
    { bookingId: "BID-4002", spNet: 1_000, hoNet: 700, amountPaid: 0, disputeSettled: 100, disputeAmount: 0, totalAmountPayable: 1_000, vendorId: "VND-ORIG-002" },
    { bookingId: "BID-4003", spNet: 900, hoNet: 600, amountPaid: 0, disputeSettled: 0, disputeAmount: 0, totalAmountPayable: 900, vendorId: "VND-ORIG-001" },
  ],
};

const PAX_ROWS = [
  { paxType: "Adult", dateRange: "12/01 - 28/01", count: 8, spUnit: 650, hoUnit: 600 },
  { paxType: "Adult", dateRange: "01/02 - 15/02", count: 4, spUnit: 680, hoUnit: 620 },
  { paxType: "Child", dateRange: "12/01 - 15/02", count: 3, spUnit: 420, hoUnit: 400 },
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function OptionA_ExpandActions() {
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [highlightedTid, setHighlightedTid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");
  const [showPax, setShowPax] = useState<string | null>(null);
  const [showSpConfirm, setShowSpConfirm] = useState<string | null>(null);
  const [showHoConfirm, setShowHoConfirm] = useState<string | null>(null);
  const [disputeChecked, setDisputeChecked] = useState(false);
  const [issueChecked, setIssueChecked] = useState(false);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});
  const [selectedTids, setSelectedTids] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [bulkScope, setBulkScope] = useState<"all" | "selected">("all");

  const [isPortalDeposit, setIsPortalDeposit] = useState(true);
  const [showTakeAction, setShowTakeAction] = useState(false);
  const [takeActionPrice, setTakeActionPrice] = useState<"sp" | "ho">("sp");
  const [takeActionDisputes, setTakeActionDisputes] = useState<Set<string>>(new Set());
  const [takeActionIssues, setTakeActionIssues] = useState<Set<string>>(new Set());

  const [tidActions, setTidActions] = useState<Record<string, "sp" | "ho">>({});
  const [tapOverrides, setTapOverrides] = useState<Record<string, string>>({});
  const [activeDisputes, setActiveDisputes] = useState<Record<string, string>>({});
  const [disputeEditing, setDisputeEditing] = useState<string | null>(null);
  const [disputeInput, setDisputeInput] = useState("");
  const [arDecisions, setArDecisions] = useState<Record<string, "pay" | "dont_pay">>({});
  const [arReasons, setArReasons] = useState<Record<string, string>>({});
  const [unmappedResolved, setUnmappedResolved] = useState<Set<string>>(new Set());
  const [vendorOverrides, setVendorOverrides] = useState<Record<string, string>>({});

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));
  const resolveMultiple = (tids: string[]) => setResolvedTids(prev => { const next = new Set(prev); tids.forEach(t => next.add(t)); return next; });

  const toggleSelect = (tid: string) => {
    setSelectedTids(prev => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid); else next.add(tid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const unresolvedTids = filteredTids.filter(t => !resolvedTids.has(t.tid));
    if (selectedTids.size === unresolvedTids.length) {
      setSelectedTids(new Set());
    } else {
      setSelectedTids(new Set(unresolvedTids.map(t => t.tid)));
    }
  };

  const handleAnalysisClick = (tid: string) => {
    setHighlightedTid(tid);
    setExpandedTid(tid);
    setShowPax(null);
    setShowSpConfirm(null);
    setTimeout(() => {
      document.getElementById(`a-tid-${tid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightedTid(null), 3000);
  };

  const getBulkTids = () => bulkScope === "all" ? TIDS.map(t => t.tid) : Array.from(selectedTids);
  const getBulkTidData = () => bulkScope === "all" ? TIDS : TIDS.filter(t => selectedTids.has(t.tid));

  const handleBulkAction = (action: string) => {
    const tids = getBulkTids();
    if (action === "ho" || action === "sp") {
      setTidActions(prev => { const next = { ...prev }; tids.forEach(t => { next[t] = action as "sp" | "ho"; }); return next; });
      resolveMultiple(tids);
      flash(`${tids.length} TIDs → ${action === "sp" ? "SP" : "HO"} Net applied`);
      setSelectedTids(new Set());
      setBulkConfirm(null);
    } else if (action === "dispute") {
      flash(`Dispute raised for ${tids.length} TIDs`);
      setSelectedTids(new Set());
      setBulkConfirm(null);
    } else if (action === "issue") {
      flash(`Issue logged for ${tids.length} TIDs`);
      setSelectedTids(new Set());
      setBulkConfirm(null);
    }
  };

  const openDiscrepancyAction = (action: string) => { setBulkScope("all"); setBulkConfirm(action); };
  const openSelectionAction = (action: string) => { setBulkScope("selected"); setBulkConfirm(action); };

  const getTap = (b: BookingData, tid?: string): number => {
    if (tapOverrides[b.bookingId] !== undefined && tapOverrides[b.bookingId] !== "") return parseFloat(tapOverrides[b.bookingId]) || 0;
    if (b.isNegativeSp) { if (b.hoNet === 0) return 0; if (Math.abs(b.spNet) === Math.abs(b.hoNet)) return 0; return Math.abs(Math.abs(b.hoNet) - Math.abs(b.spNet)); }
    const tidAction = tid ? tidActions[tid] : undefined;
    if (tidAction === "ho") return b.hoNet;
    return b.spNet;
  };

  const getPricePayable = (b: BookingData, tid?: string): number => getTap(b, tid) - b.amountPaid;

  const filteredTids = TIDS.filter(t => !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) || t.experience.toLowerCase().includes(tidSearch.toLowerCase()));
  const resolvedCount = TIDS.filter(t => resolvedTids.has(t.tid)).length;
  const totalDisc = TIDS.reduce((s, t) => s + t.discUsd, 0);

  const renderBookingTable = (tid: TidData) => {
    const bookings = MOCK_BOOKINGS[tid.tid] || [];
    const isSecVendor = tid.isSecondaryVendor;

    const totals = bookings.reduce((acc, b) => {
      acc.spNet += b.spNet;
      acc.hoNet += b.hoNet;
      acc.tap += getTap(b, tid.tid);
      acc.amtPaid += b.amountPaid;
      acc.dispAmt += parseFloat(activeDisputes[b.bookingId] || "0");
      acc.dispSettled += b.disputeSettled;
      acc.pricePayable += getPricePayable(b, tid.tid);
      return acc;
    }, { spNet: 0, hoNet: 0, tap: 0, amtPaid: 0, dispAmt: 0, dispSettled: 0, pricePayable: 0 });

    return (
      <div className="rounded-md border overflow-hidden bg-background">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="h-7 bg-muted/30 border-b">
                <th className="text-left font-medium text-muted-foreground px-2 py-1 whitespace-nowrap min-w-[100px]">Booking ID</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-20">SP Net</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-20">HO Net</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">TAP</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-20">Amt Paid</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">Dispute</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-20">Disp. Settled</th>
                <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24 font-semibold text-foreground">Price Payable</th>
                {isSecVendor && <th className="text-left font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-28">Vendor ID</th>}
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => {
                const hasDispute = !!activeDisputes[b.bookingId];
                const isEditingDispute = disputeEditing === b.bookingId;
                const maxDisp = Math.abs(b.spNet - b.hoNet);
                const tap = getTap(b, tid.tid);
                const pricePayable = getPricePayable(b, tid.tid);

                return (
                  <tr key={b.bookingId} className={`h-8 border-b last:border-0 transition-colors ${hasDispute ? "bg-amber-50/50" : ""} ${b.isNegativeSp ? "bg-red-50/30" : ""} ${b.isAlreadyReconciled ? "bg-violet-50/30" : ""} hover:bg-muted/20`}>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-primary font-medium">{b.bookingId}</span>
                        {hasDispute && <Badge className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-200">{fmt(parseFloat(activeDisputes[b.bookingId]))}</Badge>}
                        {b.isNegativeSp && <Badge className="text-[9px] px-1 py-0 bg-red-100 text-red-700 border-red-200">Refund</Badge>}
                        {b.isAlreadyReconciled && <Badge className="text-[9px] px-1 py-0 bg-violet-100 text-violet-700 border-violet-200">AR</Badge>}
                        {b.isUnmapped && <Badge className="text-[9px] px-1 py-0 bg-slate-100 text-slate-700 border-slate-200">Unmapped</Badge>}
                      </div>
                    </td>
                    <td className={`text-right px-2 py-1 font-mono ${b.isNegativeSp ? "text-red-600 font-semibold" : "text-blue-600"}`}>{fmt(b.spNet)}</td>
                    <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(b.hoNet)}</td>
                    <td className="text-right px-2 py-1">
                      {b.isAlreadyReconciled ? (
                        <span className="font-mono text-muted-foreground">—</span>
                      ) : b.isNegativeSp ? (
                        <span className="font-mono text-red-600 font-semibold">{fmt(tap)}</span>
                      ) : (
                        <Input
                          className="h-6 w-20 text-[11px] text-right font-mono ml-auto border-dashed"
                          value={tapOverrides[b.bookingId] ?? String(tap)}
                          onChange={e => setTapOverrides(p => ({ ...p, [b.bookingId]: e.target.value }))}
                        />
                      )}
                    </td>
                    <td className={`text-right px-2 py-1 font-mono ${b.amountPaid > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>{b.amountPaid > 0 ? fmt(b.amountPaid) : "—"}</td>
                    <td className="text-right px-2 py-1">
                      {isEditingDispute ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Input
                            className="h-6 w-16 text-[11px] text-right font-mono border-amber-300"
                            value={disputeInput}
                            onChange={e => { const v = parseFloat(e.target.value) || 0; setDisputeInput(String(Math.max(0, Math.min(v, maxDisp)))); }}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-green-600" onClick={() => { setActiveDisputes(p => ({ ...p, [b.bookingId]: disputeInput || String(maxDisp) })); setDisputeEditing(null); flash(`Dispute ${fmt(parseFloat(disputeInput || String(maxDisp)))} raised`); }}>
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-muted-foreground" onClick={() => setDisputeEditing(null)}>
                            <XIcon className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : hasDispute ? (
                        <div className="flex items-center gap-1 justify-end">
                          <span className="font-mono text-amber-700 font-medium">{fmt(parseFloat(activeDisputes[b.bookingId]))}</span>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400 hover:text-red-600" onClick={() => { setActiveDisputes(p => { const n = { ...p }; delete n[b.bookingId]; return n; }); flash("Dispute removed"); }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-amber-600 hover:text-amber-700 hover:bg-amber-50" onClick={() => { setDisputeEditing(b.bookingId); setDisputeInput(String(maxDisp)); }}>
                          <Gavel className="h-3 w-3 mr-0.5" /> Raise
                        </Button>
                      )}
                    </td>
                    <td className={`text-right px-2 py-1 font-mono ${b.disputeSettled > 0 ? "text-teal-600" : "text-muted-foreground"}`}>{b.disputeSettled > 0 ? fmt(b.disputeSettled) : "—"}</td>
                    <td className="text-right px-2 py-1 font-mono font-semibold text-foreground">{fmt(pricePayable)}</td>
                    {isSecVendor && (
                      <td className="px-2 py-1">
                        <Input
                          className="h-6 w-24 text-[11px] font-mono border-dashed"
                          value={vendorOverrides[b.bookingId] ?? b.vendorId ?? ""}
                          onChange={e => setVendorOverrides(p => ({ ...p, [b.bookingId]: e.target.value }))}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="h-8 bg-muted/40 border-t font-semibold text-[11px]">
                <td className="px-2 py-1 text-muted-foreground">Total ({bookings.length})</td>
                <td className="text-right px-2 py-1 font-mono text-blue-600">{fmt(totals.spNet)}</td>
                <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(totals.hoNet)}</td>
                <td className="text-right px-2 py-1 font-mono">{fmt(totals.tap)}</td>
                <td className="text-right px-2 py-1 font-mono text-emerald-600">{totals.amtPaid > 0 ? fmt(totals.amtPaid) : "—"}</td>
                <td className="text-right px-2 py-1 font-mono text-amber-700">{totals.dispAmt > 0 ? fmt(totals.dispAmt) : "—"}</td>
                <td className="text-right px-2 py-1 font-mono text-teal-600">{totals.dispSettled > 0 ? fmt(totals.dispSettled) : "—"}</td>
                <td className="text-right px-2 py-1 font-mono font-bold text-foreground">{fmt(totals.pricePayable)}</td>
                {isSecVendor && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* AR / Unmapped special rows */}
        {bookings.some(b => b.isAlreadyReconciled || b.isUnmapped) && (
          <div className="border-t bg-muted/10 px-3 py-2 space-y-2">
            {bookings.filter(b => b.isAlreadyReconciled).map(b => (
              <div key={`ar-${b.bookingId}`} className="flex items-center gap-3 rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2 text-xs">
                <Badge className="text-[9px] px-1.5 py-0 bg-violet-100 text-violet-700 border-violet-200 flex-shrink-0">AR</Badge>
                <span className="font-mono font-medium text-primary">{b.bookingId}</span>
                <div className="h-4 w-px bg-violet-200" />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant={arDecisions[b.bookingId] === "pay" ? "default" : "outline"} className={`h-6 text-[10px] px-2 ${arDecisions[b.bookingId] === "pay" ? "bg-green-600 hover:bg-green-700 text-white" : "text-green-700 border-green-300"}`}
                    onClick={() => setArDecisions(p => ({ ...p, [b.bookingId]: "pay" }))}>
                    Pay
                  </Button>
                  <Button size="sm" variant={arDecisions[b.bookingId] === "dont_pay" ? "default" : "outline"} className={`h-6 text-[10px] px-2 ${arDecisions[b.bookingId] === "dont_pay" ? "bg-red-600 hover:bg-red-700 text-white" : "text-red-700 border-red-300"}`}
                    onClick={() => setArDecisions(p => ({ ...p, [b.bookingId]: "dont_pay" }))}>
                    Don't Pay
                  </Button>
                </div>
                {arDecisions[b.bookingId] && (
                  <Select value={arReasons[b.bookingId] || ""} onValueChange={v => setArReasons(p => ({ ...p, [b.bookingId]: v }))}>
                    <SelectTrigger className="h-6 w-36 text-[10px]">
                      <SelectValue placeholder="Sub-reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {arDecisions[b.bookingId] === "pay" ? (
                        <>
                          <SelectItem value="manual_error">Manual Error</SelectItem>
                          <SelectItem value="partial_fulfillment">Partial Fulfillment</SelectItem>
                          <SelectItem value="rate_change">Rate Change</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="already_paid">Already Paid</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                          <SelectItem value="duplicate">Duplicate</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )}
                {arDecisions[b.bookingId] && arReasons[b.bookingId] && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                )}
              </div>
            ))}
            {bookings.filter(b => b.isUnmapped && !unmappedResolved.has(b.bookingId)).map(b => (
              <div key={`um-${b.bookingId}`} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs">
                <Badge className="text-[9px] px-1.5 py-0 bg-slate-100 text-slate-700 border-slate-200 flex-shrink-0">Unmapped</Badge>
                <span className="font-mono font-medium text-primary">{b.bookingId}</span>
                <div className="h-4 w-px bg-slate-200" />
                <span className="text-muted-foreground">Assign to:</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => { setUnmappedResolved(p => new Set(p).add(b.bookingId)); flash(`${b.bookingId} → Finance-Prepurchase`); }}>
                  Finance-Prepurchase
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => { setUnmappedResolved(p => new Set(p).add(b.bookingId)); flash(`${b.bookingId} → Reservation Ops`); }}>
                  Reservation Ops
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      <div className="border-b bg-card px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Option A: Action Strip on Expand</span>
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">Enhanced</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Net Price Discrepancy</span>
          <Badge variant="secondary" className="text-xs">28 bookings</Badge>
          {resolvedCount > 0 && <Badge className="text-xs bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3 mr-1" />{resolvedCount}/{TIDS.length}</Badge>}
        </div>
      </div>

      {feedback && (
        <div className="mx-4 mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md flex items-center gap-2 text-sm text-green-700 animate-in fade-in duration-200">
          <CheckCircle2 className="h-4 w-4" />{feedback}
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">
        <div className="flex-shrink-0 border-b">
          <div className="flex items-center justify-between px-4 py-2 bg-violet-50/70 border-b cursor-pointer hover:bg-violet-50" onClick={() => setAnalysisOpen(!analysisOpen)}>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold text-violet-800">Discrepancy Analysis</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 border-violet-200">{TIDS.length} TIDs</Badge>
              <span className="text-[11px] text-violet-600">Click a row to jump to actions ↓</span>
            </div>
            {analysisOpen ? <PanelTopClose className="h-4 w-4 text-violet-500" /> : <PanelTop className="h-4 w-4 text-violet-500" />}
          </div>
          {analysisOpen && (
            <div className="max-h-[32vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-8 bg-violet-50/40">
                    <TableHead className="py-1.5 text-xs pl-4">TID</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                    <TableHead className="py-1.5 text-xs">Fulfilment</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">HO Rate</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">Actual</TableHead>
                    <TableHead className="py-1.5 text-xs">Start</TableHead>
                    <TableHead className="py-1.5 text-xs">End</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">Disc %</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">BIDs w/ Disc</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">BIDs Dur.</TableHead>
                    <TableHead className="py-1.5 text-xs text-center">Loss?</TableHead>
                    <TableHead className="py-1.5 text-xs text-right pr-4">Loss USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TIDS.map(t => (
                    <TableRow key={t.tid} className={`h-9 cursor-pointer hover:bg-violet-50/60 ${resolvedTids.has(t.tid) ? "opacity-50" : ""}`} onClick={() => handleAnalysisClick(t.tid)}>
                      <TableCell className="py-1.5 pl-4 font-mono text-sm text-primary font-medium">
                        <div className="flex items-center gap-1.5">
                          {resolvedTids.has(t.tid) && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                          {t.tid}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm text-red-600">{fmt(t.discUsd)}</TableCell>
                      <TableCell className="py-1.5 text-sm">{t.fm}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm">{t.hoTakeRate.toFixed(2)}%</TableCell>
                      <TableCell className={`py-1.5 text-right font-mono text-sm ${t.actualTakeRate < 0 ? "text-red-600 font-semibold" : ""}`}>{t.actualTakeRate.toFixed(2)}%</TableCell>
                      <TableCell className="py-1.5 text-sm">{t.startDate}</TableCell>
                      <TableCell className="py-1.5 text-sm">{t.endDate}</TableCell>
                      <TableCell className={`py-1.5 text-right font-mono text-sm ${t.discPercent.startsWith("-") ? "text-red-600" : ""}`}>{t.discPercent}</TableCell>
                      <TableCell className="py-1.5 text-right text-sm">{t.bidCountWithDisc}</TableCell>
                      <TableCell className="py-1.5 text-right text-sm">{t.bidCountInDuration}</TableCell>
                      <TableCell className="py-1.5 text-center"><Badge variant={t.soldAtLoss ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">{t.soldAtLoss ? "Yes" : "No"}</Badge></TableCell>
                      <TableCell className={`py-1.5 text-right font-mono text-sm pr-4 ${t.lossUsd > 0 ? "text-red-600 font-semibold" : ""}`}>{t.lossUsd ? fmt(t.lossUsd) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto px-4 pb-4 pt-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Actions</span>
              <Badge variant="secondary" className="text-xs">{TIDS.length} TIDs</Badge>
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search TIDs..." className="h-8 pl-8 w-48 text-xs" value={tidSearch} onChange={e => setTidSearch(e.target.value)} />
            </div>
          </div>

          {!bulkConfirm && !showTakeAction && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center gap-2.5">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">All {TIDS.length} TIDs:</span>
              <div className="h-4 w-px bg-border" />
              <Button size="sm" className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => { setShowTakeAction(true); setTakeActionPrice("sp"); setTakeActionDisputes(new Set()); setTakeActionIssues(new Set()); }}>
                <Zap className="h-3.5 w-3.5" /> Take Action
              </Button>
            </div>
          )}

          {showTakeAction && !bulkConfirm && (() => {
            const allTids = TIDS;
            const isSp = takeActionPrice === "sp";
            const totalSp = allTids.reduce((s, t) => s + t.spNet, 0);
            const totalHo = allTids.reduce((s, t) => s + t.hoNet, 0);
            const totalPayable = isSp ? totalSp : totalHo;
            const totalDiff = Math.abs(totalSp - totalHo);
            const disputeTotal = allTids.filter(t => takeActionDisputes.has(t.tid)).reduce((s, t) => s + Math.abs(t.spNet - t.hoNet), 0);
            const disputeCount = takeActionDisputes.size;
            const issueCount = takeActionIssues.size;

            const toggleDisputeTid = (tid: string) => setTakeActionDisputes(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else next.add(tid); return next; });
            const toggleIssueTid = (tid: string) => setTakeActionIssues(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else next.add(tid); return next; });

            const summaryParts = [isSp ? "SP Net" : "HO Net"];
            if (disputeCount > 0) summaryParts.push(`${disputeCount} dispute${disputeCount > 1 ? "s" : ""}`);
            if (issueCount > 0) summaryParts.push(`${issueCount} issue${issueCount > 1 ? "s" : ""}`);

            return (
              <div className="rounded-lg border-2 border-primary/30 bg-background p-4 space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Zap className="h-4 w-4 text-primary" />
                    Take Action — All {allTids.length} TIDs
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowTakeAction(false)}>
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Step 1: Select Price</div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className={`h-8 text-xs gap-1.5 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-transparent border border-blue-300 text-blue-700 hover:bg-blue-50"}`} onClick={() => { setTakeActionPrice("sp"); setTakeActionDisputes(new Set()); }}>
                      <TrendingUp className="h-3.5 w-3.5" /> SP Net {isSp && <Check className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" className={`h-8 text-xs gap-1.5 ${!isSp ? "bg-green-700 hover:bg-green-800 text-white" : "bg-transparent border border-green-300 text-green-700 hover:bg-green-50"}`} onClick={() => { setTakeActionPrice("ho"); setTakeActionDisputes(new Set()); }}>
                      <TrendingDown className="h-3.5 w-3.5" /> HO Net {!isSp && <Check className="h-3 w-3" />}
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="rounded border p-2 bg-muted/30"><span className="text-muted-foreground">SP Net</span><div className={`font-mono font-semibold ${isSp ? "text-blue-700" : "text-muted-foreground"}`}>{fmt(totalSp)}</div></div>
                    <div className="rounded border p-2 bg-muted/30"><span className="text-muted-foreground">HO Net</span><div className={`font-mono font-semibold ${!isSp ? "text-green-700" : "text-muted-foreground"}`}>{fmt(totalHo)}</div></div>
                    <div className="rounded border p-2 bg-muted/30"><span className="text-muted-foreground">Difference</span><div className="font-mono font-semibold text-amber-600">{fmt(totalDiff)}</div></div>
                    <div className={`rounded border-2 p-2 ${isSp ? "border-blue-300 bg-blue-50/50" : "border-green-300 bg-green-50/50"}`}><span className="text-muted-foreground">Payable</span><div className={`font-mono font-bold ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(totalPayable)}</div></div>
                  </div>
                  {isPortalDeposit && !isSp && (
                    <div className="flex items-start gap-2.5 rounded-md border-2 border-amber-400 bg-amber-50/60 px-3 py-2.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800 leading-relaxed">
                        You have selected HO Net for portal deposit reconciliation. We have already been charged SP Net for this booking. Consider selecting <button className="font-semibold underline underline-offset-2 hover:text-amber-950" onClick={() => { setTakeActionPrice("sp"); setTakeActionDisputes(new Set()); }}>SP Net</button> and raising a dispute for the same.
                      </p>
                    </div>
                  )}
                </div>

                {isSp && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">Step 2: Raise Dispute <span className="text-[10px] font-normal">(optional)</span></div>
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
                          <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => { setTakeActionDisputes(prev => prev.size === allTids.length ? new Set() : new Set(allTids.map(t => t.tid))); }}>
                            {takeActionDisputes.size === allTids.length ? "None" : "All"}
                          </Button>
                        </div>
                        <div className="grid grid-cols-[auto_5fr_3fr_3fr_3fr] gap-0 px-3 py-1 border-t text-[10px] font-medium text-muted-foreground bg-muted/10">
                          <div className="w-5" />
                          <div>TID / Experience</div>
                          <div className="text-right text-blue-600">SP Net</div>
                          <div className="text-right text-green-600">HO Net</div>
                          <div className="text-right text-amber-600">Difference</div>
                        </div>
                        {allTids.map(t => {
                          const isChecked = takeActionDisputes.has(t.tid);
                          return (
                            <div key={t.tid} className={`grid grid-cols-[auto_5fr_3fr_3fr_3fr] gap-0 items-center px-3 py-1.5 border-t text-xs cursor-pointer hover:bg-muted/20 transition-colors ${isChecked ? "bg-amber-50/40" : ""}`} onClick={() => toggleDisputeTid(t.tid)}>
                              <Checkbox checked={isChecked} className="h-3.5 w-3.5 mr-2" />
                              <div className="truncate"><span className="font-mono font-medium text-primary">{t.tid}</span> <span className="text-muted-foreground text-[11px]">{t.experience}</span></div>
                              <div className="font-mono text-right text-blue-600">{fmt(t.spNet)}</div>
                              <div className="font-mono text-right text-green-600">{fmt(t.hoNet)}</div>
                              <div className="font-mono text-right text-amber-600 font-medium">{fmt(Math.abs(t.spNet - t.hoNet))}</div>
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
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{isSp ? "Step 3" : "Step 2"}: Raise Issue <span className="text-[10px] font-normal">(optional)</span></div>
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
                        <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => { setTakeActionIssues(prev => prev.size === allTids.length ? new Set() : new Set(allTids.map(t => t.tid))); }}>
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
                        return (
                          <div key={t.tid} className={`grid grid-cols-[auto_4fr_2fr_2fr_2fr_3fr] gap-0 items-center px-3 py-1.5 border-t text-xs cursor-pointer hover:bg-muted/20 transition-colors ${isChecked ? "bg-orange-50/40" : ""}`} onClick={() => toggleIssueTid(t.tid)}>
                            <Checkbox checked={isChecked} className="h-3.5 w-3.5 mr-2" />
                            <div className="truncate"><span className="font-mono font-medium text-primary">{t.tid}</span> <span className="text-muted-foreground text-[11px]">{t.experience}</span></div>
                            <div className="font-mono text-right text-blue-600">{fmt(t.spNet)}</div>
                            <div className="font-mono text-right text-green-600">{fmt(t.hoNet)}</div>
                            <div className="font-mono text-right text-amber-600 font-medium">{fmt(Math.abs(t.spNet - t.hoNet))}</div>
                            <div className="text-right text-violet-600 text-[11px] truncate pl-1">{t.driTeam}</div>
                          </div>
                        );
                      })}
                      {issueCount > 0 && (() => {
                        const selectedIssue = allTids.filter(t => takeActionIssues.has(t.tid));
                        const teamCounts: Record<string, number> = {};
                        selectedIssue.forEach(t => t.driTeam.split(", ").forEach(team => { teamCounts[team] = (teamCounts[team] || 0) + 1; }));
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
                </div>

                <div className="flex items-center justify-between pt-1 border-t">
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowTakeAction(false)}>Cancel</Button>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => {
                      const allTidIds = allTids.map(t => t.tid);
                      setTidActions(prev => { const next = { ...prev }; allTidIds.forEach(t => { next[t] = takeActionPrice; }); return next; });
                      resolveMultiple(allTidIds);
                      const flashParts = [`All ${allTids.length} TIDs → ${isSp ? "SP" : "HO"} Net applied`];
                      if (disputeCount > 0) flashParts.push(`${disputeCount} dispute${disputeCount > 1 ? "s" : ""} raised`);
                      if (issueCount > 0) flashParts.push(`${issueCount} issue${issueCount > 1 ? "s" : ""} logged`);
                      flash(flashParts.join(" · "));
                      setShowTakeAction(false);
                      setSelectedTids(new Set());
                    }}>
                      <Check className="h-3.5 w-3.5" /> Confirm & Apply <Badge variant="secondary" className="text-[10px] ml-1 px-1.5 py-0">{summaryParts.join(" · ")}</Badge>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}

          {selectedTids.size >= 2 && !bulkConfirm && (
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
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
            const selectedTidData = getBulkTidData();
            const isSp = bulkConfirm === "sp";
            const totalPayable = selectedTidData.reduce((s, t) => s + (isSp ? t.spNet : t.hoNet), 0);
            const totalSp = selectedTidData.reduce((s, t) => s + t.spNet, 0);
            const totalHo = selectedTidData.reduce((s, t) => s + t.hoNet, 0);
            const totalDiscount = isSp ? totalSp - totalHo : 0;
            return (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/60 p-3 space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                    {isSp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    Bulk {isSp ? "SP Net" : "HO Net"} —
                    {bulkScope === "all" ? <span>All {selectedTidData.length} TIDs</span> : <span>{selectedTidData.length} selected TIDs</span>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="rounded-md border overflow-hidden bg-white">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b">
                    <div>TID</div>
                    <div className="text-right w-24 px-2 text-blue-600">SP Net</div>
                    <div className="text-right w-24 px-2 text-green-600">HO Net</div>
                    <div className="text-right w-24 px-2">Disc. LC</div>
                    <div className="text-right w-28 px-2 font-semibold text-foreground">Payable</div>
                  </div>
                  {selectedTidData.map(t => (
                    <div key={t.tid} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 border-b last:border-0 text-xs">
                      <div>
                        <span className="font-mono font-medium text-primary">{t.tid}</span>
                        <span className="text-muted-foreground ml-1.5 text-[10px]">{t.experience.slice(0, 22)}{t.experience.length > 22 ? "…" : ""}</span>
                      </div>
                      <div className={`text-right w-24 px-2 font-mono ${isSp ? "font-semibold text-blue-700" : "text-muted-foreground"}`}>{fmt(t.spNet)}</div>
                      <div className={`text-right w-24 px-2 font-mono ${!isSp ? "font-semibold text-green-700" : "text-muted-foreground"}`}>{fmt(t.hoNet)}</div>
                      <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(t.discLc)}</div>
                      <div className={`text-right w-28 px-2 font-mono font-semibold ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(isSp ? t.spNet : t.hoNet)}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 bg-muted/30 border-t text-xs font-semibold">
                    <div className="text-muted-foreground">Total ({selectedTidData.length} TIDs)</div>
                    <div className="text-right w-24 px-2 font-mono text-blue-600">{fmt(totalSp)}</div>
                    <div className="text-right w-24 px-2 font-mono text-green-600">{fmt(totalHo)}</div>
                    <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(selectedTidData.reduce((s, t) => s + t.discLc, 0))}</div>
                    <div className={`text-right w-28 px-2 font-mono text-sm ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(totalPayable)}</div>
                  </div>
                </div>
                {isSp && totalDiscount > 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                    <span className="text-amber-800">Paying <span className="font-mono font-semibold">{fmt(totalDiscount)}</span> above HO Net across {selectedTidData.length} TIDs — consider raising disputes.</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                  <Button size="sm" className={`h-7 text-xs gap-1 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`} variant={isSp ? "default" : "outline"} onClick={() => handleBulkAction(bulkConfirm)}>
                    <Check className="h-3 w-3" /> Apply {isSp ? "SP Net" : "HO Net"} to {selectedTidData.length} TIDs
                  </Button>
                </div>
              </div>
            );
          })()}

          {bulkConfirm && bulkConfirm !== "sp" && bulkConfirm !== "ho" && (() => {
            const confirmTidData = getBulkTidData();
            return (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50/80 p-3 space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    {bulkConfirm === "dispute" ? "Raise Dispute" : "Log Issue"} for {bulkScope === "all" ? `all ${confirmTidData.length}` : `${confirmTidData.length} selected`} TIDs
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {confirmTidData.map(t => (
                    <Badge key={t.tid} variant="outline" className="text-xs font-mono">{t.tid}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleBulkAction(bulkConfirm)}>
                    <Check className="h-3 w-3" /> Confirm & Apply
                  </Button>
                </div>
              </div>
            );
          })()}

          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
              <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelectAll(); }}>
                <Checkbox checked={selectedTids.size > 0 && selectedTids.size === filteredTids.filter(t => !resolvedTids.has(t.tid)).length} className="h-3.5 w-3.5" />
              </div>
              <div className="w-5" />
              <div className="pl-2">TID / Experience</div>
              <div className="text-right px-3 w-24">SP Net</div>
              <div className="text-right px-3 w-24">HO Net</div>
              <div className="text-right px-3 w-24">Disc.</div>
              <div className="text-center px-2 w-14 pr-3">BIDs</div>
            </div>

            {filteredTids.map(tid => {
              const isExpanded = expandedTid === tid.tid;
              const isResolved = resolvedTids.has(tid.tid);
              const isHighlighted = highlightedTid === tid.tid;
              const isSelected = selectedTids.has(tid.tid);
              const pct = ((tid.discUsd / totalDisc) * 100).toFixed(0);

              return (
                <div key={tid.tid} id={`a-tid-${tid.tid}`} className={`transition-all duration-500 ${isResolved ? "bg-green-50/40" : ""} ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30" : ""} ${isSelected && !isResolved ? "bg-primary/5" : ""}`}>
                  <div className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                    onClick={() => { setExpandedTid(isExpanded ? null : tid.tid); setShowPax(null); setShowSpConfirm(null); setShowHoConfirm(null); setDisputeChecked(false); setIssueChecked(false); setDisputeEditing(null); }}>
                    <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); if (!isResolved) toggleSelect(tid.tid); }}>
                      {!isResolved && <Checkbox checked={isSelected} className="h-3.5 w-3.5" />}
                    </div>
                    <div className="w-5 flex items-center">
                      {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="pl-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{tid.fm}</Badge>
                        {tid.soldAtLoss && <Badge variant="destructive" className="text-[10px] px-1 py-0">Loss</Badge>}
                        {tid.isSecondaryVendor && <Badge className="text-[10px] px-1 py-0 bg-orange-100 text-orange-700 border-orange-200">2nd Vendor</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{tid.experience}</div>
                    </div>
                    <div className="text-right px-3 w-24 font-mono text-sm">{fmt(tid.spNet)}</div>
                    <div className="text-right px-3 w-24 font-mono text-sm">{fmt(tid.hoNet)}</div>
                    <div className="text-right px-3 w-24">
                      <span className="font-mono text-sm text-red-600">{fmt(tid.discLc)}</span>
                      <span className="text-[10px] text-muted-foreground ml-0.5">({pct}%)</span>
                    </div>
                    <div className="text-center px-2 w-14 text-sm pr-3">{tid.bidCount}</div>
                  </div>

                  {isExpanded && (
                    <div className="border-b bg-muted/10 px-4 py-3 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                          <span className="text-muted-foreground">Take Rate:</span>
                          <span className="font-mono font-medium">{tid.hoTakeRate}%</span>
                          <span className="text-muted-foreground">→</span>
                          <span className={`font-mono font-semibold ${tid.actualTakeRate < 0 ? "text-red-600" : tid.actualTakeRate < tid.hoTakeRate ? "text-amber-600" : "text-green-600"}`}>{tid.actualTakeRate}%</span>
                          <span className={`text-[10px] font-medium ${tid.discPercent.startsWith("-") ? "text-red-500" : "text-green-500"}`}>({tid.discPercent})</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                          <span className="text-muted-foreground">Period:</span>
                          <span className="font-medium">{tid.startDate} – {tid.endDate}</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                          <span className="text-muted-foreground">BIDs w/ disc:</span>
                          <span className="font-mono font-medium">{tid.bidCountWithDisc}/{tid.bidCountInDuration}</span>
                        </div>
                        {tid.soldAtLoss && (
                          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs">
                            <AlertTriangle className="h-3 w-3 text-red-600" />
                            <span className="font-medium text-red-700">Sold at Loss</span>
                            <span className="font-mono font-semibold text-red-600">{fmt(tid.lossUsd)} USD</span>
                          </div>
                        )}
                      </div>

                      {!showPax && !showSpConfirm && !showHoConfirm && (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
                          <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setShowSpConfirm(tid.tid); setShowHoConfirm(null); setDisputeChecked(false); setIssueChecked(false); }}>
                            <TrendingUp className="h-3.5 w-3.5" /> Set SP Net
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => { setShowHoConfirm(tid.tid); setShowSpConfirm(null); setIssueChecked(false); }}>
                            <TrendingDown className="h-3.5 w-3.5" /> Set HO Net
                          </Button>
                          {tid.hasPax && (
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-violet-700 border-violet-300 hover:bg-violet-50" onClick={() => { setShowPax(tid.tid); setPaxPrices({}); }}>
                              <Calculator className="h-3.5 w-3.5" /> Pax Pricing
                            </Button>
                          )}
                        </div>
                      )}

                      {showSpConfirm === tid.tid && (
                        <div className="rounded-md border bg-blue-50/50 p-3 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                            <TrendingUp className="h-4 w-4" /> Confirm: Set to SP Net
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">SP Net</span><div className="font-mono font-semibold text-blue-700">{fmt(tid.spNet)}</div></div>
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">HO Net</span><div className="font-mono font-semibold text-green-700">{fmt(tid.hoNet)}</div></div>
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">Difference</span><div className="font-mono font-semibold text-amber-600">+{fmt(tid.spNet - tid.hoNet)}</div></div>
                          </div>

                          <div className={`rounded-md border-2 overflow-hidden transition-colors ${disputeChecked ? "border-amber-500 bg-amber-50/50" : "border-border bg-white"}`}>
                            <div className="px-3 py-3">
                              <div className="flex items-start gap-3">
                                <div className={`flex items-center justify-center h-8 w-8 rounded-md flex-shrink-0 ${disputeChecked ? "bg-amber-100" : "bg-muted"}`}>
                                  <AlertTriangle className={`h-4 w-4 ${disputeChecked ? "text-amber-600" : "text-muted-foreground"}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-3 mb-0.5">
                                    <div className="text-xs font-semibold">Raise Dispute</div>
                                    <Switch checked={disputeChecked} onCheckedChange={setDisputeChecked} />
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-medium mb-0.5">This is SP error and refund to be claimed</div>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    Paying SP Net now. The difference of{" "}
                                    <span className="font-mono font-semibold text-amber-600">{fmt(Math.abs(tid.spNet - tid.hoNet))}</span>
                                    {" "}will be tracked as a dispute for future settlement — either adjusted against a future invoice or absorbed.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className={`rounded-md border-2 overflow-hidden transition-colors ${issueChecked ? "border-orange-500 bg-orange-50/50" : "border-border bg-white"}`}>
                            <div className="px-3 py-3">
                              <div className="flex items-start gap-3">
                                <div className={`flex items-center justify-center h-8 w-8 rounded-md flex-shrink-0 ${issueChecked ? "bg-orange-100" : "bg-muted"}`}>
                                  <FileWarning className={`h-4 w-4 ${issueChecked ? "text-orange-600" : "text-muted-foreground"}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-3 mb-0.5">
                                    <div className="text-xs font-semibold">Raise Issue</div>
                                    <Checkbox checked={issueChecked} onCheckedChange={(checked) => setIssueChecked(!!checked)} className="h-4 w-4" />
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-medium mb-0.5">This is HO error</div>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    To be checked with internal teams at Headout. The discrepancy of{" "}
                                    <span className="font-mono font-semibold text-orange-600">{fmt(Math.abs(tid.spNet - tid.hoNet))}</span>
                                    {" "}will be logged to the Issue Tracker for investigation and resolution.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSpConfirm(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setTidActions(p => ({ ...p, [tid.tid]: "sp" })); const extras = [disputeChecked && "dispute raised", issueChecked && "issue logged"].filter(Boolean).join(" + "); flash(`${tid.tid} → SP Net applied${extras ? " + " + extras : ""}`); resolve(tid.tid); setExpandedTid(null); setShowSpConfirm(null); }}>
                              <Check className="h-3 w-3" /> Confirm & Apply
                            </Button>
                          </div>
                        </div>
                      )}

                      {showHoConfirm === tid.tid && (
                        <div className="rounded-md border bg-green-50/50 p-3 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                            <TrendingDown className="h-4 w-4" /> Confirm: Set to HO Net
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">HO Net</span><div className="font-mono font-semibold text-green-700">{fmt(tid.hoNet)}</div></div>
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">SP Net</span><div className="font-mono font-semibold text-blue-700">{fmt(tid.spNet)}</div></div>
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">Difference</span><div className="font-mono font-semibold text-amber-600">{fmt(Math.abs(tid.spNet - tid.hoNet))}</div></div>
                          </div>

                          <div className={`rounded-md border-2 overflow-hidden transition-colors ${issueChecked ? "border-orange-500 bg-orange-50/50" : "border-border bg-white"}`}>
                            <div className="px-3 py-3">
                              <div className="flex items-start gap-3">
                                <div className={`flex items-center justify-center h-8 w-8 rounded-md flex-shrink-0 ${issueChecked ? "bg-orange-100" : "bg-muted"}`}>
                                  <FileWarning className={`h-4 w-4 ${issueChecked ? "text-orange-600" : "text-muted-foreground"}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-3 mb-0.5">
                                    <div className="text-xs font-semibold">Raise Issue</div>
                                    <Checkbox checked={issueChecked} onCheckedChange={(checked) => setIssueChecked(!!checked)} className="h-4 w-4" />
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-medium mb-0.5">This is HO error</div>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    To be checked with internal teams at Headout. The discrepancy of{" "}
                                    <span className="font-mono font-semibold text-orange-600">{fmt(Math.abs(tid.spNet - tid.hoNet))}</span>
                                    {" "}will be logged to the Issue Tracker for investigation and resolution.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowHoConfirm(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1 bg-green-700 hover:bg-green-800 text-white" onClick={() => { setTidActions(p => ({ ...p, [tid.tid]: "ho" })); flash(`${tid.tid} → HO Net applied${issueChecked ? " + issue logged" : ""}`); resolve(tid.tid); setExpandedTid(null); setShowHoConfirm(null); }}>
                              <Check className="h-3 w-3" /> Confirm & Apply
                            </Button>
                          </div>
                        </div>
                      )}

                      {showPax === tid.tid && (
                        <div className="rounded-md border bg-violet-50/30 p-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-violet-800">
                            <Calculator className="h-4 w-4" /> Pax Pricing
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Quick fill:</span>
                            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => { const p: Record<string, string> = {}; PAX_ROWS.forEach(r => p[`${r.paxType}__${r.dateRange}`] = String(r.spUnit)); setPaxPrices(p); }}>All SP</Button>
                            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => { const p: Record<string, string> = {}; PAX_ROWS.forEach(r => p[`${r.paxType}__${r.dateRange}`] = String(r.hoUnit)); setPaxPrices(p); }}>All HO</Button>
                          </div>
                          <Table>
                            <TableHeader><TableRow className="h-7"><TableHead className="text-xs py-1">Pax</TableHead><TableHead className="text-xs py-1">Dates</TableHead><TableHead className="text-xs py-1 text-right">Cnt</TableHead><TableHead className="text-xs py-1 text-right">SP</TableHead><TableHead className="text-xs py-1 text-right">HO</TableHead><TableHead className="text-xs py-1 text-right">Final</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {PAX_ROWS.map(r => { const k = `${r.paxType}__${r.dateRange}`; return (
                                <TableRow key={k} className="h-8">
                                  <TableCell className="py-1 text-xs">{r.paxType}</TableCell>
                                  <TableCell className="py-1 text-xs text-muted-foreground">{r.dateRange}</TableCell>
                                  <TableCell className="py-1 text-xs text-right">{r.count}</TableCell>
                                  <TableCell className="py-1 text-xs text-right font-mono text-blue-600">{fmt(r.spUnit)}</TableCell>
                                  <TableCell className="py-1 text-xs text-right font-mono text-green-600">{fmt(r.hoUnit)}</TableCell>
                                  <TableCell className="py-1 text-right"><Input className="h-6 w-20 text-xs text-right font-mono ml-auto" value={paxPrices[k] || ""} onChange={e => setPaxPrices(p => ({ ...p, [k]: e.target.value }))} /></TableCell>
                                </TableRow>
                              ); })}
                            </TableBody>
                          </Table>
                          <div className="flex items-center justify-between">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPax(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { flash("Pax prices applied"); resolve(tid.tid); setExpandedTid(null); setShowPax(null); }}>
                              <Check className="h-3 w-3" /> Apply Pax Prices
                            </Button>
                          </div>
                        </div>
                      )}

                      {!showPax && !showSpConfirm && !showHoConfirm && renderBookingTable(tid)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/30 px-5 py-2 flex items-center justify-between flex-shrink-0 text-xs">
        <span className="text-muted-foreground">{TIDS.length} TIDs · 28 bookings</span>
        <div className="flex items-center gap-4">
          <span><span className="text-muted-foreground mr-1">SP</span><span className="font-mono font-medium text-blue-700">{fmt(TIDS.reduce((s, t) => s + t.spNet, 0))}</span></span>
          <span><span className="text-muted-foreground mr-1">HO</span><span className="font-mono font-medium text-green-700">{fmt(TIDS.reduce((s, t) => s + t.hoNet, 0))}</span></span>
          <span><span className="text-muted-foreground mr-1">Disc.</span><span className="font-mono font-semibold text-red-600">{fmt(TIDS.reduce((s, t) => s + t.discLc, 0))}</span></span>
        </div>
      </div>
    </div>
  );
}

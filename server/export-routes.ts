import type { Express } from "express";
import XLSX from "xlsx-js-style";
import { storage } from "./storage";
import { formatIndianNumber, formatDateValue, getUniqueSheetName, sanitizeSheetName, getExportData, getExcelExportData } from "./export-utils";
import { getUncachableGoogleSheetClient } from "./google-sheets";

export function registerExportRoutes(app: Express) {

  // =====================================================================
  // EXCEL ANALYSIS EXPORT
  // GET /api/runs/:runId/export/analysis
  // Sheets: Discrepancy Analysis, Draft Messages, DRI Sheets
  // =====================================================================
  app.get("/api/runs/:runId/export/analysis", async (req, res) => {
    try {
      const { runId } = req.params;
      const data = await getExcelExportData(runId, res);
      if (!data) return;

      const { result, originalHoData, allRowsMap, spFxMap } = data;

      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();

      // =====================================================
      // SHEET 1: Discrepancy Analysis
      // =====================================================
      const discrepancySummary = result.overallSummary.filter((r: any) => r.reason !== "Reconciled").map((row: any) => ({
        "Reason": row.reason,
        "Currency": row.currency,
        "Discrepancy (LC)": row.discrepancyLc,
        "Discrepancy (USD)": row.discrepancyUsd,
        "Count BID": row.countBid,
      }));

      const discrepancyRows = [...result.primaryRows, ...result.secondaryVendorRows].filter((r: any) => r.reason !== "Reconciled");
      const allPrimaryRows = result.primaryRows;
      
      const tidGroups = new Map<string, {
        tid: string; currency: string; discrepancyLc: number; discrepancyUsd: number;
        fulfillmentMethod: string; spNetTotal: number; hoNetTotal: number;
        dates: string[]; bookingIds: Set<string>; driTeam: string; reason: string;
        hoTakeRates: number[]; actualTakeRates: number[]; discrepancyPercents: number[];
        headoutSellingPriceTotal: number; lossLcTotal: number; hasSoldAtLoss: boolean;
      }>();

      for (const row of discrepancyRows) {
        const tid = row.tid || "Unknown";
        const compositeKey = `${row.reason}:${tid}`;
        
        if (!tidGroups.has(compositeKey)) {
          tidGroups.set(compositeKey, {
            tid, currency: row.hoCurrency, discrepancyLc: 0, discrepancyUsd: 0,
            fulfillmentMethod: row.fulfillmentMethod || "Unknown", spNetTotal: 0, hoNetTotal: 0,
            dates: [], bookingIds: new Set(), driTeam: row.driTeam || "Unknown", reason: row.reason,
            hoTakeRates: [], actualTakeRates: [], discrepancyPercents: [],
            headoutSellingPriceTotal: 0, lossLcTotal: 0, hasSoldAtLoss: false,
          });
        }

        const group = tidGroups.get(compositeKey)!;
        group.discrepancyLc += row.differenceLc;
        group.discrepancyUsd += row.differenceUsd;
        group.spNetTotal += row.spNetInHo;
        group.hoNetTotal += row.hoNet;
        if (row.bookingCreationDate) group.dates.push(row.bookingCreationDate);
        group.bookingIds.add(row.bookingId);

        const hsp = row.headoutSellingPrice;
        if (hsp && hsp > 0) {
          group.headoutSellingPriceTotal += hsp;
          const hoTakeRate = (hsp - row.hoNet) / hsp * 100;
          group.hoTakeRates.push(hoTakeRate);
          const actualTakeRate = (hsp - row.spNetInHo) / hsp * 100;
          group.actualTakeRates.push(actualTakeRate);
          if (hsp < row.spNetInHo) {
            group.hasSoldAtLoss = true;
            group.lossLcTotal += hsp - row.spNetInHo;
          }
        }
        if (row.hoNet !== 0) {
          const discPct = ((row.hoNet - row.spNetInHo) / row.hoNet) * 100;
          group.discrepancyPercents.push(discPct);
        }
      }

      const tidAnalysisData = Array.from(tidGroups.values()).map(group => {
        const sortedDates = group.dates.sort();
        const startDate = sortedDates.length > 0 ? sortedDates[0] : "";
        const endDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : "";
        const timesCharged = group.hoNetTotal !== 0
          ? (group.spNetTotal / group.hoNetTotal).toFixed(2) + "x"
          : "N/A";
        const countBidWithDiscrepancy = group.bookingIds.size;
        let countBidsInDuration = countBidWithDiscrepancy;
        if (startDate && endDate) {
          countBidsInDuration = allPrimaryRows.filter((r: any) => 
            r.tid === group.tid && r.bookingCreationDate && 
            r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
          ).length;
        }
        const totalBidsInReport = allPrimaryRows.filter((r: any) => r.tid === group.tid).length;
        const discrepancyCoveragePercent = countBidsInDuration > 0
          ? (countBidWithDiscrepancy / countBidsInDuration * 100).toFixed(2) + "%"
          : "0%";
        const frequency = countBidWithDiscrepancy >= 5 ? "Recurring" : "One-Off";

        let discrepancyPercentRange = "";
        let pattern = "";
        if (group.discrepancyPercents.length > 0) {
          const uniquePercents = Array.from(new Set(group.discrepancyPercents.map(p => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePercents.length === 1) {
            discrepancyPercentRange = minPct.toFixed(2) + "%";
            pattern = "Consistent";
          } else {
            discrepancyPercentRange = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
            pattern = "Scattered";
          }
        }

        const avgHoTakeRate = group.hoTakeRates.length > 0 
          ? (group.hoTakeRates.reduce((a, b) => a + b, 0) / group.hoTakeRates.length).toFixed(2) + "%"
          : "";
        const avgActualTakeRate = group.actualTakeRates.length > 0
          ? (group.actualTakeRates.reduce((a, b) => a + b, 0) / group.actualTakeRates.length).toFixed(2) + "%"
          : "";
        
        const lossUsd = group.hasSoldAtLoss && group.discrepancyLc !== 0
          ? (group.lossLcTotal * group.discrepancyUsd / group.discrepancyLc)
          : "";

        return {
          "Reason": group.reason,
          "TID": group.tid,
          "Currency": group.currency,
          "Discrepancy (LC)": group.discrepancyLc,
          "Discrepancy (USD)": group.discrepancyUsd,
          "Fulfillment Method": group.fulfillmentMethod,
          "Times Charged": timesCharged,
          "Start Date": startDate,
          "End Date": endDate,
          "BID Count": countBidWithDiscrepancy,
          "BIDs in Duration": countBidsInDuration,
          "Total BIDs": totalBidsInReport,
          "Coverage %": discrepancyCoveragePercent,
          "Frequency": frequency,
          "Discrepancy % Range": discrepancyPercentRange,
          "Pattern": pattern,
          "Sold at Loss": group.hasSoldAtLoss ? "Yes" : "No",
          "Loss (LC)": group.hasSoldAtLoss ? group.lossLcTotal : "",
          "Loss (USD)": lossUsd,
          "DRI Team": group.driTeam,
          "HO Take Rate": avgHoTakeRate,
          "Actual Take Rate": avgActualTakeRate,
        };
      });

      tidAnalysisData.sort((a, b) => {
        const aUsd = typeof a["Discrepancy (USD)"] === "number" ? a["Discrepancy (USD)"] : 0;
        const bUsd = typeof b["Discrepancy (USD)"] === "number" ? b["Discrepancy (USD)"] : 0;
        return aUsd - bUsd;
      });

      const tidByReason = new Map<string, typeof tidAnalysisData>();
      for (const row of tidAnalysisData) {
        const reason = row["Reason"];
        if (!tidByReason.has(reason)) {
          tidByReason.set(reason, []);
        }
        tidByReason.get(reason)!.push(row);
      }

      const mtbColumns = [
        "TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment Method", 
        "Times Charged", "Start Date", "End Date", "BID Count", "BIDs in Duration",
        "Total BIDs", "Coverage %", "Frequency", "DRI Team"
      ];
      const npdColumns = [
        "TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "HO Take Rate", 
        "Actual Take Rate", "Start Date", "End Date", "BID Count", "BIDs in Duration",
        "Coverage %", "Discrepancy % Range", "Pattern", "Frequency", "Fulfillment Method",
        "DRI Team", "Sold at Loss", "Loss (LC)", "Loss (USD)"
      ];
      const defaultColumns = [
        "TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment Method",
        "Start Date", "End Date", "BID Count", "Coverage %", "Frequency", "DRI Team"
      ];

      const getColumnsForReason = (reason: string): string[] => {
        if (reason.toLowerCase().includes("multiple") || reason === "MTB") return mtbColumns;
        if (reason.toLowerCase().includes("net price") || reason === "NPD") return npdColumns;
        return defaultColumns;
      };

      const toExcelDate = (dateVal: string | number): number | string => {
        if (typeof dateVal === "number" && dateVal > 25000) {
          return dateVal;
        }
        if (typeof dateVal === "string" && dateVal) {
          const parsed = new Date(dateVal);
          if (!isNaN(parsed.getTime())) {
            return Math.floor((parsed.getTime() / 86400000) + 25569);
          }
        }
        return dateVal;
      };

      const applyTableStyles = (
        sheet: XLSX.WorkSheet,
        startRow: number,
        startCol: number,
        numRows: number,
        numCols: number,
        columns: string[]
      ) => {
        const borderStyle = { style: "thin" as const, color: { rgb: "000000" } };
        const border = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: startRow + r, c: startCol + c });
            if (!sheet[cellRef]) sheet[cellRef] = { v: "", t: "s" };
            
            const existingStyle = sheet[cellRef].s || {};
            sheet[cellRef].s = {
              ...existingStyle,
              border: border,
              alignment: existingStyle.alignment || { vertical: "center" }
            };
            
            if (r === 0) {
              sheet[cellRef].s.font = { ...(sheet[cellRef].s.font || {}), bold: true };
            }
            
            if (c === 0) {
              sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "left" };
            }
            
            if (r > 0 && columns[c]) {
              const colName = columns[c].toLowerCase();
              
              if (colName.includes("discrepancy") && !colName.includes("%") && !colName.includes("range")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].v = formatIndianNumber(sheet[cellRef].v);
                  sheet[cellRef].t = "s";
                  sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "right" };
                }
              }
              if (colName.includes("loss") && !colName.includes("?")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].v = formatIndianNumber(sheet[cellRef].v);
                  sheet[cellRef].t = "s";
                  sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "right" };
                }
              }
              if (colName === "amount" || colName.includes("net") || colName.includes("price")) {
                if (typeof sheet[cellRef].v === "number") {
                  sheet[cellRef].v = formatIndianNumber(sheet[cellRef].v);
                  sheet[cellRef].t = "s";
                  sheet[cellRef].s.alignment = { ...sheet[cellRef].s.alignment, horizontal: "right" };
                }
              }
              
              if (colName === "start date" || colName === "end date") {
                const val = sheet[cellRef].v;
                sheet[cellRef].v = formatDateValue(val);
                sheet[cellRef].t = "s";
              }
            }
          }
        }
      };
      
      const discrepancySheet = XLSX.utils.json_to_sheet([]);
      discrepancySheet["!sheetViews"] = [{ showGridLines: false }];
      
      let currentRow = 0;
      XLSX.utils.sheet_add_aoa(discrepancySheet, [["OVERALL DISCREPANCY SUMMARY"]], { origin: { r: currentRow, c: 0 } });
      
      const summaryHeaderCell = XLSX.utils.encode_cell({ r: currentRow, c: 0 });
      discrepancySheet[summaryHeaderCell].s = { font: { bold: true, sz: 14 } };
      currentRow += 1;
      
      const summaryHeaders = Object.keys(discrepancySummary[0] || {});
      XLSX.utils.sheet_add_aoa(discrepancySheet, [summaryHeaders], { origin: { r: currentRow, c: 0 } });
      const summaryData = discrepancySummary.map((row: any) => summaryHeaders.map(h => row[h as keyof typeof row]));
      XLSX.utils.sheet_add_aoa(discrepancySheet, summaryData, { origin: { r: currentRow + 1, c: 0 } });
      applyTableStyles(discrepancySheet, currentRow, 0, discrepancySummary.length + 1, summaryHeaders.length, summaryHeaders);
      currentRow += discrepancySummary.length + 2;
      
      for (const [reason, rows] of Array.from(tidByReason.entries())) {
        if (rows.length === 0) continue;
        
        XLSX.utils.sheet_add_aoa(discrepancySheet, [[`${reason.toUpperCase()} ANALYSIS`]], { origin: { r: currentRow, c: 0 } });
        const reasonHeaderCell = XLSX.utils.encode_cell({ r: currentRow, c: 0 });
        discrepancySheet[reasonHeaderCell].s = { font: { bold: true, sz: 12 } };
        currentRow += 1;
        
        const columns = getColumnsForReason(reason);
        
        XLSX.utils.sheet_add_aoa(discrepancySheet, [columns], { origin: { r: currentRow, c: 0 } });
        
        const tableData = rows.map((row: Record<string, unknown>) => 
          columns.map(col => {
            const value = row[col];
            if (value === undefined) return "";
            
            if (col === "Start Date" || col === "End Date") {
              return toExcelDate(value as string | number);
            }
            
            return value;
          })
        );
        XLSX.utils.sheet_add_aoa(discrepancySheet, tableData, { origin: { r: currentRow + 1, c: 0 } });
        
        applyTableStyles(discrepancySheet, currentRow, 0, rows.length + 1, columns.length, columns);
        
        currentRow += rows.length + 2;
      }
      
      const maxColCount = Math.max(
        summaryHeaders.length,
        ...Array.from(tidByReason.values()).map(rows => rows.length > 0 ? getColumnsForReason(rows[0]["Reason"] as string).length : 0)
      );
      discrepancySheet["!cols"] = Array(maxColCount).fill(null).map((_: any, i: number) => {
        if (i === 0) return { wch: 15 };
        if (i <= 2) return { wch: 12 };
        return { wch: 18 };
      });
      
      XLSX.utils.book_append_sheet(workbook, discrepancySheet, getUniqueSheetName("Discrepancy Analysis", usedSheetNames));

      // =====================================================
      // SHEET 2: Draft Messages
      // =====================================================
      const firstHoRow = originalHoData[0] as Record<string, unknown> | undefined;
      const billingEntityName = firstHoRow 
        ? String(firstHoRow["billingEntityName"] || firstHoRow["beId"] || firstHoRow["be_id"] || firstHoRow["billing_entity_id"] || "[Billing Entity]")
        : "[Billing Entity]";
      
      type TidSummary = {
        tid: string; discrepancyLc: number; discrepancyUsd: number; currency: string;
        startDate: string; endDate: string; countBidWithDiscrepancy: number;
        countBidsInDuration: number; discrepancyPercent: string; pattern: string;
        frequency: string; fulfillmentMethod: string; timesCharged: string;
        hoTakeRate: string; actualTakeRate: string; soldAtLoss: boolean;
        lossUsd: number; hoNetPerPax: number; spChargedPerPax: number;
      };
      
      const driReasonGroups = new Map<string, TidSummary[]>();
      
      for (const group of Array.from(tidGroups.values())) {
        const key = `${group.driTeam}:${group.reason}`;
        if (!driReasonGroups.has(key)) {
          driReasonGroups.set(key, []);
        }
        
        const sortedDates = group.dates.sort();
        const startDate = sortedDates.length > 0 ? sortedDates[0] : "";
        const endDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : "";
        const countBidWithDiscrepancy = group.bookingIds.size;
        
        let countBidsInDuration = countBidWithDiscrepancy;
        if (startDate && endDate) {
          countBidsInDuration = allPrimaryRows.filter((r: any) => 
            r.tid === group.tid && r.bookingCreationDate && 
            r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
          ).length;
        }
        
        const timesCharged = group.hoNetTotal !== 0
          ? (group.spNetTotal / group.hoNetTotal).toFixed(2) + "x"
          : "N/A";
        
        let discrepancyPercent = "";
        let pattern = "";
        if (group.discrepancyPercents.length > 0) {
          const uniquePercents = Array.from(new Set(group.discrepancyPercents.map((p: number) => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePercents.length === 1) {
            discrepancyPercent = minPct.toFixed(4);
            pattern = "Consistent";
          } else {
            discrepancyPercent = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
            pattern = "Scattered";
          }
        }
        
        const frequency = countBidWithDiscrepancy >= 5 ? "Recurring" : "One-off";
        
        const avgHoTakeRate = group.hoTakeRates.length > 0 
          ? (group.hoTakeRates.reduce((a: number, b: number) => a + b, 0) / group.hoTakeRates.length).toFixed(2) + "%"
          : "N/A";
        const avgActualTakeRate = group.actualTakeRates.length > 0
          ? (group.actualTakeRates.reduce((a: number, b: number) => a + b, 0) / group.actualTakeRates.length).toFixed(2) + "%"
          : "N/A";
        
        const lossUsd = group.hasSoldAtLoss && group.discrepancyLc !== 0
          ? Math.abs(group.lossLcTotal * group.discrepancyUsd / group.discrepancyLc)
          : 0;
        
        const hoNetPerPax = countBidWithDiscrepancy > 0 ? group.hoNetTotal / countBidWithDiscrepancy : 0;
        const spChargedPerPax = countBidWithDiscrepancy > 0 ? group.spNetTotal / countBidWithDiscrepancy : 0;
        
        driReasonGroups.get(key)!.push({
          tid: group.tid,
          discrepancyLc: group.discrepancyLc,
          discrepancyUsd: group.discrepancyUsd,
          currency: group.currency,
          startDate, endDate,
          countBidWithDiscrepancy, countBidsInDuration,
          discrepancyPercent, pattern, frequency,
          fulfillmentMethod: group.fulfillmentMethod,
          timesCharged,
          hoTakeRate: avgHoTakeRate,
          actualTakeRate: avgActualTakeRate,
          soldAtLoss: group.hasSoldAtLoss,
          lossUsd, hoNetPerPax, spChargedPerPax,
        });
      }
      
      const draftRows: (string | number | Date | null)[][] = [];
      const tableRegions: { startRow: number; endRow: number; numCols: number; type: 'header' | 'tid' | 'dri' }[] = [];
      
      const dateToExcelSerial = (dateStr: string): number | string => {
        if (!dateStr) return "";
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return Math.floor((date.getTime() / 86400000) + 25569);
      };
      
      const formatDateForMessage = (dateVal: string | number): string => {
        if (!dateVal && dateVal !== 0) return "";
        
        if (typeof dateVal === "number" || (typeof dateVal === "string" && !isNaN(parseFloat(dateVal)) && parseFloat(dateVal) > 25000)) {
          const serial = typeof dateVal === "number" ? dateVal : parseFloat(dateVal);
          const jsDate = new Date((serial - 25569) * 86400000);
          if (!isNaN(jsDate.getTime())) {
            return jsDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
          }
        }
        
        const date = new Date(String(dateVal));
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        }
        
        return String(dateVal);
      };
      
      const addNpdBlock = (driTeam: string, tids: TidSummary[]) => {
        if (tids.length === 0) return;
        
        const sortedTids = [...tids].sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
        
        const allDates = sortedTids.flatMap(t => [t.startDate, t.endDate]).filter(d => d).sort();
        const overallStart = allDates.length > 0 ? allDates[0] : "";
        const overallEnd = allDates.length > 0 ? allDates[allDates.length - 1] : "";
        const totalDiscrepancyUsd = sortedTids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
        const totalBidCount = sortedTids.reduce((sum, t) => sum + t.countBidWithDiscrepancy, 0);
        const totalBidsInDuration = sortedTids.reduce((sum, t) => sum + t.countBidsInDuration, 0);
        const discCoverage = totalBidsInDuration > 0 
          ? ((totalBidCount / totalBidsInDuration) * 100).toFixed(2) + "%"
          : "N/A";
        
        let message = "";
        if (driTeam === "BizOps" || driTeam === "Biz Ops") {
          message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Total discrepancy: ${totalDiscrepancyUsd.toFixed(2)} USD. Can you please share with RCA what went wrong here?\n\nSummary screenshot is attached; booking-level details are in the Google Sheet.`;
        } else if (driTeam === "Inventory Ops") {
          message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Total discrepancy: ${totalDiscrepancyUsd.toFixed(2)} USD. Since these are API products, can you confirm the price-sync status for the TIDs listed?\n\nSummary screenshot is attached; booking-level details are in the Google Sheet.`;
        } else {
          message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Total discrepancy: ${totalDiscrepancyUsd.toFixed(2)} USD. Can you please investigate and provide an RCA?\n\nSummary screenshot is attached; booking-level details are in the Google Sheet.`;
        }
        
        const driHeaderRow = draftRows.length;
        draftRows.push(["DRI team", "Slack draft"]);
        tableRegions.push({ startRow: driHeaderRow, endRow: driHeaderRow, numCols: 2, type: 'dri' });
        
        draftRows.push([driTeam, message]);
        tableRegions.push({ startRow: driHeaderRow + 1, endRow: driHeaderRow + 1, numCols: 2, type: 'dri' });
        
        const tidHeaderRow = draftRows.length;
        draftRows.push(["TID", "Discrepancy USD", "Start Date", "End date", "Count of BID with discrepancy", "Count BIDs in duration", "Discrepancy %", "Pattern", "Frequency", "Fulfillment method"]);
        
        for (const t of sortedTids) {
          draftRows.push([
            t.tid, t.discrepancyUsd, dateToExcelSerial(t.startDate),
            dateToExcelSerial(t.endDate), t.countBidWithDiscrepancy,
            t.countBidsInDuration, t.discrepancyPercent, t.pattern,
            t.frequency, t.fulfillmentMethod
          ]);
        }
        tableRegions.push({ startRow: tidHeaderRow, endRow: draftRows.length - 1, numCols: 10, type: 'tid' });
        
        draftRows.push([]);
      };
      
      const addMtbBlock = (driTeam: string, tids: TidSummary[]) => {
        if (tids.length === 0) return;
        
        const sortedTids = [...tids].sort((a, b) => a.discrepancyUsd - b.discrepancyUsd);
        
        const allDates = sortedTids.flatMap(t => [t.startDate, t.endDate]).filter(d => d).sort();
        const overallStart = allDates.length > 0 ? allDates[0] : "";
        const overallEnd = allDates.length > 0 ? allDates[allDates.length - 1] : "";
        const totalDiscrepancyUsd = sortedTids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
        const tidList = sortedTids.map(t => t.tid).join(", ");
        const totalBidCount = sortedTids.reduce((sum, t) => sum + t.countBidWithDiscrepancy, 0);
        const totalBidsInDuration = sortedTids.reduce((sum, t) => sum + t.countBidsInDuration, 0);
        const discCoverage = totalBidsInDuration > 0 
          ? ((totalBidCount / totalBidsInDuration) * 100).toFixed(2) + "%"
          : "N/A";
        
        let message = "";
        if (driTeam === "Tech" || driTeam === "Tech (BAR)") {
          message = `Hey @bar, we have observed multiple tickets booked for products on API. The TIDs involved here are ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). The booking level data has been attached below. Can you check the issue and share RCA and fix for this?`;
        } else if (driTeam === "Reservation Ops") {
          message = `Hey Reservation Ops - We have observed multiple tickets booked for TIDs ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please confirm what went wrong here?`;
        } else if (driTeam === "Selenium") {
          message = `Hey Selenium Team - We have observed multiple tickets booked for TIDs ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please investigate?`;
        } else if (driTeam === "Inventory Ops") {
          message = `Hey Inventory Ops - We have observed multiple tickets booked for TIDs ${tidList} (Pre Purchase). The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please check the inventory allocation?`;
        } else {
          message = `Hey ${driTeam} - We have observed multiple tickets booked for TIDs ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancyUsd.toFixed(2)}. Period - ${formatDateForMessage(overallStart)} to ${formatDateForMessage(overallEnd)}. Bookings impacted- ${totalBidCount}/${totalBidsInDuration} (${discCoverage}). Can you please investigate?`;
        }
        
        const driHeaderRow = draftRows.length;
        draftRows.push(["DRI team", "Slack draft"]);
        tableRegions.push({ startRow: driHeaderRow, endRow: driHeaderRow, numCols: 2, type: 'dri' });
        
        draftRows.push([driTeam, message]);
        tableRegions.push({ startRow: driHeaderRow + 1, endRow: driHeaderRow + 1, numCols: 2, type: 'dri' });
        
        const tidHeaderRow = draftRows.length;
        draftRows.push(["TID", "Discrepancy USD", "Start Date", "End date", "Count of BID with discrepancy", "Count BIDs in duration", "Times charged", "Fulfillment method"]);
        
        for (const t of sortedTids) {
          draftRows.push([
            t.tid, t.discrepancyUsd, dateToExcelSerial(t.startDate),
            dateToExcelSerial(t.endDate), t.countBidWithDiscrepancy,
            t.countBidsInDuration, t.timesCharged, t.fulfillmentMethod
          ]);
        }
        tableRegions.push({ startRow: tidHeaderRow, endRow: draftRows.length - 1, numCols: 8, type: 'tid' });
        
        draftRows.push([]);
      };
      
      const mtbKeys = Array.from(driReasonGroups.keys()).filter(k => k.endsWith(":Multiple Tickets Booked"));
      const hasMtb = mtbKeys.length > 0;
      
      if (hasMtb) {
        const sectionHeaderRow = draftRows.length;
        draftRows.push(["Draft messages - Multiple Tickets Booked"]);
        tableRegions.push({ startRow: sectionHeaderRow, endRow: sectionHeaderRow, numCols: 1, type: 'header' });
        
        const techMtbTids = driReasonGroups.get("Tech:Multiple Tickets Booked") || [];
        if (techMtbTids.length > 0) {
          const subHeaderRow = draftRows.length;
          draftRows.push(["Draft messages - Tech (MTB)"]);
          tableRegions.push({ startRow: subHeaderRow, endRow: subHeaderRow, numCols: 1, type: 'header' });
          addMtbBlock("Tech (BAR)", techMtbTids);
        }
        
        for (const dri of ["Reservation Ops", "Selenium", "Inventory Ops"]) {
          const tids = driReasonGroups.get(`${dri}:Multiple Tickets Booked`) || [];
          addMtbBlock(dri, tids);
        }
        
        const handledMtbTeams = new Set(["Tech", "Reservation Ops", "Selenium", "Inventory Ops"]);
        for (const key of mtbKeys) {
          const dri = key.replace(":Multiple Tickets Booked", "");
          if (!handledMtbTeams.has(dri)) {
            const tids = driReasonGroups.get(key) || [];
            addMtbBlock(dri, tids);
          }
        }
      }
      
      const npdKeys = Array.from(driReasonGroups.keys()).filter(k => k.endsWith(":Net Price Discrepancy"));
      const hasNpd = npdKeys.length > 0;
      
      if (hasNpd) {
        const sectionHeaderRow = draftRows.length;
        draftRows.push(["Draft messages - Net Price Discrepancy"]);
        tableRegions.push({ startRow: sectionHeaderRow, endRow: sectionHeaderRow, numCols: 1, type: 'header' });
        
        const bizOpsNpdTids = driReasonGroups.get("Biz Ops:Net Price Discrepancy") || [];
        addNpdBlock("BizOps", bizOpsNpdTids);
        
        const inventoryOpsNpdTids = driReasonGroups.get("Inventory Ops:Net Price Discrepancy") || [];
        addNpdBlock("Inventory Ops", inventoryOpsNpdTids);
        
        const seleniumNpdTids = driReasonGroups.get("Selenium:Net Price Discrepancy") || [];
        addNpdBlock("Selenium", seleniumNpdTids);
        
        const techNpdTids = driReasonGroups.get("Tech:Net Price Discrepancy") || [];
        addNpdBlock("Tech", techNpdTids);
        
        const handledNpdTeams = new Set(["Biz Ops", "Inventory Ops", "Selenium", "Tech"]);
        for (const key of npdKeys) {
          const dri = key.replace(":Net Price Discrepancy", "");
          if (!handledNpdTeams.has(dri)) {
            const tids = driReasonGroups.get(key) || [];
            addNpdBlock(dri, tids);
          }
        }
      }
      
      const draftMessagesSheet = XLSX.utils.aoa_to_sheet(draftRows);
      
      const draftBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
      const draftBorder = { top: draftBorderStyle, bottom: draftBorderStyle, left: draftBorderStyle, right: draftBorderStyle };
      
      for (const region of tableRegions) {
        for (let r = region.startRow; r <= region.endRow; r++) {
          for (let c = 0; c < region.numCols; c++) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (!draftMessagesSheet[cellRef]) draftMessagesSheet[cellRef] = { v: "", t: "s" };
            
            const existingStyle = draftMessagesSheet[cellRef].s || {};
            draftMessagesSheet[cellRef].s = {
              ...existingStyle,
              border: draftBorder,
              alignment: existingStyle.alignment || {}
            };
            
            if (region.type === 'header' || (region.type === 'tid' && r === region.startRow) || (region.type === 'dri' && r === region.startRow)) {
              draftMessagesSheet[cellRef].s.font = { ...(draftMessagesSheet[cellRef].s.font || {}), bold: true };
            }
            
            if (region.type === 'tid' && c === 1 && r > region.startRow) {
              if (typeof draftMessagesSheet[cellRef].v === "number") {
                draftMessagesSheet[cellRef].v = formatIndianNumber(draftMessagesSheet[cellRef].v);
                draftMessagesSheet[cellRef].t = "s";
                draftMessagesSheet[cellRef].s.alignment = { ...(draftMessagesSheet[cellRef].s.alignment || {}), horizontal: "right" };
              }
            }
            
            if (region.type === 'tid' && (c === 2 || c === 3) && r > region.startRow) {
              const val = draftMessagesSheet[cellRef].v;
              draftMessagesSheet[cellRef].v = formatDateValue(val);
              draftMessagesSheet[cellRef].t = "s";
            }
          }
        }
      }
      
      draftMessagesSheet["!sheetViews"] = [{ showGridLines: false }];
      
      draftMessagesSheet["!cols"] = [
        { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, 
        { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 18 }
      ];
      
      const range = XLSX.utils.decode_range(draftMessagesSheet["!ref"] || "A1");
      for (let r = 0; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 1 });
        if (draftMessagesSheet[cellRef]) {
          draftMessagesSheet[cellRef].s = draftMessagesSheet[cellRef].s || {};
          draftMessagesSheet[cellRef].s.alignment = { 
            ...draftMessagesSheet[cellRef].s.alignment,
            wrapText: true, 
            vertical: "top" 
          };
        }
      }
      XLSX.utils.book_append_sheet(workbook, draftMessagesSheet, getUniqueSheetName("Draft Messages", usedSheetNames));

      // =====================================================
      // DRI TEAM TABS
      // =====================================================
      const driReasonRowGroups = new Map<string, typeof discrepancyRows>();
      for (const row of discrepancyRows) {
        const key = `${row.driTeam || "Unknown"}_${row.reason}`;
        if (!driReasonRowGroups.has(key)) {
          driReasonRowGroups.set(key, []);
        }
        driReasonRowGroups.get(key)!.push(row);
      }
      
      const hoDataLookup = new Map<string, Record<string, unknown>>();
      for (const hoRow of originalHoData as Record<string, unknown>[]) {
        const bookingId = String(hoRow["bookingId"] || hoRow["Booking ID"] || hoRow["booking_id"] || "");
        if (bookingId) {
          hoDataLookup.set(bookingId, hoRow);
        }
      }
      
      const getHoValue = (hoRow: Record<string, unknown> | undefined, ...aliases: string[]): unknown => {
        if (!hoRow) return "";
        for (const alias of aliases) {
          if (hoRow[alias] !== undefined && hoRow[alias] !== null) {
            return hoRow[alias];
          }
        }
        return "";
      };
      
      for (const [key, rows] of Array.from(driReasonRowGroups.entries())) {
        const [driTeam, reason] = key.split("_");
        
        const sheetData = rows.map((row: typeof discrepancyRows[0]) => {
          const hoRow = hoDataLookup.get(row.bookingId);
          
          const hoSp = row.headoutSellingPrice || 0;
          const hoTakeRate = hoSp > 0 ? ((hoSp - row.hoNet) / hoSp * 100).toFixed(2) + "%" : "";
          const actualTakeRate = hoSp > 0 ? ((hoSp - row.spNetInHo) / hoSp * 100).toFixed(2) + "%" : "";
          
          let comments = "";
          if (row.reason === "Multiple Tickets Booked") {
            comments = "MTB";
          } else if (row.reason === "Net Price Discrepancy") {
            comments = "NPD";
          }
          
          return {
            "Booking ID": row.bookingId,
            "Creation Date": row.bookingCreationDate || "",
            "Experience Date": getHoValue(hoRow, "experienceDate", "Experience Date", "experience_date", "tourDate", "Tour Date"),
            "TGID": getHoValue(hoRow, "tgid", "TGID", "tourGroupId", "Tour Group ID"),
            "Experience Name": row.experienceName || "",
            "TID": row.tid || "",
            "VID": getHoValue(hoRow, "vid", "VID", "variantId", "Variant ID", "variant_id"),
            "Currency": row.hoCurrency,
            "Vendor Name": row.supplierName || "",
            "Billing Entity Name": getHoValue(hoRow, "billingEntityName", "beId", "be_id", "billing_entity_id", "Billing Entity"),
            "Booking Status": row.bookingStatus || "",
            "FF Method": row.fulfillmentMethod || "",
            "Payment Method": getHoValue(hoRow, "paymentMethod", "Payment Method", "payment_method"),
            "HO SP": hoSp || "",
            "HO Net": row.hoNet,
            "HO Take Rate": hoTakeRate,
            "SP Net": row.spNetInHo,
            "Actual Take Rate": actualTakeRate,
            "Difference LC": row.differenceLc,
            "Difference %": ((row.differencePct || 0) * 100).toFixed(2) + "%",
            "Difference USD": row.differenceUsd,
            "Comments": comments,
          };
        });
        
        if (sheetData.length === 0) continue;
        
        const driSheet = XLSX.utils.json_to_sheet(sheetData);
        
        const driRange = XLSX.utils.decode_range(driSheet["!ref"] || "A1");
        const driBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
        const driBorder = { top: driBorderStyle, bottom: driBorderStyle, left: driBorderStyle, right: driBorderStyle };
        
        for (let r = 0; r <= driRange.e.r; r++) {
          for (let c = 0; c <= driRange.e.c; c++) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (!driSheet[cellRef]) continue;
            
            const existingStyle = driSheet[cellRef].s || {};
            driSheet[cellRef].s = {
              ...existingStyle,
              border: driBorder
            };
            
            if (r === 0) {
              driSheet[cellRef].s.font = { ...(driSheet[cellRef].s.font || {}), bold: true };
            }
            
            if (r > 0 && (c === 1 || c === 2)) {
              const val = driSheet[cellRef].v;
              if (val) {
                driSheet[cellRef].v = formatDateValue(val);
                driSheet[cellRef].t = "s";
              }
            }
            
            const numericCols = [13, 14, 16, 18, 20];
            if (r > 0 && numericCols.includes(c)) {
              if (typeof driSheet[cellRef].v === "number") {
                driSheet[cellRef].v = formatIndianNumber(driSheet[cellRef].v);
                driSheet[cellRef].t = "s";
                driSheet[cellRef].s.alignment = { ...(driSheet[cellRef].s.alignment || {}), horizontal: "right" };
              }
            }
          }
        }
        
        driSheet["!cols"] = [
          { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 },
          { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 20 },
          { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
          { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
          { wch: 12 }, { wch: 15 },
        ];
        
        driSheet["!sheetViews"] = [{ showGridLines: false }];
        
        const shortReason = reason === "Multiple Tickets Booked" ? "MTB" : reason === "Net Price Discrepancy" ? "NPD" : reason.substring(0, 10);
        const rawSheetName = `${driTeam.substring(0, 20)}_${shortReason}`;
        const sheetName = getUniqueSheetName(rawSheetName, usedSheetNames);
        
        XLSX.utils.book_append_sheet(workbook, driSheet, sheetName);
      }

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      const filename = `discrepancy_analysis_${runId.substring(0, 8)}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error("Export analysis error:", error);
      res.status(500).json({ error: "Failed to export analysis results" });
    }
  });

  // =====================================================================
  // EXCEL FINANCIAL EXPORT
  // GET /api/runs/:runId/export/financial
  // Sheets: Payable Summary, SP Invoice Report, HO Report Updated
  // =====================================================================
  app.get("/api/runs/:runId/export/financial", async (req, res) => {
    try {
      const { runId } = req.params;
      const data = await getExcelExportData(runId, res);
      if (!data) return;

      const { result, upload, originalHoData, originalSpData, allRowsMap, spFxMap, disputesByBooking, disputeOverrides, priceOverrides, vendorCorrectionsByBooking, spTicketIdByBooking } = data;

      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();

      // =====================================================
      // SHEET 1: Payable Summary
      // =====================================================
      const spTotalByCurrency = new Map<string, number>();
      for (const r of result.spFxDebugRows) {
        const ccy = r.spCurrency;
        spTotalByCurrency.set(ccy, (spTotalByCurrency.get(ccy) || 0) + r.spNetOriginal);
      }
      
      const hoTotalByCurrency = new Map<string, number>();
      for (const r of result.primaryRows) {
        const ccy = r.hoCurrency;
        hoTotalByCurrency.set(ccy, (hoTotalByCurrency.get(ccy) || 0) + r.hoNet);
      }
      
      const payableSummaryData: { Description: string; Currency: string; Amount: number; Note: string }[] = [];
      
      Array.from(spTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push({
          "Description": "Payable as per SP",
          "Currency": ccy,
          "Amount": amount,
          "Note": "Sum of SP Invoice",
        });
      });
      
      Array.from(hoTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push({
          "Description": "Payable as per HO",
          "Currency": ccy,
          "Amount": amount,
          "Note": "Sum of HO Net (Primary only)",
        });
      });
      
      const payableSheet = XLSX.utils.json_to_sheet(payableSummaryData);
      payableSheet["!cols"] = [{ wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 30 }];
      payableSheet["!sheetViews"] = [{ showGridLines: false }];
      
      const payableHeaders = ["Description", "Currency", "Amount", "Note"];
      const payableRowCount = payableSummaryData.length + 1;
      const payBorderStyle = { style: "thin", color: { rgb: "000000" } };
      const payBorder = { top: payBorderStyle, bottom: payBorderStyle, left: payBorderStyle, right: payBorderStyle };
      
      for (let r = 0; r < payableRowCount; r++) {
        for (let c = 0; c < payableHeaders.length; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!payableSheet[cellRef]) continue;
          
          payableSheet[cellRef].s = payableSheet[cellRef].s || {};
          payableSheet[cellRef].s.border = payBorder;
          
          if (r === 0) {
            payableSheet[cellRef].s.font = { bold: true };
          }
          
          if (r > 0 && c === 2 && typeof payableSheet[cellRef].v === "number") {
            payableSheet[cellRef].v = formatIndianNumber(payableSheet[cellRef].v);
            payableSheet[cellRef].t = "s";
            payableSheet[cellRef].s.alignment = { horizontal: "right" };
          }
        }
      }
      
      XLSX.utils.book_append_sheet(workbook, payableSheet, getUniqueSheetName("Payable Summary", usedSheetNames));

      // =====================================================
      // SHEET 2: SP Invoice Report
      // =====================================================
      const spReportData = originalSpData.map((row: Record<string, unknown>) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const spFxRow = spFxMap.get(bookingId);
        
        return {
          ...row,
          "SP Net (HO Currency)": spFxRow?.spNetInHo ?? "",
          "FX Rate Used": spFxRow?.fxRateUsed ?? "",
        };
      });
      const spReportSheet = XLSX.utils.json_to_sheet(spReportData);
      spReportSheet["!sheetViews"] = [{ showGridLines: false }];
      
      const spRange = XLSX.utils.decode_range(spReportSheet["!ref"] || "A1");
      const spBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
      const spBorder = { top: spBorderStyle, bottom: spBorderStyle, left: spBorderStyle, right: spBorderStyle };
      
      const spHeaders: string[] = [];
      for (let c = 0; c <= spRange.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c });
        spHeaders.push(spReportSheet[cellRef]?.v?.toString().toLowerCase() || "");
      }
      
      for (let r = 0; r <= spRange.e.r; r++) {
        for (let c = 0; c <= spRange.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!spReportSheet[cellRef]) continue;
          
          const existingStyle = spReportSheet[cellRef].s || {};
          spReportSheet[cellRef].s = {
            ...existingStyle,
            border: spBorder
          };
          
          if (r === 0) {
            spReportSheet[cellRef].s.font = { ...(spReportSheet[cellRef].s.font || {}), bold: true };
          }
          
          if (r > 0 && spHeaders[c]) {
            const col = spHeaders[c];
            if (col.includes("net") || col.includes("amount") || col.includes("price") || col.includes("fx")) {
              if (typeof spReportSheet[cellRef].v === "number") {
                spReportSheet[cellRef].v = formatIndianNumber(spReportSheet[cellRef].v);
                spReportSheet[cellRef].t = "s";
                spReportSheet[cellRef].s.alignment = { ...(spReportSheet[cellRef].s.alignment || {}), horizontal: "right" };
              }
            }
            if (col.includes("date")) {
              spReportSheet[cellRef].v = formatDateValue(spReportSheet[cellRef].v);
              spReportSheet[cellRef].t = "s";
            }
          }
        }
      }
      
      XLSX.utils.book_append_sheet(workbook, spReportSheet, getUniqueSheetName("SP Invoice Report", usedSheetNames));

      // =====================================================
      // SHEET 3: HO Report Updated
      // =====================================================
      const parseDate = (dateValue: string | number | null | undefined): number => {
        if (dateValue === null || dateValue === undefined || dateValue === "") return 0;
        
        if (typeof dateValue === "number" || !isNaN(Number(dateValue))) {
          const numValue = Number(dateValue);
          if (numValue > 40000 && numValue < 60000) {
            const excelEpoch = new Date(1899, 11, 30).getTime();
            const msPerDay = 24 * 60 * 60 * 1000;
            return excelEpoch + numValue * msPerDay;
          }
          if (numValue > 1000000000000) return numValue;
          if (numValue > 1000000000) return numValue * 1000;
        }
        
        const strValue = String(dateValue);
        
        const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/);
        if (dmyMatch) {
          const [, day, month, year, time] = dmyMatch;
          const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${time ? 'T' + time : ''}`;
          const parsed2 = new Date(isoStr);
          if (!isNaN(parsed2.getTime())) {
            return parsed2.getTime();
          }
        }
        
        const parsed = new Date(strValue);
        if (!isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
        
        return 0;
      };
      
      const secondaryRowIndices = new Set<number>();
      const hoRowsByBookingId = new Map<string, { index: number; row: Record<string, unknown>; date: number }[]>();
      
      originalHoData.forEach((row: Record<string, unknown>, index: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        if (!bookingId) return;
        
        const dateValue = row["bookingCreationDate"] || row["Booking Creation Date"] || row["BookingCreationDate"] || "";
        const dateNum = parseDate(dateValue as string | number);
        
        if (!hoRowsByBookingId.has(bookingId)) {
          hoRowsByBookingId.set(bookingId, []);
        }
        hoRowsByBookingId.get(bookingId)!.push({ index, row, date: dateNum });
      });
      
      hoRowsByBookingId.forEach((rows) => {
        if (rows.length <= 1) return;
        
        rows.sort((a, b) => b.date - a.date);
        
        for (let i = 1; i < rows.length; i++) {
          secondaryRowIndices.add(rows[i].index);
        }
      });
      
      const firstRowKeys = upload?.hoData?.headers || (originalHoData.length > 0 ? Object.keys(originalHoData[0] as Record<string, unknown>) : []);
      
      const hoReportData = originalHoData.map((row: Record<string, unknown>, rowIndex: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        
        const reconRows = allRowsMap.get(bookingId) || [];
        const reconRow = reconRows[0];
        
        const isSecondary = secondaryRowIndices.has(rowIndex);
        
        const originalKeys = firstRowKeys;
        const finalNetPriceKey = originalKeys.find((k: string) => {
          const kLower = k.toLowerCase();
          return kLower === "finalnetprice" || kLower === "final net price" || 
                 kLower === "finalnet" || kLower === "final net" || kLower === "final payable" ||
                 kLower === "amountpayable" || kLower === "amount payable" || kLower === "amount_payable";
        }) || "finalNetPrice";
        
        const spNet = reconRow?.spNetInHo ?? "";
        const hoNet = reconRow?.hoNet ?? 0;
        const difference = reconRow ? hoNet - reconRow.spNetInHo : "";
        const differencePercent = reconRow && hoNet !== 0 
          ? ((hoNet - reconRow.spNetInHo) / hoNet * 100).toFixed(2) + "%" 
          : "";
        
        let finalNetPrice: number | string = "";
        let errorTeamAttribution = row["errorTeamAttribution"] || row["Error Team Attribution"] || "";
        let errorBucket = row["errorBucket"] || row["Error Bucket"] || "";
        let comments = row["comments"] || row["Comments"] || "";
        let chargedLoss = reconRow?.chargedLoss || String(row["chargedLoss"] || row["Charged Loss"] || row["charged_loss"] || "FALSE");
        
        const reason = reconRow?.reason || "Reconciled";
        const fulfillmentMethod = String(reconRow?.fulfillmentMethod || row["fulfillmentMethod"] || row["Fulfillment Method"] || "");
        const priceSync = String(row["priceSync"] || row["Price Sync"] || row["PriceSync"] || "");
        
        const reconComment = reconRow?.comment || "";
        
        const finalVendorIdValue = vendorCorrectionsByBooking.get(bookingId) || "";
        
        const ticketIdValue = spTicketIdByBooking.get(bookingId) || "";
        
        const dispute = disputesByBooking.get(bookingId);
        const override = disputeOverrides[bookingId];
        
        const disputeAdjAmount = override?.disputeAdj ?? "";
        const discrepancyAdjAmount = override?.discrepancyAdj ?? "";
        const disputedAmount = override?.finalDispute ?? dispute?.disputeAmount ?? reconRow?.disputedAmount ?? "";
        const adjustedInTicketId = override?.ticketId ?? dispute?.adjustedInTicketId ?? "";
        const closedByAmount = dispute?.closedByAdjustmentAmount ?? 0;
        const disputeStatus = override?.status 
          ?? (dispute 
            ? (dispute.closureStatus === "closed" ? "CLOSED" : "OPEN")
            : (reconRow?.disputeStatus || ""));
        
        const finalDisputeForRecon = dispute 
          ? (dispute.disputeAmount - closedByAmount)
          : null;
        const reconciledNetPrice = dispute && dispute.closureStatus === "closed" && typeof finalDisputeForRecon === "number"
          ? hoNet + finalDisputeForRecon
          : "";
        
        if (isSecondary) {
          finalNetPrice = 0;
          comments = "Duplicate Fulfillment";
        } else if (reason === "Cancelled-SP error") {
          finalNetPrice = spNet;
          chargedLoss = "TRUE";
          comments = reconComment || "Cancelled-SP error";
          errorBucket = "Cancelled-SP error";
          
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          } else if (fulfillmentMethod.toLowerCase().includes("freesale")) {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase().includes("pre") || fulfillmentMethod.toLowerCase().includes("prepurchase")) {
            errorTeamAttribution = "Inventory Ops";
          }
        } else if (reason === "Reconciled") {
          finalNetPrice = spNet;
          if (reconComment && reconComment.startsWith("Cancelled")) {
            comments = reconComment;
            if (reconComment === "Cancelled-Insured Booking" || reconComment === "Cancelled-DSS policy") {
              chargedLoss = "TRUE";
            }
          } else {
            comments = "Reconciled";
          }
        } else if (reason.toLowerCase().includes("multiple") || reason === "MTB") {
          finalNetPrice = spNet;
          errorBucket = "Multiple Tickets Booked";
          comments = "Multiple Tickets Booked";
          
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else if (reason.toLowerCase().includes("price") || reason === "NPD") {
          finalNetPrice = spNet;
          errorBucket = "Price Mismatch";
          
          const varianceComment = hoNet < (reconRow?.spNetInHo || 0) ? "Negative Variance" : "Positive Variance";
          comments = varianceComment;
          
          if ((fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") && 
              priceSync.toLowerCase() === "yes") {
            errorTeamAttribution = "Inventory";
          } else if (fulfillmentMethod.toLowerCase() === "manual" && 
                     (priceSync.toLowerCase() === "no" || priceSync === "")) {
            errorTeamAttribution = "BizOps";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else {
          finalNetPrice = spNet;
        }
        
        const isFinalNetCol = (k: string) => {
          const kLower = k.toLowerCase();
          return kLower === "finalnetprice" || kLower === "final net price" || 
                 kLower === "finalnet" || kLower === "final net" || kLower === "final payable" ||
                 kLower === "amountpayable" || kLower === "amount payable" || kLower === "amount_payable";
        };
        
        const newRow: Record<string, unknown> = {};
        
        let hasErrorTeamCol = false;
        let hasErrorBucketCol = false;
        let hasCommentsCol = false;
        let hasChargedLossCol = false;
        let hasAnyReconCol = false;
        
        const isTotalAmountPayableCol = (k: string) => {
          const kLower = k.toLowerCase().replace(/[\s_]+/g, "");
          return kLower === "totalamountpayable";
        };
        
        const isNetPricePayableCol = (k: string) => {
          const kLower = k.trim().toLowerCase().replace(/[\s_\u00A0]+/g, "");
          return kLower === "netpricepayable" || kLower === "netpayable" || kLower === "netpriceamountpayable";
        };
        
        const priceOverride = priceOverrides[bookingId];
        const totalAmountPayable = priceOverride 
          ? priceOverride.totalAmountPayable 
          : (reason === "Reconciled" ? spNet : finalNetPrice);
        
        const amountPaidValue = reconRow?.amountPaid || 0;
        const netPricePayable = typeof totalAmountPayable === "number"
          ? totalAmountPayable - amountPaidValue
          : totalAmountPayable;
        
        for (const key of originalKeys) {
          const keyLower = key.toLowerCase();
          
          if (isTotalAmountPayableCol(key)) {
            newRow[key] = totalAmountPayable;
          } else if (isNetPricePayableCol(key)) {
            newRow[key] = netPricePayable;
          } else if (isFinalNetCol(key)) {
            newRow[key] = row[key];
          } else if (keyLower === "errorteamattribution" || keyLower === "error team attribution") {
            newRow[key] = errorTeamAttribution;
            hasErrorTeamCol = true;
          } else if (keyLower === "errorbucket" || keyLower === "error bucket") {
            newRow[key] = errorBucket;
            hasErrorBucketCol = true;
          } else if (keyLower === "comments" || keyLower === "comment") {
            newRow[key] = comments;
            hasCommentsCol = true;
          } else if (keyLower === "chargedloss" || keyLower === "charged_loss" || keyLower === "charged loss") {
            newRow[key] = chargedLoss;
            hasChargedLossCol = true;
          } else if (keyLower === "finalvendorid" || keyLower === "final vendor id" || keyLower === "final_vendor_id") {
            newRow[key] = finalVendorIdValue;
            hasAnyReconCol = true;
          } else if (keyLower === "ticketid" || keyLower === "ticket id" || keyLower === "ticket_id") {
            newRow[key] = ticketIdValue;
            hasAnyReconCol = true;
          } else if (keyLower === "disputeadjustment" || keyLower === "dispute adjustment" || keyLower === "dispute_adjustment") {
            newRow[key] = disputeAdjAmount;
            hasAnyReconCol = true;
          } else if (keyLower === "discrepancyamount" || keyLower === "discrepancy amount" || keyLower === "discrepancy_amount") {
            newRow[key] = discrepancyAdjAmount;
            hasAnyReconCol = true;
          } else if (keyLower === "disputedamount" || keyLower === "disputed amount" || keyLower === "disputed_amount") {
            newRow[key] = disputedAmount;
            hasAnyReconCol = true;
          } else if (keyLower === "adjustedinticketid" || keyLower === "adjusted in ticket id" || keyLower === "adjusted_in_ticket_id") {
            newRow[key] = adjustedInTicketId;
            hasAnyReconCol = true;
          } else if (keyLower === "finaldisputeamount" || keyLower === "final dispute amount" || keyLower === "final_dispute_amount") {
            hasAnyReconCol = true;
          } else if (keyLower === "disputestatus" || keyLower === "dispute status" || keyLower === "dispute_status") {
            newRow[key] = disputeStatus;
            hasAnyReconCol = true;
          } else if (keyLower === "reconcilednetprice" || keyLower === "reconciled net price" || keyLower === "reconciled_net_price") {
            newRow[key] = reconciledNetPrice;
            hasAnyReconCol = true;
          } else if (keyLower === "utrnumber" || keyLower === "utr number" || keyLower === "utr_number" || keyLower === "utr") {
            hasAnyReconCol = true;
          } else {
            newRow[key] = row[key];
          }
        }
        
        newRow["SP Net"] = spNet;
        newRow["Difference"] = difference;
        newRow["Difference %"] = differencePercent;
        
        if (!hasErrorTeamCol) {
          newRow["errorTeamAttribution"] = errorTeamAttribution;
        }
        if (!hasErrorBucketCol) {
          newRow["errorBucket"] = errorBucket;
        }
        if (!hasCommentsCol) {
          newRow["comments"] = comments;
        }
        if (!hasChargedLossCol) {
          newRow["chargedLoss"] = chargedLoss;
        }
        
        if (!hasAnyReconCol) {
          newRow["finalVendorId"] = finalVendorIdValue;
          newRow["Ticket ID"] = ticketIdValue;
          newRow["Dispute adjustment"] = disputeAdjAmount;
          newRow["Discrepancy amount"] = discrepancyAdjAmount;
          newRow["Disputed amount"] = disputedAmount;
          newRow["Adjusted in Ticket ID"] = adjustedInTicketId;
          newRow["Dispute status"] = disputeStatus;
          newRow["Reconciled Net price"] = reconciledNetPrice;
        }
        
        return newRow;
      });
      
      const canonicalHeaders: string[] = [...firstRowKeys];
      
      const finalNetAliases = new Set(["finalnetprice", "final net price", "finalnet", "final net", "final payable", "amountpayable", "amount payable", "amount_payable"]);
      const headerExists = (name: string) => {
        const nameLower = name.toLowerCase();
        if (finalNetAliases.has(nameLower)) {
          return canonicalHeaders.some(h => finalNetAliases.has(h.toLowerCase()));
        }
        return canonicalHeaders.some(h => h.toLowerCase() === nameLower);
      };
      
      const appendCols = [
        "SP Net", "Difference", "Difference %",
        "finalNetPrice", "errorTeamAttribution", "errorBucket", "comments", "chargedLoss",
        "finalVendorId", "Ticket ID", "Dispute adjustment", "Discrepancy amount",
        "Disputed amount", "Adjusted in Ticket ID",
        "Dispute status", "Reconciled Net price"
      ];
      for (const col of appendCols) {
        if (!headerExists(col)) {
          canonicalHeaders.push(col);
        }
      }
      
      const hoReportSheet = XLSX.utils.json_to_sheet(hoReportData, { header: canonicalHeaders });
      hoReportSheet["!sheetViews"] = [{ showGridLines: false }];
      
      const hoRange = XLSX.utils.decode_range(hoReportSheet["!ref"] || "A1");
      const hoBorderStyle = { style: "thin" as const, color: { rgb: "000000" } };
      const hoBorder = { top: hoBorderStyle, bottom: hoBorderStyle, left: hoBorderStyle, right: hoBorderStyle };
      
      const hoHeaders: string[] = [];
      for (let c = 0; c <= hoRange.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c });
        hoHeaders.push(hoReportSheet[cellRef]?.v?.toString().toLowerCase() || "");
      }
      
      for (let r = 0; r <= hoRange.e.r; r++) {
        for (let c = 0; c <= hoRange.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!hoReportSheet[cellRef]) continue;
          
          const existingStyle = hoReportSheet[cellRef].s || {};
          hoReportSheet[cellRef].s = {
            ...existingStyle,
            border: hoBorder
          };
          
          if (r === 0) {
            hoReportSheet[cellRef].s.font = { ...(hoReportSheet[cellRef].s.font || {}), bold: true };
          }
          
          if (r > 0 && hoHeaders[c]) {
            const col = hoHeaders[c];
            if (col.includes("net") || col.includes("amount") || col.includes("price") || 
                col.includes("difference") || col.includes("sp net") || col.includes("ho net")) {
              if (!col.includes("%")) {
                if (typeof hoReportSheet[cellRef].v === "number") {
                  hoReportSheet[cellRef].v = formatIndianNumber(hoReportSheet[cellRef].v);
                  hoReportSheet[cellRef].t = "s";
                  hoReportSheet[cellRef].s.alignment = { ...(hoReportSheet[cellRef].s.alignment || {}), horizontal: "right" };
                }
              }
            }
            if (col.includes("date")) {
              hoReportSheet[cellRef].v = formatDateValue(hoReportSheet[cellRef].v);
              hoReportSheet[cellRef].t = "s";
            }
          }
        }
      }
      
      XLSX.utils.book_append_sheet(workbook, hoReportSheet, getUniqueSheetName("HO Report Updated", usedSheetNames));

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      const filename = `reconciliation_report_${runId.substring(0, 8)}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error("Export financial error:", error);
      res.status(500).json({ error: "Failed to export financial results" });
    }
  });

  // =====================================================================
  // GOOGLE SHEETS ANALYSIS EXPORT
  // POST /api/runs/:runId/export-gsheet/analysis
  // Sheets: Discrepancy Analysis, Draft Messages, DRI Sheets
  // =====================================================================
  app.post("/api/runs/:runId/export-gsheet/analysis", async (req, res) => {
    try {
      const { runId } = req.params;
      const exportData = await getExportData(runId, res);
      if (!exportData) return;

      const { result, originalHoData, allRowsMap } = exportData;

      const sheets = await getUncachableGoogleSheetClient();
      if (!sheets) {
        return res.status(500).json({ error: "Google Sheets API not configured. Please set up integration." });
      }

      const discrepancyRows = [...result.primaryRows, ...result.secondaryVendorRows].filter((r: any) => r.reason !== "Reconciled");
      const allPrimaryRows = result.primaryRows;

      const driReasonRowGroups = new Map<string, typeof discrepancyRows>();
      for (const row of discrepancyRows) {
        const key = `${row.driTeam || "Unknown"}_${row.reason}`;
        if (!driReasonRowGroups.has(key)) {
          driReasonRowGroups.set(key, []);
        }
        driReasonRowGroups.get(key)!.push(row);
      }

      const discrepancySummary = [...result.overallSummary, ...result.secondaryVendorSummary].filter((r: any) => r.reason !== "Reconciled");

      const tidGroups = new Map<string, {
        tid: string; currency: string; discrepancyLc: number; discrepancyUsd: number;
        fulfillmentMethod: string; spNetTotal: number; hoNetTotal: number;
        dates: string[]; bookingIds: Set<string>; driTeam: string; reason: string;
        hoTakeRates: number[]; actualTakeRates: number[]; discrepancyPercents: number[];
        hasSoldAtLoss: boolean; lossLcTotal: number;
      }>();

      for (const row of discrepancyRows) {
        const tid = row.tid || "Unknown";
        const compositeKey = `${row.reason}:${tid}`;
        if (!tidGroups.has(compositeKey)) {
          tidGroups.set(compositeKey, {
            tid, currency: row.hoCurrency, discrepancyLc: 0, discrepancyUsd: 0,
            fulfillmentMethod: row.fulfillmentMethod || "Unknown", spNetTotal: 0, hoNetTotal: 0,
            dates: [], bookingIds: new Set(), driTeam: row.driTeam || "Unknown", reason: row.reason,
            hoTakeRates: [], actualTakeRates: [], discrepancyPercents: [],
            hasSoldAtLoss: false, lossLcTotal: 0,
          });
        }
        const group = tidGroups.get(compositeKey)!;
        group.discrepancyLc += row.differenceLc;
        group.discrepancyUsd += row.differenceUsd;
        group.spNetTotal += row.spNetInHo;
        group.hoNetTotal += row.hoNet;
        if (row.bookingCreationDate) group.dates.push(row.bookingCreationDate);
        group.bookingIds.add(row.bookingId);
        const hsp = row.headoutSellingPrice;
        if (hsp && hsp > 0) {
          group.hoTakeRates.push((hsp - row.hoNet) / hsp * 100);
          group.actualTakeRates.push((hsp - row.spNetInHo) / hsp * 100);
          if ((hsp - row.spNetInHo) / hsp < 0) {
            group.hasSoldAtLoss = true;
            group.lossLcTotal += row.differenceLc;
          }
        }
        if (row.hoNet !== 0) {
          group.discrepancyPercents.push(((row.hoNet - row.spNetInHo) / row.hoNet) * 100);
        }
      }
      
      const totalBidsInReport = allPrimaryRows.length;

      const discrepancyData: (string | number)[][] = [
        ["OVERALL DISCREPANCY SUMMARY"],
        ["Reason", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Count BID"],
      ];
      discrepancySummary.forEach((row: any) => {
        discrepancyData.push([
          row.reason, row.currency, 
          formatIndianNumber(row.discrepancyLc), 
          formatIndianNumber(row.discrepancyUsd), 
          row.countBid
        ]);
      });
      discrepancyData.push([]);

      const tidByReason = new Map<string, any[]>();
      for (const [, group] of Array.from(tidGroups.entries())) {
        if (!tidByReason.has(group.reason)) tidByReason.set(group.reason, []);
        tidByReason.get(group.reason)!.push(group);
      }
      
      for (const [, groupList] of Array.from(tidByReason.entries())) {
        groupList.sort((a: any, b: any) => a.discrepancyUsd - b.discrepancyUsd);
      }

      for (const [reason, groups] of Array.from(tidByReason.entries())) {
        discrepancyData.push([`${reason.toUpperCase()} ANALYSIS`]);
        
        const isMtb = reason.toLowerCase().includes("multiple") || reason === "MTB";
        const isNpd = reason.toLowerCase().includes("price") || reason === "NPD";
        
        if (isMtb) {
          discrepancyData.push(["TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment", "Times Charged", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Total BIDs", "Coverage %", "Frequency", "DRI Team"]);
        } else if (isNpd) {
          discrepancyData.push(["TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "HO Take Rate", "Actual Take Rate", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Coverage %", "Discrepancy % Range", "Pattern", "Frequency", "Fulfillment", "DRI Team", "Sold at Loss", "Loss (LC)", "Loss (USD)"]);
        } else {
          discrepancyData.push(["TID", "Currency", "Discrepancy (LC)", "Discrepancy (USD)", "Fulfillment", "Start Date", "End Date", "BID Count", "Total BIDs", "Coverage %", "Frequency", "DRI Team"]);
        }
        
        for (const g of groups) {
          const sortedDates = g.dates.sort();
          const startDate = sortedDates[0] || "";
          const endDate = sortedDates[sortedDates.length - 1] || "";
          const timesCharged = g.hoNetTotal !== 0 ? (g.spNetTotal / g.hoNetTotal).toFixed(2) + "x" : "N/A";
          const frequency = g.bookingIds.size >= 5 ? "Recurring" : "One-Off";
          const bidCount = g.bookingIds.size;
          
          let bidsInDuration = bidCount;
          if (startDate && endDate) {
            bidsInDuration = allPrimaryRows.filter((r: any) =>
              r.tid === g.tid && r.bookingCreationDate &&
              r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
            ).length;
          }
          const coveragePct = bidsInDuration > 0 ? ((bidCount / bidsInDuration) * 100).toFixed(2) + "%" : "N/A";
          
          const avgHoTakeRate = g.hoTakeRates.length > 0
            ? (g.hoTakeRates.reduce((a: number, b: number) => a + b, 0) / g.hoTakeRates.length).toFixed(2) + "%"
            : "N/A";
          const avgActualTakeRate = g.actualTakeRates.length > 0
            ? (g.actualTakeRates.reduce((a: number, b: number) => a + b, 0) / g.actualTakeRates.length).toFixed(2) + "%"
            : "N/A";
          
          let discPctRange = "";
          let pattern = "";
          if (g.discrepancyPercents.length > 0) {
            const uniquePcts = Array.from(new Set(g.discrepancyPercents.map((p: number) => Math.round(p * 100) / 100)));
            const minPct = Math.min(...g.discrepancyPercents);
            const maxPct = Math.max(...g.discrepancyPercents);
            if (uniquePcts.length === 1) {
              discPctRange = minPct.toFixed(2) + "%";
              pattern = "Consistent";
            } else {
              discPctRange = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
              pattern = "Scattered";
            }
          }
          
          const lossUsd = g.hasSoldAtLoss && g.discrepancyLc !== 0
            ? Math.abs(g.lossLcTotal * g.discrepancyUsd / g.discrepancyLc)
            : 0;
          
          const formattedDiscLc = formatIndianNumber(g.discrepancyLc);
          const formattedDiscUsd = formatIndianNumber(g.discrepancyUsd);
          const formattedStartDate = formatDateValue(startDate);
          const formattedEndDate = formatDateValue(endDate);
          const formattedLossLc = g.hasSoldAtLoss ? formatIndianNumber(g.lossLcTotal) : "";
          const formattedLossUsd = g.hasSoldAtLoss ? formatIndianNumber(lossUsd) : "";
          
          if (isMtb) {
            discrepancyData.push([
              g.tid, g.currency, formattedDiscLc, formattedDiscUsd, g.fulfillmentMethod,
              timesCharged, formattedStartDate, formattedEndDate, bidCount, bidsInDuration, totalBidsInReport, coveragePct, frequency, g.driTeam
            ]);
          } else if (isNpd) {
            discrepancyData.push([
              g.tid, g.currency, formattedDiscLc, formattedDiscUsd, avgHoTakeRate, avgActualTakeRate,
              formattedStartDate, formattedEndDate, bidCount, bidsInDuration, coveragePct, discPctRange, pattern, frequency, g.fulfillmentMethod, g.driTeam,
              g.hasSoldAtLoss ? "Yes" : "No", formattedLossLc, formattedLossUsd
            ]);
          } else {
            discrepancyData.push([
              g.tid, g.currency, formattedDiscLc, formattedDiscUsd, g.fulfillmentMethod,
              formattedStartDate, formattedEndDate, bidCount, totalBidsInReport, coveragePct, frequency, g.driTeam
            ]);
          }
        }
        discrepancyData.push([]);
      }

      // Draft Messages data
      const firstHoRow = originalHoData[0] as Record<string, unknown> | undefined;
      const billingEntityName = firstHoRow 
        ? String(firstHoRow["billingEntityName"] || firstHoRow["beId"] || "[Billing Entity]")
        : "[Billing Entity]";

      const draftMessagesData: (string | number)[][] = [];
      
      type DraftTidSummary = {
        tid: string; discrepancyUsd: number; discrepancyLc: number; currency: string;
        dates: string[]; bidCount: number; bidsInDuration: number; discPctRange: string;
        pattern: string; frequency: string; fulfillmentMethod: string; timesCharged: string;
        hasSoldAtLoss: boolean; lossLcTotal: number;
      };
      
      const driReasonTids = new Map<string, DraftTidSummary[]>();
      for (const [, group] of Array.from(tidGroups.entries())) {
        const key = `${group.driTeam}:${group.reason}`;
        if (!driReasonTids.has(key)) driReasonTids.set(key, []);
        const sortedDates = group.dates.sort();
        const startDate = sortedDates[0] || "";
        const endDate = sortedDates[sortedDates.length - 1] || "";
        const bidCount = group.bookingIds.size;
        
        let bidsInDuration = bidCount;
        if (startDate && endDate) {
          bidsInDuration = allPrimaryRows.filter((r: any) =>
            r.tid === group.tid && r.bookingCreationDate &&
            r.bookingCreationDate >= startDate && r.bookingCreationDate <= endDate
          ).length;
        }
        
        const timesCharged = group.hoNetTotal !== 0 ? (group.spNetTotal / group.hoNetTotal).toFixed(2) + "x" : "N/A";
        const frequency = bidCount >= 5 ? "Recurring" : "One-Off";
        
        let discPctRange = "";
        let gsPattern = "";
        if (group.discrepancyPercents.length > 0) {
          const uniquePcts = Array.from(new Set(group.discrepancyPercents.map((p: number) => Math.round(p * 100) / 100)));
          const minPct = Math.min(...group.discrepancyPercents);
          const maxPct = Math.max(...group.discrepancyPercents);
          if (uniquePcts.length === 1) {
            discPctRange = minPct.toFixed(2) + "%";
            gsPattern = "Consistent";
          } else {
            discPctRange = minPct.toFixed(2) + "% to " + maxPct.toFixed(2) + "%";
            gsPattern = "Scattered";
          }
        }
        
        driReasonTids.get(key)!.push({
          tid: group.tid,
          discrepancyUsd: group.discrepancyUsd,
          discrepancyLc: group.discrepancyLc,
          currency: group.currency,
          dates: sortedDates,
          bidCount, bidsInDuration,
          discPctRange, pattern: gsPattern, frequency,
          fulfillmentMethod: group.fulfillmentMethod,
          timesCharged,
          hasSoldAtLoss: group.hasSoldAtLoss,
          lossLcTotal: group.lossLcTotal,
        });
      }

      const gsMtbKeys = Array.from(driReasonTids.keys()).filter(k => k.endsWith(":Multiple Tickets Booked"));
      if (gsMtbKeys.length > 0) {
        draftMessagesData.push(["Draft messages - Multiple Tickets Booked"]);
        draftMessagesData.push([]);
        
        for (const key of gsMtbKeys) {
          const [driTeam] = key.split(":");
          const tids = driReasonTids.get(key) || [];
          if (tids.length === 0) continue;
          
          const allDates = tids.flatMap(t => t.dates).filter(d => d).sort();
          const overallStart = allDates[0] || "";
          const overallEnd = allDates[allDates.length - 1] || "";
          const totalDiscrepancy = tids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
          const totalBidCount = tids.reduce((sum, t) => sum + t.bidCount, 0);
          const totalBidsInDuration = tids.reduce((sum, t) => sum + t.bidsInDuration, 0);
          const coveragePct = totalBidsInDuration > 0 ? ((totalBidCount / totalBidsInDuration) * 100).toFixed(2) + "%" : "N/A";
          const tidList = tids.map(t => t.tid).join(", ");

          let message = "";
          if (driTeam === "Tech" || driTeam === "Tech (BAR)") {
            message = `Hey @bar, we have observed multiple tickets booked for products on API. The TIDs involved here are ${tidList}. The amount of discrepancy in USD is ${totalDiscrepancy.toFixed(2)}. Period - ${overallStart} to ${overallEnd}. Bookings impacted - ${totalBidCount}/${totalBidsInDuration} (${coveragePct}).`;
          } else if (driTeam === "Reservation Ops") {
            message = `Hey Reservation Ops - We have observed multiple tickets booked for TIDs ${tidList}. Discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Period: ${overallStart} to ${overallEnd}. Bookings: ${totalBidCount}/${totalBidsInDuration} (${coveragePct}).`;
          } else {
            message = `Hey ${driTeam} - Multiple tickets booked for TIDs ${tidList}. Discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Period: ${overallStart} to ${overallEnd}. Bookings: ${totalBidCount}/${totalBidsInDuration} (${coveragePct}).`;
          }

          draftMessagesData.push([`Draft messages - ${driTeam} (MTB)`]);
          draftMessagesData.push(["DRI Team", "Slack Draft"]);
          draftMessagesData.push([driTeam, message]);
          
          draftMessagesData.push(["TID", "Discrepancy USD", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Times Charged", "Fulfillment"]);
          for (const t of tids.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd)) {
            const startDate = formatDateValue(t.dates[0] || "");
            const endDate = formatDateValue(t.dates[t.dates.length - 1] || "");
            draftMessagesData.push([t.tid, formatIndianNumber(t.discrepancyUsd), startDate, endDate, t.bidCount, t.bidsInDuration, t.timesCharged, t.fulfillmentMethod]);
          }
          draftMessagesData.push([]);
        }
      }

      const gsNpdKeys = Array.from(driReasonTids.keys()).filter(k => k.endsWith(":Net Price Discrepancy"));
      if (gsNpdKeys.length > 0) {
        draftMessagesData.push(["Draft messages - Net Price Discrepancy"]);
        draftMessagesData.push([]);
        
        for (const key of gsNpdKeys) {
          const [driTeam] = key.split(":");
          const tids = driReasonTids.get(key) || [];
          if (tids.length === 0) continue;
          
          const allDates = tids.flatMap(t => t.dates).filter(d => d).sort();
          const overallStart = allDates[0] || "";
          const overallEnd = allDates[allDates.length - 1] || "";
          const totalDiscrepancy = tids.reduce((sum, t) => sum + t.discrepancyUsd, 0);
          const totalBidCount = tids.reduce((sum, t) => sum + t.bidCount, 0);

          let message = "";
          if (driTeam === "BizOps" || driTeam === "Biz Ops") {
            message = `Please review the attached sheet for price discrepancies for ${billingEntityName} during ${overallStart} to ${overallEnd}. Total discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Can you please share with RCA what went wrong here?`;
          } else if (driTeam === "Inventory Ops") {
            message = `Please review price discrepancies for ${billingEntityName} during ${overallStart} to ${overallEnd}. Total discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Since these are API products, can you confirm the price-sync status?`;
          } else {
            message = `Please review price discrepancies for ${billingEntityName} during ${overallStart} to ${overallEnd}. Total discrepancy: $${totalDiscrepancy.toFixed(2)} USD. Please investigate and provide RCA.`;
          }

          draftMessagesData.push([`Draft messages - ${driTeam} (NPD)`]);
          draftMessagesData.push(["DRI Team", "Slack Draft"]);
          draftMessagesData.push([driTeam, message]);
          
          draftMessagesData.push(["TID", "Discrepancy USD", "Start Date", "End Date", "BID Count", "BIDs in Duration", "Discrepancy %", "Pattern", "Frequency", "Fulfillment"]);
          for (const t of tids.sort((a, b) => a.discrepancyUsd - b.discrepancyUsd)) {
            const startDate = formatDateValue(t.dates[0] || "");
            const endDate = formatDateValue(t.dates[t.dates.length - 1] || "");
            draftMessagesData.push([t.tid, formatIndianNumber(t.discrepancyUsd), startDate, endDate, t.bidCount, t.bidsInDuration, t.discPctRange, t.pattern, t.frequency, t.fulfillmentMethod]);
          }
          draftMessagesData.push([]);
        }
      }

      // DRI Sheets
      const hoDataLookup = new Map<string, Record<string, unknown>>();
      for (const hoRow of originalHoData as Record<string, unknown>[]) {
        const bookingId = String(hoRow["bookingId"] || hoRow["Booking ID"] || "");
        if (bookingId) hoDataLookup.set(bookingId, hoRow);
      }

      const getHoValue = (hoRow: Record<string, unknown> | undefined, ...aliases: string[]): unknown => {
        if (!hoRow) return "";
        for (const alias of aliases) {
          if (hoRow[alias] !== undefined && hoRow[alias] !== null) return hoRow[alias];
        }
        return "";
      };

      const usedSheetNames = new Set<string>(["Discrepancy Analysis", "Draft Messages"]);
      const driSheetNames: string[] = [];
      for (const key of Array.from(driReasonRowGroups.keys())) {
        const [driTeam, reason] = key.split("_");
        const shortReason = reason === "Multiple Tickets Booked" ? "MTB" : reason === "Net Price Discrepancy" ? "NPD" : reason.substring(0, 10);
        const rawName = `${driTeam.substring(0, 20)}_${shortReason}`;
        const sheetName = getUniqueSheetName(rawName, usedSheetNames);
        driSheetNames.push(sheetName);
      }

      const driSheetDataList: { sheetName: string; data: (string | number | null)[][] }[] = [];
      let sheetIndex = 0;
      for (const [key, rows] of Array.from(driReasonRowGroups.entries())) {
        const sheetName = driSheetNames[sheetIndex++];
        const [, reason] = key.split("_");
        
        let defaultComment = "";
        if (reason === "Multiple Tickets Booked") defaultComment = "MTB";
        else if (reason === "Net Price Discrepancy") defaultComment = "NPD";
        
        const sheetData: (string | number | null)[][] = [
          ["Booking ID", "Creation Date", "Experience Date", "TGID", "Experience Name", "TID", "VID", "Currency", 
           "Vendor Name", "Billing Entity", "Booking Status", "FF Method", "Payment Method", 
           "HO SP", "HO Net", "HO Take Rate", "SP Net", "Actual Take Rate", 
           "Difference LC", "Difference %", "Difference USD", "Comments"],
        ];
        
        const sortedRows = [...rows].sort((a: any, b: any) => a.differenceUsd - b.differenceUsd);
        
        for (const row of sortedRows) {
          const hoRow = hoDataLookup.get(row.bookingId);
          const hoSp = row.headoutSellingPrice || 0;
          const hoTakeRate = hoSp > 0 ? ((hoSp - row.hoNet) / hoSp * 100).toFixed(2) + "%" : "";
          const actualTakeRate = hoSp > 0 ? ((hoSp - row.spNetInHo) / hoSp * 100).toFixed(2) + "%" : "";
          
          const creationDate = formatDateValue(row.bookingCreationDate || "");
          const experienceDate = formatDateValue(getHoValue(hoRow, "experienceDate", "Experience Date", "experience_date", "tourDate") as string);
          
          sheetData.push([
            row.bookingId,
            creationDate,
            experienceDate,
            getHoValue(hoRow, "tgid", "TGID", "tourGroupId") as string || "",
            row.experienceName || "",
            row.tid || "",
            getHoValue(hoRow, "vid", "VID", "variantId", "Variant ID") as string || "",
            row.hoCurrency,
            row.supplierName || "",
            getHoValue(hoRow, "billingEntityName", "beId", "billing_entity_id") as string || "",
            row.bookingStatus || "",
            row.fulfillmentMethod || "",
            getHoValue(hoRow, "paymentMethod", "Payment Method") as string || "",
            hoSp ? formatIndianNumber(hoSp) : "",
            formatIndianNumber(row.hoNet),
            hoTakeRate,
            formatIndianNumber(row.spNetInHo),
            actualTakeRate,
            formatIndianNumber(row.differenceLc),
            row.differencePct !== null ? `${(row.differencePct * 100).toFixed(2)}%` : "",
            formatIndianNumber(row.differenceUsd),
            defaultComment,
          ]);
        }
        
        driSheetDataList.push({ sheetName, data: sheetData });
      }

      // Build sheet definitions
      const sheetDefs: { properties: { title: string } }[] = [
        { properties: { title: "Discrepancy Analysis" } },
        { properties: { title: "Draft Messages" } },
      ];

      for (const name of driSheetNames) {
        sheetDefs.push({ properties: { title: name } });
      }

      const spreadsheetTitle = `Discrepancy Analysis - ${new Date().toISOString().split("T")[0]}`;
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: spreadsheetTitle },
          sheets: sheetDefs,
        },
      });

      const spreadsheetId = createResponse.data.spreadsheetId;
      const spreadsheetUrl = createResponse.data.spreadsheetUrl;

      if (!spreadsheetId) {
        throw new Error("Failed to create spreadsheet");
      }

      const batchData = [
        { range: "Discrepancy Analysis!A1", values: discrepancyData },
        { range: "Draft Messages!A1", values: draftMessagesData },
      ];

      for (const { sheetName, data: driData } of driSheetDataList) {
        batchData.push({ range: `'${sheetName}'!A1`, values: driData });
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: batchData,
        },
      });

      // Get sheet IDs for formatting
      const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetIdMap = new Map<string, number>();
      for (const sheet of spreadsheetInfo.data.sheets || []) {
        const title = sheet.properties?.title;
        const sheetId = sheet.properties?.sheetId;
        if (title && sheetId !== undefined && sheetId !== null) {
          sheetIdMap.set(title, sheetId);
        }
      }

      const formatRequests: any[] = [];
      
      const borderStyle = { style: "SOLID", color: { red: 0.6, green: 0.6, blue: 0.6 } };
      const thinBorder = { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } };

      const addTableHeaderRow = (sheetId: number, rowIdx: number, colCount: number) => {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        });
      };

      const addSectionTitle = (sheetId: number, rowIdx: number, colCount: number) => {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        });
      };

      const addTableBorders = (sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) => {
        formatRequests.push({
          updateBorders: {
            range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
            top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle,
            innerHorizontal: thinBorder, innerVertical: thinBorder,
          },
        });
      };

      const addDataAlignment = (sheetId: number, dataStartRow: number, endRow: number, colCount: number) => {
        if (colCount > 1 && endRow > dataStartRow) {
          formatRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: dataStartRow, endRowIndex: endRow, startColumnIndex: 1, endColumnIndex: colCount },
              cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
              fields: "userEnteredFormat.horizontalAlignment",
            },
          });
        }
      };

      const hideGridlines = (sheetId: number) => {
        formatRequests.push({
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { hideGridlines: true } },
            fields: "gridProperties.hideGridlines",
          },
        });
      };

      const addSheetFormatting = (sheetId: number, rowCount: number, colCount: number, headerRowIndices: number[] = [0], _dataHeaders?: (string | number)[]) => {
        for (const rowIdx of headerRowIndices) {
          addTableHeaderRow(sheetId, rowIdx, colCount);
        }
        if (headerRowIndices.includes(0)) {
          formatRequests.push({
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          });
        }
        addTableBorders(sheetId, 0, rowCount, 0, colCount);
        const dataStart = (headerRowIndices[headerRowIndices.length - 1] || 0) + 1;
        addDataAlignment(sheetId, dataStart, rowCount, colCount);
        formatRequests.push({
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: colCount },
          },
        });
        hideGridlines(sheetId);
      };

      // Discrepancy Analysis formatting
      const discSheetId = sheetIdMap.get("Discrepancy Analysis");
      if (discSheetId !== undefined) {
        type TableInfo = { sectionHeaderRow: number; tableHeaderRow: number; lastDataRow: number; colCount: number; headers: (string | number)[]; };
        const tables: TableInfo[] = [];
        
        for (let idx = 0; idx < discrepancyData.length; idx++) {
          const row = discrepancyData[idx];
          const firstCell = String(row[0] || "");
          const isSectionHeader = row.length === 1 && (firstCell.includes("SUMMARY") || firstCell.includes("ANALYSIS"));
          
          if (isSectionHeader) {
            let tableHeaderRow = -1;
            const scanLimit = Math.min(idx + 5, discrepancyData.length);
            for (let k = idx + 1; k < scanLimit; k++) {
              const candidateRow = discrepancyData[k];
              const candidateFirstCell = String(candidateRow[0] || "");
              if (candidateRow.length > 1 && (candidateFirstCell === "Reason" || candidateFirstCell === "TID")) {
                tableHeaderRow = k;
                break;
              }
              const isAnotherSection = candidateRow.length === 1 && (candidateFirstCell.includes("SUMMARY") || candidateFirstCell.includes("ANALYSIS"));
              if (isAnotherSection) break;
            }
            
            if (tableHeaderRow >= 0) {
              const headerRow = discrepancyData[tableHeaderRow];
              let lastDataRow = tableHeaderRow;
              let colCount = headerRow.length;
              for (let j = tableHeaderRow + 1; j < discrepancyData.length; j++) {
                const dataRow = discrepancyData[j];
                const dataFirstCell = String(dataRow[0] || "");
                const isEmptyRow = dataRow.length === 0 || (dataRow.length === 1 && !dataFirstCell);
                const isNextSection = dataRow.length === 1 && (dataFirstCell.includes("SUMMARY") || dataFirstCell.includes("ANALYSIS"));
                if (isEmptyRow || isNextSection) break;
                lastDataRow = j;
                colCount = Math.max(colCount, dataRow.length);
              }
              tables.push({ sectionHeaderRow: idx, tableHeaderRow, lastDataRow, colCount, headers: headerRow });
            }
          }
        }
        
        hideGridlines(discSheetId);
        
        for (const table of tables) {
          addSectionTitle(discSheetId, table.sectionHeaderRow, table.colCount);
          addTableHeaderRow(discSheetId, table.tableHeaderRow, table.colCount);
          addTableBorders(discSheetId, table.tableHeaderRow, table.lastDataRow + 1, 0, table.colCount);
          addDataAlignment(discSheetId, table.tableHeaderRow + 1, table.lastDataRow + 1, table.colCount);
          formatRequests.push({
            autoResizeDimensions: {
              dimensions: { sheetId: discSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: table.colCount },
            },
          });
        }
      }

      // Draft Messages formatting
      const draftSheetId = sheetIdMap.get("Draft Messages");
      if (draftSheetId !== undefined) {
        type DraftTableInfo = { headerRow: number; lastDataRow: number; colCount: number; headers: (string | number)[]; };
        const draftTables: DraftTableInfo[] = [];
        const sectionHeaders: number[] = [];
        
        for (let idx = 0; idx < draftMessagesData.length; idx++) {
          const row = draftMessagesData[idx];
          const firstCell = String(row[0] || "");
          if (firstCell.startsWith("Draft messages")) {
            sectionHeaders.push(idx);
            continue;
          }
          const isTableHeader = row.length > 1 && (firstCell === "DRI Team" || firstCell === "TID");
          if (isTableHeader) {
            const tableHeaderRow = idx;
            let lastDataRow = tableHeaderRow;
            let colCount = row.length;
            for (let j = tableHeaderRow + 1; j < draftMessagesData.length; j++) {
              const dataRow = draftMessagesData[j];
              const dataFirstCell = String(dataRow[0] || "");
              const isEmptyRow = dataRow.length === 0 || (dataRow.length === 1 && !dataFirstCell);
              const isNextHeader = dataRow.length > 1 && (dataFirstCell === "DRI Team" || dataFirstCell === "TID");
              const isNextSection = dataFirstCell.startsWith("Draft messages");
              if (isEmptyRow || isNextHeader || isNextSection) break;
              lastDataRow = j;
              colCount = Math.max(colCount, dataRow.length);
            }
            draftTables.push({ headerRow: tableHeaderRow, lastDataRow, colCount, headers: row });
          }
        }
        
        let maxCols = 1;
        draftMessagesData.forEach((row: any) => { maxCols = Math.max(maxCols, row.length); });
        
        hideGridlines(draftSheetId);
        
        for (const sectionRow of sectionHeaders) {
          addSectionTitle(draftSheetId, sectionRow, maxCols);
        }
        for (const table of draftTables) {
          addTableHeaderRow(draftSheetId, table.headerRow, table.colCount);
          addTableBorders(draftSheetId, table.headerRow, table.lastDataRow + 1, 0, table.colCount);
          addDataAlignment(draftSheetId, table.headerRow + 1, table.lastDataRow + 1, table.colCount);
          formatRequests.push({
            autoResizeDimensions: {
              dimensions: { sheetId: draftSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: table.colCount },
            },
          });
        }
        formatRequests.push({
          repeatCell: {
            range: { sheetId: draftSheetId, startRowIndex: 0, endRowIndex: draftMessagesData.length, startColumnIndex: 1, endColumnIndex: 2 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          },
        });
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId: draftSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 300 },
            fields: "pixelSize",
          },
        });
      }

      // DRI Views formatting
      for (let i = 0; i < driSheetNames.length; i++) {
        const sheetName = driSheetNames[i];
        const sheetId = sheetIdMap.get(sheetName);
        if (sheetId === undefined) continue;
        
        const driData = driSheetDataList[i]?.data || [];
        const rowCount = driData.length;
        const colCount = driData.length > 0 ? driData[0].length : 22;
        const headers = driData.length > 0 ? driData[0] : [];
        addSheetFormatting(sheetId, rowCount, colCount, [0], headers);
      }
      
      if (formatRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: formatRequests },
        });
      }

      res.json({
        success: true,
        spreadsheetId,
        spreadsheetUrl,
        message: `Exported to Google Sheets: ${spreadsheetTitle}`,
      });
    } catch (error) {
      console.error("Google Sheets analysis export error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to export to Google Sheets";
      res.status(500).json({ error: errorMessage });
    }
  });

  // =====================================================================
  // GOOGLE SHEETS FINANCIAL EXPORT
  // POST /api/runs/:runId/export-gsheet/financial
  // Sheets: Payable Summary, SP Invoice Report, HO Report Updated
  // =====================================================================
  app.post("/api/runs/:runId/export-gsheet/financial", async (req, res) => {
    try {
      const { runId } = req.params;
      const exportData = await getExportData(runId, res);
      if (!exportData) return;

      const { result, originalHoData, originalSpData, allRowsMap, spFxMap, disputesByBooking, disputeOverrides, priceOverrides } = exportData;

      const sheets = await getUncachableGoogleSheetClient();
      if (!sheets) {
        return res.status(500).json({ error: "Google Sheets API not configured. Please set up integration." });
      }

      // Payable Summary
      const spTotalByCurrency = new Map<string, number>();
      for (const r of result.spFxDebugRows) {
        spTotalByCurrency.set(r.spCurrency, (spTotalByCurrency.get(r.spCurrency) || 0) + r.spNetOriginal);
      }
      const hoTotalByCurrency = new Map<string, number>();
      for (const r of result.primaryRows) {
        hoTotalByCurrency.set(r.hoCurrency, (hoTotalByCurrency.get(r.hoCurrency) || 0) + r.hoNet);
      }

      const payableSummaryData: (string | number)[][] = [["Description", "Currency", "Amount", "Note"]];
      Array.from(spTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push(["Payable as per SP", ccy, formatIndianNumber(amount), "Sum of SP Invoice"]);
      });
      Array.from(hoTotalByCurrency.entries()).forEach(([ccy, amount]) => {
        payableSummaryData.push(["Payable as per HO", ccy, formatIndianNumber(amount), "Sum of HO Net (Primary only)"]);
      });

      // SP Invoice Report
      const spReportData: (string | number | null)[][] = [];
      
      const firstSpRow = originalSpData[0] as Record<string, unknown> | undefined;
      const spOriginalHeaders = firstSpRow ? Object.keys(firstSpRow) : [];
      const spAllHeaders = [...spOriginalHeaders, "SP Net (HO Currency)", "FX Rate Used"];
      spReportData.push(spAllHeaders);
      
      for (const row of originalSpData as Record<string, unknown>[]) {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const spFxRow = spFxMap.get(bookingId);
        
        const dataRow: (string | number | null)[] = spOriginalHeaders.map(header => {
          const val = row[header];
          const headerLower = header.toLowerCase();
          
          if ((headerLower.includes("net") || headerLower.includes("amount") || headerLower.includes("price")) && typeof val === "number") {
            return formatIndianNumber(val);
          }
          if (headerLower.includes("date")) {
            return formatDateValue(val as string | number);
          }
          
          return val as string | number | null ?? "";
        });
        
        dataRow.push(spFxRow?.spNetInHo !== undefined ? formatIndianNumber(spFxRow.spNetInHo) : "");
        dataRow.push(spFxRow?.fxRateUsed ?? "");
        
        spReportData.push(dataRow);
      }

      // HO Report Updated
      const gsParseDate = (dateValue: string | number | null | undefined): number => {
        if (dateValue === null || dateValue === undefined || dateValue === "") return 0;
        if (typeof dateValue === "number" || !isNaN(Number(dateValue))) {
          const numValue = Number(dateValue);
          if (numValue > 40000 && numValue < 60000) {
            const excelEpoch = new Date(1899, 11, 30).getTime();
            const msPerDay = 24 * 60 * 60 * 1000;
            return excelEpoch + numValue * msPerDay;
          }
          if (numValue > 1000000000000) return numValue;
          if (numValue > 1000000000) return numValue * 1000;
        }
        const strValue = String(dateValue);
        const dmyMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/);
        if (dmyMatch) {
          const [, day, month, year, time] = dmyMatch;
          const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${time ? 'T' + time : ''}`;
          const parsed2 = new Date(isoStr);
          if (!isNaN(parsed2.getTime())) return parsed2.getTime();
        }
        const parsed = new Date(strValue);
        if (!isNaN(parsed.getTime())) return parsed.getTime();
        return 0;
      };
      
      const gsSecondaryRowIndices = new Set<number>();
      const gsHoRowsByBookingId = new Map<string, { index: number; row: Record<string, unknown>; date: number }[]>();
      
      originalHoData.forEach((row: Record<string, unknown>, index: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        if (!bookingId) return;
        const dateValue = row["bookingCreationDate"] || row["Booking Creation Date"] || row["BookingCreationDate"] || "";
        const dateNum = gsParseDate(dateValue as string | number);
        if (!gsHoRowsByBookingId.has(bookingId)) gsHoRowsByBookingId.set(bookingId, []);
        gsHoRowsByBookingId.get(bookingId)!.push({ index, row, date: dateNum });
      });
      
      gsHoRowsByBookingId.forEach((rows) => {
        if (rows.length <= 1) return;
        rows.sort((a, b) => b.date - a.date);
        for (let i = 1; i < rows.length; i++) {
          gsSecondaryRowIndices.add(rows[i].index);
        }
      });
      
      const gsIsFinalNetCol = (k: string) => {
        const kLower = k.toLowerCase();
        return kLower === "finalnetprice" || kLower === "final net price" || 
               kLower === "finalnet" || kLower === "final net" || kLower === "final payable" ||
               kLower === "amountpayable" || kLower === "amount payable" || kLower === "amount_payable";
      };
      
      const gsOriginalKeys = originalHoData.length > 0 ? Object.keys(originalHoData[0] as Record<string, unknown>) : [];
      
      const gsHeaderRow: string[] = [];
      let gsInsertedNewCols = false;
      for (const key of gsOriginalKeys) {
        if (gsIsFinalNetCol(key) && !gsInsertedNewCols) {
          gsHeaderRow.push("SP Net", "Difference", "Difference %");
          gsInsertedNewCols = true;
        }
        gsHeaderRow.push(key);
      }
      if (!gsInsertedNewCols) {
        gsHeaderRow.push("SP Net", "Difference", "Difference %", "errorTeamAttribution", "errorBucket", "comments", "chargedLoss");
      }
      
      const gsDisputesByBooking = disputesByBooking;
      const gsDisputeOverrides = disputeOverrides;
      const gsPriceOverrides = priceOverrides;
      
      const hoReportData: (string | number | null)[][] = [gsHeaderRow];
      
      originalHoData.forEach((row: Record<string, unknown>, rowIndex: number) => {
        const bookingId = String(row["bookingId"] || row["Booking ID"] || row["booking_id"] || "");
        const reconRows = allRowsMap.get(bookingId) || [];
        const reconRow = reconRows[0];
        const isSecondary = gsSecondaryRowIndices.has(rowIndex);
        
        const spNet = reconRow?.spNetInHo ?? "";
        const hoNet = reconRow?.hoNet ?? 0;
        const difference = reconRow ? hoNet - reconRow.spNetInHo : "";
        const differencePercent = reconRow && hoNet !== 0 
          ? ((hoNet - reconRow.spNetInHo) / hoNet * 100).toFixed(2) + "%" 
          : "";
        
        let finalNetPrice: number | string = "";
        let errorTeamAttribution = row["errorTeamAttribution"] || row["Error Team Attribution"] || "";
        let errorBucket = row["errorBucket"] || row["Error Bucket"] || "";
        let comments = row["comments"] || row["Comments"] || "";
        let chargedLoss = reconRow?.chargedLoss || String(row["chargedLoss"] || row["Charged Loss"] || row["charged_loss"] || "FALSE");
        
        const reason = reconRow?.reason || "Reconciled";
        const fulfillmentMethod = String(reconRow?.fulfillmentMethod || row["fulfillmentMethod"] || row["Fulfillment Method"] || "");
        const priceSync = String(row["priceSync"] || row["Price Sync"] || row["PriceSync"] || "");
        
        const reconComment = reconRow?.comment || "";
        
        const gsDispute = gsDisputesByBooking.get(bookingId);
        const gsOverride = gsDisputeOverrides[bookingId];
        const gsDisputeAdjAmount = gsOverride?.disputeAdj ?? "";
        const gsDiscrepancyAdjAmount = gsOverride?.discrepancyAdj ?? "";
        const gsDisputedAmount = gsOverride?.finalDispute ?? gsDispute?.disputeAmount ?? reconRow?.disputedAmount ?? "";
        const gsAdjustedInTicketId = gsOverride?.ticketId ?? gsDispute?.adjustedInTicketId ?? "";
        const gsDisputeStatus = gsOverride?.status 
          ?? (gsDispute 
            ? (gsDispute.closureStatus === "closed" ? "CLOSED" : "OPEN")
            : (reconRow?.disputeStatus || ""));
        const gsClosedByAmount = gsDispute?.closedByAdjustmentAmount ?? 0;
        const gsFinalDisputeForRecon = gsDispute 
          ? (gsDispute.disputeAmount - gsClosedByAmount)
          : null;
        const gsReconciledNetPrice = gsDispute && gsDispute.closureStatus === "closed" && typeof gsFinalDisputeForRecon === "number"
          ? hoNet + gsFinalDisputeForRecon
          : "";
        
        if (isSecondary) {
          finalNetPrice = 0;
          comments = "Duplicate Fulfillment";
        } else if (reason === "Cancelled-SP error") {
          finalNetPrice = spNet;
          chargedLoss = "TRUE";
          comments = reconComment || "Cancelled-SP error";
          errorBucket = "Cancelled-SP error";
          
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          } else if (fulfillmentMethod.toLowerCase().includes("freesale")) {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase().includes("pre") || fulfillmentMethod.toLowerCase().includes("prepurchase")) {
            errorTeamAttribution = "Inventory Ops";
          }
        } else if (reason === "Reconciled") {
          finalNetPrice = spNet;
          if (reconComment && reconComment.startsWith("Cancelled")) {
            comments = reconComment;
            if (reconComment === "Cancelled-Insured Booking" || reconComment === "Cancelled-DSS policy") {
              chargedLoss = "TRUE";
            }
          } else {
            comments = "Reconciled";
          }
        } else if (reason.toLowerCase().includes("multiple") || reason === "MTB") {
          finalNetPrice = spNet;
          errorBucket = "Multiple Tickets Booked";
          comments = "Multiple Tickets Booked";
          if (fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") {
            errorTeamAttribution = "Tech";
          } else if (fulfillmentMethod.toLowerCase() === "manual") {
            errorTeamAttribution = "Reservation Ops";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else if (reason.toLowerCase().includes("price") || reason === "NPD") {
          finalNetPrice = spNet;
          errorBucket = "Price Mismatch";
          const varianceComment = hoNet < (reconRow?.spNetInHo || 0) ? "Negative Variance" : "Positive Variance";
          comments = varianceComment;
          if ((fulfillmentMethod.toLowerCase().includes("vendor") || fulfillmentMethod.toLowerCase() === "vendor api") && 
              priceSync.toLowerCase() === "yes") {
            errorTeamAttribution = "Inventory";
          } else if (fulfillmentMethod.toLowerCase() === "manual" && 
                     (priceSync.toLowerCase() === "no" || priceSync === "")) {
            errorTeamAttribution = "BizOps";
          } else if (fulfillmentMethod.toLowerCase() === "selenium") {
            errorTeamAttribution = "Selenium";
          }
        } else {
          finalNetPrice = spNet;
        }
        
        const dataRow: (string | number | null)[] = [];
        let insertedNewCols = false;
        
        for (const key of gsOriginalKeys) {
          const keyLower = key.toLowerCase();
          
          if (gsIsFinalNetCol(key) && !insertedNewCols) {
            dataRow.push(typeof spNet === "number" ? formatIndianNumber(spNet) : spNet);
            dataRow.push(typeof difference === "number" ? formatIndianNumber(difference) : difference);
            dataRow.push(differencePercent);
            insertedNewCols = true;
          }
          
          let value: string | number | null = row[key] as string | number | null;
          const keyNorm = keyLower.replace(/[\s_]+/g, "");
          
          if (keyNorm === "totalamountpayable") {
            const gsPriceOverride = gsPriceOverrides[bookingId];
            const gsTotalAmountPayable = gsPriceOverride 
              ? gsPriceOverride.totalAmountPayable 
              : (reason === "Reconciled" ? spNet : finalNetPrice);
            value = typeof gsTotalAmountPayable === "number" ? formatIndianNumber(gsTotalAmountPayable) : gsTotalAmountPayable;
          } else if (keyLower === "errorteamattribution" || keyLower === "error team attribution") {
            value = String(errorTeamAttribution);
          } else if (keyLower === "errorbucket" || keyLower === "error bucket") {
            value = String(errorBucket);
          } else if (keyLower === "comments" || keyLower === "comment") {
            value = String(comments);
          } else if (keyLower === "chargedloss" || keyLower === "charged_loss" || keyLower === "charged loss") {
            value = String(chargedLoss);
          } else if (keyNorm === "disputeadjustment" || keyLower === "dispute adjustment") {
            value = typeof gsDisputeAdjAmount === "number" ? formatIndianNumber(gsDisputeAdjAmount) : gsDisputeAdjAmount;
          } else if (keyNorm === "discrepancyamount" || keyLower === "discrepancy amount") {
            value = typeof gsDiscrepancyAdjAmount === "number" ? formatIndianNumber(gsDiscrepancyAdjAmount) : gsDiscrepancyAdjAmount;
          } else if (keyNorm === "disputedamount" || keyLower === "disputed amount") {
            value = typeof gsDisputedAmount === "number" ? formatIndianNumber(gsDisputedAmount) : gsDisputedAmount;
          } else if (keyNorm === "adjustedinticketid" || keyLower === "adjusted in ticket id") {
            value = String(gsAdjustedInTicketId || "");
          } else if (keyNorm === "disputestatus" || keyLower === "dispute status") {
            value = String(gsDisputeStatus || "");
          } else if (keyNorm === "reconcilednetprice" || keyLower === "reconciled net price") {
            value = typeof gsReconciledNetPrice === "number" ? formatIndianNumber(gsReconciledNetPrice) : gsReconciledNetPrice;
          } else if (keyLower === "honet" || keyLower === "ho net" || keyLower === "ho_net") {
            value = typeof value === "number" ? formatIndianNumber(value) : value;
          } else if (keyLower.includes("date") && value) {
            value = formatDateValue(value);
          }
          
          dataRow.push(value);
        }
        
        if (!insertedNewCols) {
          dataRow.push(typeof spNet === "number" ? formatIndianNumber(spNet) : spNet);
          dataRow.push(typeof difference === "number" ? formatIndianNumber(difference) : difference);
          dataRow.push(differencePercent);
          dataRow.push(String(errorTeamAttribution));
          dataRow.push(String(errorBucket));
          dataRow.push(String(comments));
          dataRow.push(String(chargedLoss));
        }
        
        hoReportData.push(dataRow);
      });

      // Build sheet definitions
      const sheetDefs: { properties: { title: string } }[] = [
        { properties: { title: "Payable Summary" } },
        { properties: { title: "SP Invoice Report" } },
        { properties: { title: "HO Report Updated" } },
      ];

      const spreadsheetTitle = `Reconciliation Report - ${new Date().toISOString().split("T")[0]}`;
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: spreadsheetTitle },
          sheets: sheetDefs,
        },
      });

      const spreadsheetId = createResponse.data.spreadsheetId;
      const spreadsheetUrl = createResponse.data.spreadsheetUrl;

      if (!spreadsheetId) {
        throw new Error("Failed to create spreadsheet");
      }

      const batchData = [
        { range: "Payable Summary!A1", values: payableSummaryData },
        { range: "SP Invoice Report!A1", values: spReportData },
        { range: "HO Report Updated!A1", values: hoReportData },
      ];

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: batchData,
        },
      });

      // Get sheet IDs for formatting
      const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetIdMap = new Map<string, number>();
      for (const sheet of spreadsheetInfo.data.sheets || []) {
        const title = sheet.properties?.title;
        const sheetId = sheet.properties?.sheetId;
        if (title && sheetId !== undefined && sheetId !== null) {
          sheetIdMap.set(title, sheetId);
        }
      }

      const formatRequests: any[] = [];
      
      const borderStyle = { style: "SOLID", color: { red: 0.6, green: 0.6, blue: 0.6 } };
      const thinBorder = { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } };

      const addFinancialSheetFormatting = (sheetId: number, rowCount: number, colCount: number, _dataHeaders?: (string | number | null)[]) => {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        });
        formatRequests.push({
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true } },
            fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
          },
        });
        formatRequests.push({
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: colCount },
            top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle,
            innerHorizontal: thinBorder, innerVertical: thinBorder,
          },
        });
        if (colCount > 1 && rowCount > 1) {
          formatRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 1, endColumnIndex: colCount },
              cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
              fields: "userEnteredFormat.horizontalAlignment",
            },
          });
        }
        formatRequests.push({
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: colCount },
          },
        });
      };

      // Payable Summary
      const payableSheetId = sheetIdMap.get("Payable Summary");
      if (payableSheetId !== undefined) {
        addFinancialSheetFormatting(payableSheetId, payableSummaryData.length, 4, payableSummaryData[0]);
      }

      // SP Invoice Report
      const spSheetId = sheetIdMap.get("SP Invoice Report");
      if (spSheetId !== undefined) {
        const spCols = spReportData.length > 0 && Array.isArray(spReportData[0]) ? spReportData[0].length : 5;
        addFinancialSheetFormatting(spSheetId, spReportData.length, spCols, spReportData[0]);
      }

      // HO Report Updated
      const hoSheetId = sheetIdMap.get("HO Report Updated");
      if (hoSheetId !== undefined) {
        const hoCols = hoReportData.length > 0 && Array.isArray(hoReportData[0]) ? hoReportData[0].length : 11;
        addFinancialSheetFormatting(hoSheetId, hoReportData.length, hoCols, hoReportData[0]);
      }

      if (formatRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: formatRequests },
        });
      }

      res.json({
        success: true,
        spreadsheetId,
        spreadsheetUrl,
        message: `Exported to Google Sheets: ${spreadsheetTitle}`,
      });
    } catch (error) {
      console.error("Google Sheets financial export error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to export to Google Sheets";
      res.status(500).json({ error: errorMessage });
    }
  });
}

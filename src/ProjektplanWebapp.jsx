import React, { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";

/**
 * Projektplan-Webapp – Basiseingaben & Timeline + Burnrate + Meilensteine + Persistenz
 *
 * - Phasenbeschreibungen niemals abgeschnitten (mehrzeilig, dynamische Zeilenhöhe)
 * - Monatszeile zeigt jeden begonnenen Monat vollständig (Ansichtsbereich auf Monatsgrenzen)
 * - Dünne vertikale Linie am Ende jedes Monats
 * - GoLive: schwarzer Stern + Beschriftung „GoLive“ rechts hinter der Phase
 * - Hypercare: automatisch 2 Wochen nach jeder GoLive-relevanten Phase
 * - Linke Spalte mit Phasennamen (exakt links vom Balken) + Trennlinie
 * - Titel als Eingabefeld, Farben pro Phase wählbar, Projektorganisation-Farbe wählbar
 * - Export: als Bild speichern, JSON Import/Export & Autosave (localStorage)
 * - Burnrate-Auswertung: Tag / Woche (KW) / Monat
 */

const palette = {
  orange: "#D95017",
  black: "#000000",
  grayDark: "#87888A",
  gray: "#B5B6B7",
  grayLight: "#E9E9E9",
  accentLight: "#F8E1D7",
  softBlue: "#DBEAFE",
  softBlueBorder: "#60A5FA",
};

const labelColWidth = 260; // Breiter für lange Namen
const minRowHeight = 56;   // Mindesthöhe je Timeline-Zeile
const MIN_MONTH_LABEL_PX = 140; // Mindestens 140px pro Monat für volle Lesbarkeit

// ===== Helpers =====
function toDateValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateValue(d);
}

function subDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - days);
  return toDateValue(d);
}

function diffDaysInclusive(startIso, endIso) {
  const s = new Date(startIso + "T00:00:00");
  const e = new Date(endIso + "T00:00:00");
  const ms = e - s;
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1; // inclusive
}

function firstOfMonth(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(1);
  return toDateValue(d);
}

function lastOfMonth(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + 1, 0); // Tag 0 = letzter Tag des Vormonats
  return toDateValue(d);
}

function nextMonth(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return toDateValue(d);
}

function formatMonthLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  // Voller Monatsname + ausgeschriebene Jahreszahl, deutsch
  return d.toLocaleString('de-DE', { month: 'long', year: 'numeric' });
}

// ISO-Kalenderwoche (Montag als Wochenbeginn)
function getISOWeekParts(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getUTCDay() + 6) % 7; // 0=Montag
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.floor(((thursday - yearStart) / 86400000 + 10) / 7);
  const year = thursday.getUTCFullYear();
  return { week, year };
}

// Alle Tage zwischen zwei Daten
function enumerateDates(startIso, endIso) {
  const res = [];
  let cur = startIso;
  while (new Date(cur + "T00:00:00") <= new Date(endIso + "T00:00:00")) {
    res.push(cur);
    cur = addDays(cur, 1);
  }
  return res;
}

// Farb-Utility: Nur #RGB / #RRGGBB zulassen, sonst Fallback
function sanitizeHexColor(c, fallback) {
  const re = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  return typeof c === "string" && re.test(c) ? c : fallback;
}

// Berechnungs-Helfer (für Selbsttests)
export function computePhaseDays(personDays, persons, daysPerWeekPerPerson) {
  const denom = (Number(persons) || 0) * (Number(daysPerWeekPerPerson) || 0);
  const weeks = denom > 0 ? (Number(personDays) || 0) / denom : 0;
  const days = Math.max(1, Math.ceil(weeks * 7));
  return { weeks, days };
}

export function computeBackwardStart(endIso, durationDays) {
  const d = Math.max(1, Number(durationDays) || 1);
  return subDays(endIso, d - 1);
}

// Gleichmäßige Verteilung von Personentagen auf n Kalendertage
function distributePDUniform(totalPD, nDays) {
  if (nDays <= 0) return 0;
  return (Number(totalPD) || 0) / nDays;
}

// Prozentposition einer Datumsspalte relativ zu einem Intervall (inkl.)
export function leftPctForDate(rangeStart, rangeEnd, dateIso) {
  const clamped = new Date(Math.min(Math.max(new Date(dateIso), new Date(rangeStart)), new Date(rangeEnd)));
  const iso = toDateValue(clamped);
  const total = Math.max(1, diffDaysInclusive(rangeStart, rangeEnd));
  const offset = diffDaysInclusive(rangeStart, iso) - 1; // 0-based
  return (offset / total) * 100;
}

// Prüfen, ob Datum innerhalb Intervall (inkl.)
export function dateWithin(dateIso, startIso, endIso) {
  const d = new Date(dateIso + "T00:00:00");
  return d >= new Date(startIso + "T00:00:00") && d <= new Date(endIso + "T00:00:00");
}

function runSelfTests() {
  try {
    // Test 1–7: Dauerberechnung
    let r = computePhaseDays(10, 1, 5); console.assert(r.weeks === 2 && r.days === 14, "T1");
    r = computePhaseDays(20, 2, 2.5); console.assert(r.weeks === 4 && r.days === 28, "T2");
    r = computePhaseDays(100, 0, 5); console.assert(r.days === 1, "T3");
    r = computePhaseDays(5, 1, 3);   console.assert(r.days === 12, "T4");
    r = computePhaseDays(7.1, 1, 5); console.assert(r.days === 10, "T5");
    r = computePhaseDays(0, 3, 5);   console.assert(r.days === 1, "T6");
    r = computePhaseDays(30, 3, 5);  console.assert(r.days === 14, "T7");

    // Test 8: Farb-Sanitizer
    console.assert(sanitizeHexColor("#fff", "#000") === "#fff", "T8a");
    console.assert(sanitizeHexColor("#F8E1D7", "#000") === "#F8E1D7", "T8b");
    console.assert(sanitizeHexColor("oklch(59% 0.1 23)", "#000") === "#000", "T8c");

    // Test 9–10: Rückwärtsterminierung
    let s = computeBackwardStart("2025-01-10", 10); console.assert(s === "2025-01-01", "T9");
    s = computeBackwardStart("2025-01-10", 1);      console.assert(s === "2025-01-10", "T10");

    // Test 11: Verteilung – Summe bleibt erhalten
    const days = 5; const perDay = distributePDUniform(17, days); const sum = Array.from({ length: days }).reduce((acc) => acc + perDay, 0);
    console.assert(Math.abs(sum - 17) < 1e-9, "T11");

    // Test 12: leftPctForDate Randwerte
    const lp0 = leftPctForDate("2025-01-01", "2025-01-11", "2025-01-01");
    const lp1 = leftPctForDate("2025-01-01", "2025-01-11", "2025-01-11");
    console.assert(Math.abs(lp0 - 0) < 1e-9 && lp1 > 80, "T12");

    // Test 13: dateWithin inklusiv
    console.assert(dateWithin("2025-01-05", "2025-01-01", "2025-01-10"), "T13a");
    console.assert(!dateWithin("2024-12-31", "2025-01-01", "2025-01-10"), "T13b");

    // Test 14: Monatslabel enthält Jahr
    const l = formatMonthLabel("2025-09-01");
    console.assert(typeof l === 'string' && l.includes('2025'), 'T14');

    // Zusatztests
    // T15: enumerateDates inklusiv
    const ed = enumerateDates("2025-01-01", "2025-01-03");
    console.assert(ed.length === 3 && ed[0] === "2025-01-01" && ed[2] === "2025-01-03", "T15");
    // T16: diffDaysInclusive Monatsende
    console.assert(diffDaysInclusive("2025-01-30", "2025-02-02") === 4, "T16");

    console.debug("Projektplan-Webapp: Selbsttests OK");
  } catch (err) {
    console.warn("Projektplan-Webapp: Selbsttests Warnung", err);
  }
}

runSelfTests();

const defaultPhase = (i) => ({
  id: i,
  name: `Phase ${i + 1}`,
  personDays: 10,
  persons: 1,
  daysPerWeekPerPerson: 5,
  goLive: false,
  color: "#D95017",
  endOverride: "", // optionales Ende → rückwärtsterminieren
});

const defaultMilestone = (i) => ({ id: i, name: `Meilenstein ${i + 1}`, date: "" });

// Persistenz
const LS_KEY = "projektplan_state_v1";

function serializeState(state) {
  return JSON.stringify({ version: 1, ...state });
}

function tryParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

export default function ProjektplanWebapp() {
  const today = toDateValue(new Date());

  // State
  const [chartTitle, setChartTitle] = useState("Roadmap");
  const [startDate, setStartDate] = useState(today);
  const [phaseCount, setPhaseCount] = useState(3);
  const [phases, setPhases] = useState(Array.from({ length: 3 }, (_, i) => defaultPhase(i)));
  const [orgColor, setOrgColor] = useState(palette.softBlue);
  const [orgBorderColor, setOrgBorderColor] = useState(palette.softBlueBorder);
  const [hypercareColor, setHypercareColor] = useState(palette.accentLight);
  const [hypercareBorderColor, setHypercareBorderColor] = useState(palette.orange);

  const [aggMode, setAggMode] = useState("day"); // 'day' | 'week' | 'month'

  const [milestoneCount, setMilestoneCount] = useState(0);
  const [milestones, setMilestones] = useState([]); // {id,name,date}

  // Refs
  const timelineRef = useRef(null);
  const fileRef = useRef(null);

  // Load from localStorage on mount
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = tryParse(raw);
    if (!data) return;
    try {
      if (data.chartTitle) setChartTitle(String(data.chartTitle));
      if (data.startDate) setStartDate(String(data.startDate));
      if (Array.isArray(data.phases)) {
        setPhases(data.phases.map((p, i) => ({
          id: i,
          name: String(p.name ?? `Phase ${i + 1}`),
          personDays: Number(p.personDays ?? 0),
          persons: Number(p.persons ?? 0),
          daysPerWeekPerPerson: Number(p.daysPerWeekPerPerson ?? 0),
          goLive: !!p.goLive,
          color: sanitizeHexColor(p.color ?? "#D95017", "#D95017"),
          endOverride: String(p.endOverride ?? ""),
        })));
        setPhaseCount(data.phases.length);
      }
      if (typeof data.aggMode === "string") setAggMode(data.aggMode);
      if (data.orgColor) setOrgColor(sanitizeHexColor(data.orgColor, palette.softBlue));
      if (data.orgBorderColor) setOrgBorderColor(sanitizeHexColor(data.orgBorderColor, palette.softBlueBorder));
      if (data.hypercareColor) setHypercareColor(sanitizeHexColor(data.hypercareColor, palette.accentLight));
      if (data.hypercareBorderColor) setHypercareBorderColor(sanitizeHexColor(data.hypercareBorderColor, palette.orange));
      if (Array.isArray(data.milestones)) {
        setMilestones(data.milestones.map((m, i) => ({ id: i, name: String(m.name ?? `Meilenstein ${i + 1}`), date: String(m.date ?? "") })));
        setMilestoneCount(data.milestones.length);
      }
    } catch (e) { /* noop */ }
  }, []);

  // Auto-save to localStorage
  useEffect(() => {
    const state = {
      chartTitle,
      startDate,
      phaseCount,
      phases,
      orgColor,
      orgBorderColor,
      hypercareColor,
      hypercareBorderColor,
      aggMode,
      milestoneCount,
      milestones,
    };
    localStorage.setItem(LS_KEY, serializeState(state));
  }, [chartTitle, startDate, phaseCount, phases, orgColor, orgBorderColor, hypercareColor, hypercareBorderColor, aggMode, milestoneCount, milestones]);

  // Helpers to sync counts and updates
  const syncPhaseCount = (n) => {
    setPhaseCount(n);
    setPhases((prev) => {
      const arr = [...prev];
      if (n > arr.length) { for (let i = arr.length; i < n; i++) arr.push(defaultPhase(i)); }
      else if (n < arr.length) { arr.length = n; }
      return arr.map((p, i) => ({ ...p, id: i, name: p.name || `Phase ${i + 1}` }));
    });
  };

  const updatePhase = (i, patch) => { setPhases((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p))); };

  const syncMilestoneCount = (n) => {
    setMilestoneCount(n);
    setMilestones((prev) => {
      const arr = [...prev];
      if (n > arr.length) { for (let i = arr.length; i < n; i++) arr.push(defaultMilestone(i)); }
      else if (n < arr.length) { arr.length = n; }
      return arr.map((m, i) => ({ ...m, id: i, name: m.name || `Meilenstein ${i + 1}` }));
    });
  };

  const updateMilestone = (i, patch) => { setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m))); };

  // Compute schedule + Burnrate + Milestones
  const schedule = useMemo(() => {
    let cursor = startDate;
    const items = [];

    const computed = phases.map((p, i) => {
      const { weeks, days } = computePhaseDays(p.personDays, p.persons, p.daysPerWeekPerPerson);

      let start, end;
      if (p.endOverride) { end = p.endOverride; start = computeBackwardStart(end, days); }
      else { start = cursor; end = addDays(start, days - 1); }

      cursor = addDays(end, 1);

      const barColor = sanitizeHexColor(p.color || palette.orange, palette.orange);

      items.push({
        type: "phase",
        label: p.name?.trim() || `Phase ${i + 1}`,
        start, end,
        color: barColor, border: barColor,
        goLive: !!p.goLive,
        data: { weeks, days, persons: Number(p.persons) || 0, pd: Number(p.personDays) || 0, dpp: Number(p.daysPerWeekPerPerson) || 0 },
      });

      if (p.goLive) {
        const hcStart = cursor; const hcEnd = addDays(hcStart, 14 - 1); cursor = addDays(hcEnd, 1);
        items.push({ type: "hypercare", label: `${p.name?.trim() || `Phase ${i + 1}`} – Hypercare (2 Wochen)`, start: hcStart, end: hcEnd, color: sanitizeHexColor(hypercareColor, palette.accentLight), border: sanitizeHexColor(hypercareBorderColor, palette.orange), goLive: false, data: { fixedDays: 14 } });
      }

      return { ...p, weeks, days, start, end };
    });

    // Projektgrenzen inkl. Milestones
    let projStart = startDate; let projEnd = startDate;
    if (items.length) {
      projStart = items.reduce((minIso, it) => (new Date(it.start) < new Date(minIso) ? it.start : minIso), startDate);
      projEnd = items.reduce((maxIso, it) => (new Date(it.end) > new Date(maxIso) ? it.end : maxIso), startDate);
    }
    for (const m of milestones) {
      if (!m?.date) continue; const d = toDateValue(new Date(m.date + "T00:00:00"));
      if (new Date(d) < new Date(projStart)) projStart = d; if (new Date(d) > new Date(projEnd)) projEnd = d;
    }

    // **Ansichtsbereich** auf volle Monate erweitern
    const viewStart = firstOfMonth(projStart);
    const viewEnd = lastOfMonth(projEnd);
    const totalViewDays = Math.max(1, diffDaysInclusive(viewStart, viewEnd));

    // Monate vorberechnen (volle Monate)
    let monthCursor = viewStart; const months = [];
    while (new Date(monthCursor + "T00:00:00") <= new Date(viewEnd + "T00:00:00")) {
      const segStart = monthCursor; const segEnd = lastOfMonth(segStart);
      const offsetDays = diffDaysInclusive(viewStart, segStart) - 1; // 0-based
      const widthDays = diffDaysInclusive(segStart, segEnd);
      months.push({ label: formatMonthLabel(segStart), offsetDays, widthDays, start: segStart, end: segEnd });
      monthCursor = nextMonth(monthCursor);
    }

    // **Skalierung**: Jeder begonnene Monat min. N Pixel breit
    const MIN_MONTH_PX = MIN_MONTH_LABEL_PX;
    let pxPerDay = 0;
    for (const m of months) pxPerDay = Math.max(pxPerDay, MIN_MONTH_PX / m.widthDays);
    pxPerDay = Math.max(pxPerDay, 1); // mind. 1 px/Tag

    const totalWidthPx = Math.ceil(totalViewDays * pxPerDay);

    // Projektorganisation-Zeile vorn anstellen
    const itemsWithOrg = [
      { type: "org", label: "Projektorganisation", start: projStart, end: projEnd, color: sanitizeHexColor(orgColor, palette.softBlue), border: sanitizeHexColor(orgBorderColor, palette.softBlueBorder), goLive: false, data: { continuous: true } },
      ...items,
    ];

    // Position rows relativ zu **viewStart/viewEnd** in PX
    const positioned = itemsWithOrg.map((it) => {
      const offsetDays = diffDaysInclusive(viewStart, it.start) - 1; // 0-based index
      const widthDays = diffDaysInclusive(it.start, it.end);
      const leftPx = Math.max(0, Math.round(offsetDays * pxPerDay));
      const widthPx = Math.max(1, Math.round(widthDays * pxPerDay));
      return { ...it, leftPx, widthPx };
    });

    // Burnrate (weiterhin auf Projektbereich, nicht View)
    const allDates = enumerateDates(projStart, projEnd); const dailyPD = Object.create(null);
    for (const it of items) {
      if (it.type !== "phase") continue; const n = diffDaysInclusive(it.start, it.end); const perDay = distributePDUniform(it.data.pd, n);
      let cur = it.start; for (let k = 0; k < n; k++) { dailyPD[cur] = (dailyPD[cur] || 0) + perDay; cur = addDays(cur, 1); }
    }
    const rows = [];
    if (aggMode === "day") { for (const iso of allDates) rows.push({ label: iso, value: dailyPD[iso] || 0, sortKey: iso }); }
    else if (aggMode === "week") {
      const map = new Map(); for (const iso of allDates) { const { week, year } = getISOWeekParts(iso); const key = `KW ${String(week).padStart(2, "0")}/${year}`; const prev = map.get(key) || { sum: 0, firstIso: iso }; prev.sum += dailyPD[iso] || 0; if (new Date(iso) < new Date(prev.firstIso)) prev.firstIso = iso; map.set(key, prev); }
      for (const [key, v] of map.entries()) rows.push({ label: key, value: v.sum, sortKey: v.firstIso }); rows.sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey));
    } else {
      const map = new Map(); for (const iso of allDates) { const m = iso.slice(0, 7); const prev = map.get(m) || { sum: 0 }; prev.sum += dailyPD[iso] || 0; map.set(m, prev); }
      for (const [m, v] of map.entries()) rows.push({ label: m, value: v.sum, sortKey: m + "-01" }); rows.sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey));
    }

    // Meilensteine pro Phasen-Item ablegen (unter der Phase rendern) – PX-Positionen
    const msByItem = {};
    for (let idx = 0; idx < positioned.length; idx++) {
      const it = positioned[idx]; if (it.type !== "phase") continue;
      for (const m of milestones) {
        if (!m?.date) continue; if (dateWithin(m.date, it.start, it.end)) {
          const offsetDays = diffDaysInclusive(viewStart, m.date) - 1;
          const leftPx = Math.round(offsetDays * pxPerDay);
          (msByItem[idx] ||= []).push({ name: m.name || "Meilenstein", leftPx, date: m.date });
        }
      }
    }

    // Monate mit PX-Positionen
    const monthsPx = months.map((m) => ({
      ...m,
      leftPx: Math.round(m.offsetDays * pxPerDay),
      widthPx: Math.round(m.widthDays * pxPerDay),
      rightPx: Math.round((m.offsetDays + m.widthDays) * pxPerDay),
      label: m.label,
    }));

    return { computed, items: positioned, projStart, projEnd, viewStart, viewEnd, totalViewDays, months: monthsPx, burnRows: rows, msByItem, pxPerDay, totalWidthPx };
  }, [phases, startDate, orgColor, orgBorderColor, hypercareColor, hypercareBorderColor, aggMode, milestones]);

  // Export Bild
  const handleSaveImage = async () => {
    if (!timelineRef.current) return; const node = timelineRef.current;
    const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${(chartTitle || "roadmap").replace(/\s+/g, "_")}.png`; a.click(); URL.revokeObjectURL(url); }, "image/png");
  };

  // Export/Import JSON
  const handleExportJSON = () => {
    const state = { chartTitle, startDate, phaseCount, phases, orgColor, orgBorderColor, hypercareColor, hypercareBorderColor, aggMode, milestoneCount, milestones };
    const blob = new Blob([serializeState(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${(chartTitle || "projektplan").replace(/\s+/g, "_")}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const handleImportJSONClick = () => { fileRef.current?.click(); };
  const handleImportJSONFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader();
    reader.onload = () => {
      const data = tryParse(String(reader.result)); if (!data) return;
      try {
        if (data.chartTitle) setChartTitle(String(data.chartTitle));
        if (data.startDate) setStartDate(String(data.startDate));
        if (Array.isArray(data.phases)) { setPhases(data.phases.map((p, i) => ({ id: i, name: String(p.name ?? `Phase ${i + 1}`), personDays: Number(p.personDays ?? 0), persons: Number(p.persons ?? 0), daysPerWeekPerPerson: Number(p.daysPerWeekPerPerson ?? 0), goLive: !!p.goLive, color: sanitizeHexColor(p.color ?? "#D95017", "#D95017"), endOverride: String(p.endOverride ?? "") }))); setPhaseCount(data.phases.length); }
        if (typeof data.aggMode === "string") setAggMode(data.aggMode);
        if (data.orgColor) setOrgColor(sanitizeHexColor(data.orgColor, palette.softBlue));
        if (data.orgBorderColor) setOrgBorderColor(sanitizeHexColor(data.orgBorderColor, palette.softBlueBorder));
        if (data.hypercareColor) setHypercareColor(sanitizeHexColor(data.hypercareColor, palette.accentLight));
        if (data.hypercareBorderColor) setHypercareBorderColor(sanitizeHexColor(data.hypercareBorderColor, palette.orange));
        if (Array.isArray(data.milestones)) { setMilestones(data.milestones.map((m, i) => ({ id: i, name: String(m.name ?? `Meilenstein ${i + 1}`), date: String(m.date ?? "") }))); setMilestoneCount(data.milestones.length); }
      } catch (e) { /* noop */ }
    };
    reader.readAsText(file);
    // reset input value to allow re-uploading the same file later
    e.target.value = "";
  };

  const fmtNum = (x) => (x || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen w-full bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#E9E9E9] bg-white/90 backdrop-blur px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: palette.orange }}>Roadmap-Konfigurator</h1>
        <div className="flex items-center gap-2">
          <button className="rounded-2xl px-3 h-10 text-white shadow" style={{ backgroundColor: palette.black }} onClick={handleExportJSON}>Daten speichern</button>
          <button className="rounded-2xl px-3 h-10 text-white shadow" style={{ backgroundColor: palette.orange }} onClick={handleImportJSONClick}>Daten laden</button>
          <input type="file" accept="application/json" ref={fileRef} onChange={handleImportJSONFile} className="hidden" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 grid gap-8">
        {/* Config Panel */}
        <section className="rounded-2xl border border-[#E9E9E9] shadow-sm p-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Titel */}
            <label className="lg:col-span-4 flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700">Diagrammtitel</span>
              <input type="text" className="h-10 rounded-xl border px-3 focus:outline-none focus:ring-2" style={{ borderColor: palette.grayLight }} value={chartTitle} onChange={(e) => setChartTitle(e.target.value)} placeholder="Roadmap" />
            </label>

            {/* Starttermin */}
            <label className="lg:col-span-3 flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700">Starttermin</span>
              <input type="date" className="h-10 rounded-xl border px-3 focus:outline-none focus:ring-2" style={{ borderColor: palette.grayLight }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>

            {/* Phasenanzahl */}
            <label className="lg:col-span-2 flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700">Anzahl der Phasen</span>
              <input type="number" min={1} className="h-10 rounded-xl border px-3 focus:outline-none focus:ring-2" style={{ borderColor: palette.grayLight }} value={phaseCount} onChange={(e) => syncPhaseCount(Math.max(1, parseInt(e.target.value || "1", 10)))} />
            </label>

            {/* Farben global */}
            <div className="lg:col-span-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Farbe: Projektorganisation</span>
                <input type="color" value={orgColor} onChange={(e) => setOrgColor(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Rand: Projektorganisation</span>
                <input type="color" value={orgBorderColor} onChange={(e) => setOrgBorderColor(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Farbe: Hypercare</span>
                <input type="color" value={hypercareColor} onChange={(e) => setHypercareColor(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Rand: Hypercare</span>
                <input type="color" value={hypercareBorderColor} onChange={(e) => setHypercareBorderColor(e.target.value)} />
              </label>
            </div>

            {/* Formel + Auswertungsauswahl */}
            <div className="lg:col-span-12 flex items-center gap-3">
              <div className="text-xs text-slate-700 rounded-lg bg-[#F8E1D7] px-3 py-2">Dauer (Wochen) = Personentage / (Personen * Tage/Woche/Person)</div>
              <div className="ml-auto flex items-center gap-2">
                <label className="text-sm text-slate-700">Auswertung:</label>
                <select className="h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={aggMode} onChange={(e) => setAggMode(e.target.value)}>
                  <option value="day">Tag</option>
                  <option value="week">Woche (KW)</option>
                  <option value="month">Monat</option>
                </select>
              </div>
            </div>

            {/* Phasenliste */}
            <div className="lg:col-span-12 mt-2 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b" style={{ borderColor: palette.grayLight }}>
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Phasenname</th>
                    <th className="py-2 pr-2">Farbe</th>
                    <th className="py-2 pr-2">Personentage</th>
                    <th className="py-2 pr-2">Personen</th>
                    <th className="py-2 pr-2">Tage/Woche/Person</th>
                    <th className="py-2 pr-2">GoLive relevant</th>
                    <th className="py-2 pr-2">Dauer (Tage)</th>
                    <th className="py-2 pr-2">Start</th>
                    <th className="py-2 pr-2">Ende (Override)</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.computed.map((comp, i) => (
                    <tr key={i} className="border-b last:border-b-0" style={{ borderColor: palette.grayLight }}>
                      <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
                      <td className="py-2 pr-2"><input type="text" className="w-full h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={phases[i]?.name || ""} onChange={(e) => updatePhase(i, { name: e.target.value })} /></td>
                      <td className="py-2 pr-2"><input type="color" className="h-9 w-14 rounded border" value={phases[i]?.color || "#D95017"} onChange={(e) => updatePhase(i, { color: e.target.value })} title="Phasenfarbe" /></td>
                      <td className="py-2 pr-2"><input type="number" min={0} step={0.5} className="w-28 h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={phases[i]?.personDays} onChange={(e) => updatePhase(i, { personDays: parseFloat(e.target.value || "0") })} /></td>
                      <td className="py-2 pr-2"><input type="number" min={0} step={1} className="w-24 h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={phases[i]?.persons} onChange={(e) => updatePhase(i, { persons: parseInt(e.target.value || "0", 10) })} /></td>
                      <td className="py-2 pr-2"><input type="number" min={0} step={0.5} className="w-32 h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={phases[i]?.daysPerWeekPerPerson} onChange={(e) => updatePhase(i, { daysPerWeekPerPerson: parseFloat(e.target.value || "0") })} /></td>
                      <td className="py-2 pr-2"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={phases[i]?.goLive || false} onChange={(e) => updatePhase(i, { goLive: e.target.checked })} className="h-4 w-4" /><span>GoLive</span></label></td>
                      <td className="py-2 pr-2">{comp.days}</td>
                      <td className="py-2 pr-2">{comp.start}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <input type="date" className="h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={phases[i]?.endOverride || comp.end} onChange={(e) => { const v = e.target.value; if (!v || v === comp.end) updatePhase(i, { endOverride: "" }); else updatePhase(i, { endOverride: v }); }} />
                          <button type="button" className="text-xs underline" onClick={() => updatePhase(i, { endOverride: "" })} title="Override entfernen">Zurücksetzen</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Meilensteine */}
            <div className="lg:col-span-12 mt-6">
              <div className="flex items-center gap-3 mb-2">
                <h4 className="font-medium">Meilensteine</h4>
                <label className="flex items-center gap-2 ml-auto">
                  <span className="text-sm">Anzahl</span>
                  <input type="number" min={0} className="h-9 w-24 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={milestoneCount} onChange={(e) => syncMilestoneCount(Math.max(0, parseInt(e.target.value || "0", 10)))} />
                </label>
              </div>

              {milestoneCount > 0 && (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b" style={{ borderColor: palette.grayLight }}>
                        <th className="py-2 pr-2" style={{ width: 60 }}>#</th>
                        <th className="py-2 pr-2">Name</th>
                        <th className="py-2 pr-2" style={{ width: 220 }}>Datum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: milestoneCount }).map((_, i) => (
                        <tr key={`msr-${i}`} className="border-b last:border-b-0" style={{ borderColor: palette.grayLight }}>
                          <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
                          <td className="py-2 pr-2"><input type="text" className="w-full h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={milestones[i]?.name || `Meilenstein ${i + 1}`} onChange={(e) => updateMilestone(i, { name: e.target.value })} /></td>
                          <td className="py-2 pr-2"><input type="date" className="h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={milestones[i]?.date || ""} onChange={(e) => updateMilestone(i, { date: e.target.value })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Timeline Card (exportierbarer Bereich – nur HEX-Farben) */}
        <section ref={timelineRef} className="rounded-2xl border border-[#E9E9E9] shadow-sm p-5">
          {/* Titel + Aktionen */}
          <div className="flex items-center justify-between mb-3">
            <input type="text" value={chartTitle} onChange={(e) => setChartTitle(e.target.value)} className="text-xl font-semibold bg-transparent focus:outline-none border-b border-transparent" style={{ color: palette.black }} />
            <div className="flex gap-2">
              <button className="rounded-2xl px-4 h-10 text-white shadow" style={{ backgroundColor: palette.black }} onClick={handleSaveImage}>Speichern</button>
            </div>
          </div>

          {/* Scroll-Container für Timeline, damit Monatslabels immer vollständig sichtbar (min. 140px pro Monat) */}
          <div className="w-full rounded-xl border border-[#E9E9E9] overflow-x-auto">
            {/* Month bands (Header) */}
            <div className="relative" style={{ display: "grid", gridTemplateColumns: `${labelColWidth}px ${schedule.totalWidthPx}px` }}>
              <div className="h-[46px]" style={{ borderRight: `1px solid ${palette.grayLight}` }} />
              <div className="relative h-[46px]" style={{ width: `${schedule.totalWidthPx}px` }}>
                {schedule.months.map((m, idx) => (
                  <div
                    key={idx}
                    className="absolute top-0 h-full flex items-center px-2 text-xs"
                    title={`${m.label} (${m.start} – ${m.end})`}
                    style={{
                      left: `${m.leftPx}px`,
                      width: `${m.widthPx}px`,
                      background: idx % 2 === 0 ? "transparent" : palette.grayLight,
                      color: palette.grayDark,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rows Grid (Label links, Balken rechts) */}
            <div className="relative w-full mt-0 overflow-x-auto">
              <div className="relative" style={{ minWidth: (labelColWidth + schedule.months.length * MIN_MONTH_LABEL_PX) + "px" }}>
                {/* Oberer Trennstrich der Balkenfläche */}
                <div className="absolute" style={{ left: labelColWidth, right: 0, top: 0, height: 1, background: palette.grayLight }} />

                {/* Monatsend-Linien über alle Zeilen */}
                <div className="pointer-events-none absolute" style={{ left: labelColWidth, right: 0, top: 0, bottom: 0 }}>
                  {schedule.months.map((m, i) => (
                    <div key={`mline-${i}`} className="absolute" style={{ left: `${labelColWidth + m.rightPx}px`, top: 0, bottom: 0, width: 1, background: palette.black, opacity: 0.9 }} />
                  ))}
                </div>

                <div className="grid" style={{ gridTemplateColumns: `${labelColWidth}px ${schedule.totalWidthPx}px` }}>
                  {schedule.items.map((it, idx) => (
                    <React.Fragment key={`row-${idx}`}>
                      {/* Label-Zelle – mehrzeilig, kein Truncation */}
                      <div className="pr-3 py-2 flex items-center" style={{ borderRight: `1px solid ${palette.grayLight}`, minHeight: minRowHeight }}>
                        <span className="text-sm w-full" style={{ color: palette.black, textAlign: "right", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.25 }} title={it.label}>
                          {it.label}
                        </span>
                      </div>

                      {/* Balken-Zelle */}
                      <div className="relative py-2" style={{ minHeight: minRowHeight, width: `${schedule.totalWidthPx}px` }}>
                        {/* Phasen-/Org-/HC-Balken */}
                        <div className="absolute rounded-xl shadow-sm" title={`${it.label} • ${it.start} – ${it.end}`} style={{
                          top: 10,
                          bottom: it.type === "phase" && (schedule.msByItem[idx]?.length || 0) > 0 ? 28 : 10,
                          left: `${it.leftPx}px`,
                          width: `${Math.max(it.widthPx, 1)}px`,
                          background: sanitizeHexColor(it.color, palette.orange),
                          border: `1px solid ${sanitizeHexColor(it.border, palette.orange)}`,
                        }} />

                        {/* GoLive hinter Phase */}
                        {it.type === "phase" && it.goLive && (
                          <div className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${it.leftPx + it.widthPx + 6}px`, top: 0, color: palette.black }}>
                            <div style={{ fontSize: 14, lineHeight: "12px" }}>★</div>
                            <div style={{ fontSize: 10, marginTop: 2 }}>GoLive</div>
                          </div>
                        )}

                        {/* Meilensteine in dieser Zeile (nur für Phase) */}
                        {it.type === "phase" && (schedule.msByItem[idx]?.length || 0) > 0 && (
                          <div className="absolute left-0 right-0" style={{ bottom: 4 }}>
                            {schedule.msByItem[idx].map((m, j) => (
                              <div key={`ms-${idx}-${j}`} className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${m.leftPx}px`, color: palette.black }}>
                                <div style={{ fontSize: 14, lineHeight: "12px" }}>★</div>
                                <div style={{ fontSize: 10, marginTop: 2, whiteSpace: "nowrap" }}>{m.name}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Legende */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-2"><span className="w-4 h-4 inline-block rounded" style={{ background: palette.orange }} /> Phase</span>
            <span className="inline-flex items-center gap-2"><span className="w-4 h-4 inline-block rounded" style={{ background: sanitizeHexColor(hypercareColor, palette.accentLight), border: `1px solid ${sanitizeHexColor(hypercareBorderColor, palette.orange)}` }} /> Hypercare (2 Wochen)</span>
            <span className="inline-flex items-center gap-2"><span className="w-4 h-4 inline-block rounded" style={{ background: sanitizeHexColor(orgColor, palette.softBlue), border: `1px solid ${sanitizeHexColor(orgBorderColor, palette.softBlueBorder)}` }} /> Projektorganisation (laufend)</span>
            <span className="inline-flex items-center gap-2">★ GoLive</span>
            <span className="inline-flex items-center gap-2">★ Meilenstein</span>
          </div>
        </section>

        {/* ===== Burnrate-Auswertung ===== */}
        <section className="rounded-2xl border border-[#E9E9E9] shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Burnrate-Auswertung</h3>
            <div className="flex items-center gap-2">
              <label className="text-sm">Aggregation:</label>
              <select className="h-9 rounded-lg border px-2" style={{ borderColor: palette.grayLight }} value={aggMode} onChange={(e) => setAggMode(e.target.value)}>
                <option value="day">Tag</option>
                <option value="week">Woche (KW)</option>
                <option value="month">Monat</option>
              </select>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: palette.grayLight }}>
                  <th className="py-2 pr-2" style={{ width: 260 }}>{aggMode === "day" ? "Tag (Datum)" : aggMode === "week" ? "Kalenderwoche" : "Monat"}</th>
                  <th className="py-2 pr-2">Summe Personentage</th>
                </tr>
              </thead>
              <tbody>
                {schedule.burnRows.map((r, i) => (
                  <tr key={`br-${i}`} className="border-b last:border-b-0" style={{ borderColor: palette.grayLight }}>
                    <td className="py-2 pr-2">{r.label}</td>
                    <td className="py-2 pr-2">{fmtNum(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Export/Print */}
        <section className="rounded-2xl border border-[#E9E9E9] shadow-sm p-5 flex items-center justify-between">
          <div className="text-sm text-slate-600">Drucke die Seite oder exportiere als PDF über deinen Browser.</div>
          <div className="flex gap-3">
            <button className="rounded-2xl px-4 h-10 text-white shadow" style={{ backgroundColor: palette.black }} onClick={() => window.print()}>Drucken</button>
            <button className="rounded-2xl px-4 h-10 text-white shadow" style={{ backgroundColor: palette.orange }} onClick={handleSaveImage}>Speichern</button>
          </div>
        </section>

        {/* Footer */}
        <footer className="pb-10 text-xs text-slate-500">© {new Date().getFullYear()} – Projektplaner (Burnrate-basiert)</footer>
      </main>
    </div>
  );
}

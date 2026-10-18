'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  Award,
  Layers,
  Activity,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  ChevronRight,
  X,
  Stethoscope,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  Moon,
  Sun,
  ShieldAlert,
  UserCheck,
  Check,
  RotateCcw,
  Sparkles,
  HelpCircle,
  Tag
} from 'lucide-react';
import { SimtryxSimulation, getScenarioFriendlyName } from '@/lib/simtryx';

const MONTH_NAMES_ES: Record<string, string> = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Setiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
};

function formatMonthLabel(m: string): string {
  if (m === 'ALL') return 'Histórico Consolidado';
  const [year, month] = m.split('-');
  return `${MONTH_NAMES_ES[month] || month} ${year}`;
}

export default function DashboardPage() {
  const [simulations, setSimulations] = useState<SimtryxSimulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Filtros Globales y de Tabla
  const [selectedMonth, setSelectedMonth] = useState('ALL'); // ALL o YYYY-MM
  const [selectedScenario, setSelectedScenario] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL'); // ALL, APPROVED, REVIEW
  const [onlyEffectiveSessions, setOnlyEffectiveSessions] = useState(false); // >= 2 min
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserFilter, setSelectedUserFilter] = useState<string | null>(null);

  // Ordenamiento interactivo de columnas
  const [sortField, setSortField] = useState<'date' | 'duration' | 'score' | 'scenario'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Modales
  const [selectedSim, setSelectedSim] = useState<SimtryxSimulation | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);

  // Tabs: EXPLORER, USERS, ERRORS, SCENARIOS
  const [activeTab, setActiveTab] = useState<'EXPLORER' | 'USERS' | 'ERRORS' | 'SCENARIOS'>('EXPLORER');

  const fetchSimulations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/simulations');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al conectar con Simtryx');
      }
      setSimulations(data.simulations || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSimulations();
  }, []);

  // Helper de duración en segundos
  const getDurationSec = (sim: SimtryxSimulation): number => {
    if (!sim.startTime || !sim.endTime) return 0;
    const s = new Date(sim.startTime).getTime();
    const e = new Date(sim.endTime).getTime();
    return (!isNaN(s) && !isNaN(e) && e >= s) ? Math.floor((e - s) / 1000) : 0;
  };

  // Helper de nota promedio
  const getSimAvgScore = (sim: SimtryxSimulation): number | null => {
    const scores = (sim.results?.users || []).map(u => (u.success || 0) * 100);
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  };

  // Meses disponibles con conteo
  const monthsWithCounts = useMemo(() => {
    const counts: Record<string, { count: number; sec: number }> = {};
    simulations.forEach(s => {
      if (s.startTime && s.startTime.length >= 7) {
        const m = s.startTime.substring(0, 7);
        if (!counts[m]) counts[m] = { count: 0, sec: 0 };
        counts[m].count++;
        counts[m].sec += getDurationSec(s);
      }
    });

    return Object.entries(counts)
      .sort((a, b) => b[0].localeCompare(a[0])) // Más reciente primero
      .map(([m, data]) => ({
        key: m,
        label: formatMonthLabel(m),
        count: data.count,
        hours: Number((data.sec / 3600).toFixed(1)),
      }));
  }, [simulations]);

  // Lista de Escenarios Únicos para píldoras rápidas
  const scenarioOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    simulations.forEach(s => {
      counts[s.sceneryID] = (counts[s.sceneryID] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([id, count]) => ({
        id,
        name: getScenarioFriendlyName(id),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [simulations]);

  // Total histórico fijo para referencias comparativas
  const allTimeStats = useMemo(() => {
    let sec = 0;
    simulations.forEach(s => { sec += getDurationSec(s); });
    return {
      totalSims: simulations.length,
      totalHours: Number((sec / 3600).toFixed(1)),
    };
  }, [simulations]);

  // Simulaciones filtradas por el Período seleccionado (para calcular KPIs dinámicos)
  const periodSimulations = useMemo(() => {
    if (selectedMonth === 'ALL') return simulations;
    return simulations.filter(s => s.startTime && s.startTime.startsWith(selectedMonth));
  }, [simulations, selectedMonth]);

  // --- KPIs REACTIVOS AL PERÍODO SELECCIONADO ---
  const stats = useMemo(() => {
    let totalSec = 0;
    let fullSessions = 0;
    let shortSessions = 0;
    let totalScore = 0;
    let scoreCount = 0;

    const userAgg: Record<string, {
      sessions: number;
      durationSec: number;
      scores: number[];
      scenarios: Set<string>;
      fullSessions: number;
      shortSessions: number;
      passedSessions: number;
      sims: SimtryxSimulation[];
    }> = {};

    const scenarioAgg: Record<string, {
      count: number;
      durationSec: number;
      scores: number[];
      fullSessions: number;
    }> = {};

    const checklistErrors: Record<string, { total: number; completed: number; omitted: number }> = {};
    const debriefingQuestions: Record<string, { total: number; correct: number; incorrect: number }> = {};

    periodSimulations.forEach(s => {
      const dur = getDurationSec(s);
      totalSec += dur;
      if (dur >= 120) fullSessions++;
      else shortSessions++;

      const scName = getScenarioFriendlyName(s.sceneryID);
      if (!scenarioAgg[scName]) {
        scenarioAgg[scName] = { count: 0, durationSec: 0, scores: [], fullSessions: 0 };
      }
      scenarioAgg[scName].count++;
      scenarioAgg[scName].durationSec += dur;
      if (dur >= 120) scenarioAgg[scName].fullSessions++;

      (s.results?.users || []).forEach(u => {
        const uEmail = u.user || 'Sin identificar';
        if (!userAgg[uEmail]) {
          userAgg[uEmail] = {
            sessions: 0,
            durationSec: 0,
            scores: [],
            scenarios: new Set<string>(),
            fullSessions: 0,
            shortSessions: 0,
            passedSessions: 0,
            sims: []
          };
        }
        userAgg[uEmail].sessions++;
        userAgg[uEmail].durationSec += dur;
        userAgg[uEmail].scenarios.add(scName);
        userAgg[uEmail].sims.push(s);

        if (dur >= 120) userAgg[uEmail].fullSessions++;
        else userAgg[uEmail].shortSessions++;

        if (typeof u.success === 'number') {
          const scPct = u.success * 100;
          userAgg[uEmail].scores.push(scPct);
          scenarioAgg[scName].scores.push(scPct);
          totalScore += scPct;
          scoreCount++;
          if (scPct >= 70) userAgg[uEmail].passedSessions++;
        }
      });

      // Checklist Errores
      (s.results?.checklist || []).forEach(chk => {
        (chk.actionsData || []).forEach(cat => {
          (cat.required || []).forEach(req => {
            const key = `${cat.categoryTitle} — ${req.title}`;
            if (!checklistErrors[key]) checklistErrors[key] = { total: 0, completed: 0, omitted: 0 };
            checklistErrors[key].total++;
            if (req.success === 1) checklistErrors[key].completed++;
            else checklistErrors[key].omitted++;
          });
        });
      });

      // Debriefing
      (s.results?.debriefing?.questions || []).forEach(q => {
        if (!debriefingQuestions[q.title]) {
          debriefingQuestions[q.title] = { total: 0, correct: 0, incorrect: 0 };
        }
        (q.userAnswers || []).forEach(ua => {
          debriefingQuestions[q.title].total++;
          if (ua.selectedOption === q.correctOption && ua.selectedOption !== -1) {
            debriefingQuestions[q.title].correct++;
          } else {
            debriefingQuestions[q.title].incorrect++;
          }
        });
      });
    });

    const totalHours = totalSec / 3600;
    const avgMin = periodSimulations.length > 0 ? (totalSec / periodSimulations.length) / 60 : 0;
    const avgGlobalScore = scoreCount > 0 ? totalScore / scoreCount : 0;

    return {
      totalSims: periodSimulations.length,
      totalHours: Number(totalHours.toFixed(1)),
      avgMinSession: Number(avgMin.toFixed(1)),
      fullSessions,
      shortSessions,
      effectivenessRate: periodSimulations.length > 0 ? Number(((fullSessions / periodSimulations.length) * 100).toFixed(1)) : 0,
      uniqueUsers: Object.keys(userAgg).length,
      avgGlobalScore: Number(avgGlobalScore.toFixed(1)),
      userAgg,
      scenarioAgg,
      checklistErrors,
      debriefingQuestions
    };
  }, [periodSimulations]);

  // Filtrado y Ordenamiento final para la tabla
  const filteredAndSortedSimulations = useMemo(() => {
    const list = periodSimulations.filter(sim => {
      const dur = getDurationSec(sim);

      // Filtro de sólo prácticas efectivas
      if (onlyEffectiveSessions && dur < 120) return false;

      // Filtro de Escenario
      if (selectedScenario !== 'ALL' && sim.sceneryID !== selectedScenario) return false;

      // Filtro por Usuario específico (click-to-filter)
      if (selectedUserFilter) {
        const hasUser = (sim.results?.users || []).some(u => u.user === selectedUserFilter);
        if (!hasUser) return false;
      }

      // Filtro de Estado
      const avg = getSimAvgScore(sim);
      if (selectedStatus === 'APPROVED' && (avg === null || avg < 70)) return false;
      if (selectedStatus === 'REVIEW' && (avg === null || avg >= 70)) return false;

      // Búsqueda por texto
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const scName = getScenarioFriendlyName(sim.sceneryID).toLowerCase();
        const usersStr = (sim.results?.users || []).map(u => u.user.toLowerCase()).join(' ');
        const dateStr = (sim.startTime || '').toLowerCase();
        return scName.includes(query) || usersStr.includes(query) || dateStr.includes(query);
      }

      return true;
    });

    // Ordenamiento
    return list.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        const tA = new Date(a.startTime || 0).getTime();
        const tB = new Date(b.startTime || 0).getTime();
        comparison = tA - tB;
      } else if (sortField === 'duration') {
        comparison = getDurationSec(a) - getDurationSec(b);
      } else if (sortField === 'score') {
        const sA = getSimAvgScore(a) ?? -1;
        const sB = getSimAvgScore(b) ?? -1;
        comparison = sA - sB;
      } else if (sortField === 'scenario') {
        comparison = getScenarioFriendlyName(a.sceneryID).localeCompare(getScenarioFriendlyName(b.sceneryID));
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [periodSimulations, onlyEffectiveSessions, selectedScenario, selectedUserFilter, selectedStatus, searchTerm, sortField, sortOrder]);

  // Paginación
  const totalPages = Math.ceil(filteredAndSortedSimulations.length / itemsPerPage);
  const paginatedSimulations = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedSimulations.slice(start, start + itemsPerPage);
  }, [filteredAndSortedSimulations, currentPage, itemsPerPage]);

  // Manejador de orden por columna
  const handleSort = (field: 'date' | 'duration' | 'score' | 'scenario') => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Limpiar todos los filtros secundarios
  const handleResetFilters = () => {
    setSelectedScenario('ALL');
    setSelectedStatus('ALL');
    setOnlyEffectiveSessions(false);
    setSearchTerm('');
    setSelectedUserFilter(null);
    setCurrentPage(1);
  };

  const hasActiveFilters = selectedScenario !== 'ALL' || selectedStatus !== 'ALL' || onlyEffectiveSessions || searchTerm !== '' || selectedUserFilter !== null;

  // Descarga inteligente de Excel
  const handleExportExcel = async (downloadFilteredOnly = false) => {
    setExporting(true);
    try {
      let url = '/api/simulations/export';
      if (downloadFilteredOnly) {
        const params = new URLSearchParams();
        if (selectedMonth !== 'ALL') params.set('month', selectedMonth);
        if (selectedScenario !== 'ALL') params.set('scenario', selectedScenario);
        if (onlyEffectiveSessions) params.set('effectiveOnly', 'true');
        if (selectedStatus !== 'ALL') params.set('status', selectedStatus);
        url += `?${params.toString()}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Error al generar archivo Excel');
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const suffix = downloadFilteredOnly && selectedMonth !== 'ALL' ? `_${selectedMonth}` : '_Consolidado';
      a.download = `Reporte_Simulaciones_UCSUR${suffix}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert('Hubo un error al descargar el reporte: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-200 ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      {/* NAVBAR SUPERIOR */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  UCSUR <span className="text-sky-600 dark:text-sky-400">Simtryx Analytics</span>
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Sync
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Clínica de Simulación — Horas de Uso, Kardex y Auditoría de Seguridad Clínica
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Alternar tema claro/oscuro"
            >
              {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
            </button>

            <button
              onClick={fetchSimulations}
              disabled={loading}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              title="Recargar datos de Simtryx"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-sky-600' : ''}`} />
            </button>

            {/* BOTÓN INTELIGENTE DE EXPORTACIÓN */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleExportExcel(selectedMonth !== 'ALL' || hasActiveFilters)}
                disabled={exporting || simulations.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              >
                <FileSpreadsheet className={`w-5 h-5 ${exporting ? 'animate-bounce' : ''}`} />
                <span className="text-sm font-semibold">
                  {exporting
                    ? 'Generando...'
                    : selectedMonth !== 'ALL'
                    ? `Descargar Excel (${formatMonthLabel(selectedMonth).split(' ')[0]})`
                    : 'Descargar Excel Ejecutivo'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ========================================================= */}
        {/* BARRA SUPERIOR DE CONTROL DE PERÍODO (GLOBAL) */}
        {/* ========================================================= */}
        <div className="bg-gradient-to-r from-sky-900 to-slate-900 text-white rounded-3xl p-5 shadow-lg border border-sky-800/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center text-sky-300">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-sky-300">
                Período Académico Activo
              </div>
              <div className="text-lg font-extrabold flex items-center gap-2">
                <span>{formatMonthLabel(selectedMonth)}</span>
                {selectedMonth !== 'ALL' && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-sky-500/30 text-sky-200 border border-sky-400/30">
                    Filtro Reactivo
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* SELECTOR Y ACCESOS RÁPIDOS */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-sky-200/80 mr-1 hidden sm:inline">Seleccionar:</span>

            {/* Selector Desplegable Completo */}
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold rounded-xl px-3 py-2 outline-none cursor-pointer transition-colors"
            >
              <option value="ALL" className="bg-slate-900 text-white">
                Histórico Consolidado (Todos los Meses)
              </option>
              {monthsWithCounts.map(m => (
                <option key={m.key} value={m.key} className="bg-slate-900 text-white">
                  {m.label} ({m.count} sesiones · {m.hours} hrs)
                </option>
              ))}
            </select>

            {/* Chips Rápidos de los 3 meses más recientes */}
            {monthsWithCounts.slice(0, 3).map(m => (
              <button
                key={m.key}
                onClick={() => {
                  setSelectedMonth(selectedMonth === m.key ? 'ALL' : m.key);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  selectedMonth === m.key
                    ? 'bg-sky-500 text-white shadow-md'
                    : 'bg-white/10 hover:bg-white/20 text-sky-100'
                }`}
              >
                {m.label.split(' ')[0]}
              </button>
            ))}

            {selectedMonth !== 'ALL' && (
              <button
                onClick={() => { setSelectedMonth('ALL'); setCurrentPage(1); }}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 transition-colors flex items-center gap-1"
                title="Volver a ver todo el histórico"
              >
                <X className="w-3.5 h-3.5" />
                <span>Ver Todo</span>
              </button>
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* CARDS DE KPIS DINÁMICOS (CAMBIAN SEGÚN EL MES ELEGIDO) */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* HORAS DE USO */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800/80 shadow-sm relative overflow-hidden group hover:border-sky-500/50 transition-all">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {selectedMonth === 'ALL' ? 'Horas Totales (Histórico)' : `Horas en ${formatMonthLabel(selectedMonth).split(' ')[0]}`}
              </span>
              <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {loading ? '...' : `${stats.totalHours} hrs`}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center justify-between">
              {selectedMonth === 'ALL' ? (
                <span>Promedio: <strong className="text-slate-700 dark:text-slate-300">{stats.avgMinSession} min</strong>/sesión</span>
              ) : (
                <span className="text-sky-600 font-semibold">
                  {((stats.totalHours / allTimeStats.totalHours) * 100).toFixed(1)}% del histórico global
                </span>
              )}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{stats.totalSims} prácticas</span>
            </div>
          </div>

          {/* SESIONES FINALIZADAS VS ABORTADAS */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800/80 shadow-sm relative overflow-hidden group hover:border-emerald-500/50 transition-all">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {selectedMonth === 'ALL' ? 'Sesiones Efectivas' : `Efectivas en ${formatMonthLabel(selectedMonth).split(' ')[0]}`}
              </span>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white flex items-baseline gap-2">
              {loading ? '...' : `${stats.fullSessions}`}
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                {stats.effectivenessRate}% efectivas
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              <span className="text-amber-600 font-semibold">{stats.shortSessions} breves (&lt; 2 min)</span> en este período
            </p>
          </div>

          {/* USUARIOS ACTIVOS EN EL PERÍODO */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800/80 shadow-sm relative overflow-hidden group hover:border-indigo-500/50 transition-all">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {selectedMonth === 'ALL' ? 'Total Colaboradores' : `Activos en ${formatMonthLabel(selectedMonth).split(' ')[0]}`}
              </span>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {loading ? '...' : stats.uniqueUsers}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {selectedMonth === 'ALL' ? 'Participantes históricos registrados' : 'Estudiantes y docentes con prácticas este mes'}
            </p>
          </div>

          {/* RENDIMIENTO GLOBAL DEL PERÍODO */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800/80 shadow-sm relative overflow-hidden group hover:border-violet-500/50 transition-all">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {selectedMonth === 'ALL' ? 'Rendimiento Global' : `Rendimiento ${formatMonthLabel(selectedMonth).split(' ')[0]}`}
              </span>
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <Award className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white flex items-baseline gap-2">
              {loading ? '...' : `${stats.avgGlobalScore}%`}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                stats.avgGlobalScore >= 70
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400'
              }`}>
                {stats.avgGlobalScore >= 70 ? 'Meta Cumplida' : 'Requiere Refuerzo'}
              </span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, stats.avgGlobalScore)}%` }}
              />
            </div>
          </div>
        </div>

        {/* SELECTOR DE TABS */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('EXPLORER')}
            className={`pb-3.5 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'EXPLORER'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 dark:border-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Activity className="w-4 h-4" />
            Explorador de Sesiones ({filteredAndSortedSimulations.length})
          </button>

          <button
            onClick={() => setActiveTab('USERS')}
            className={`pb-3.5 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'USERS'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 dark:border-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Kardex de Horas por Usuario ({stats.uniqueUsers})
          </button>

          <button
            onClick={() => setActiveTab('ERRORS')}
            className={`pb-3.5 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'ERRORS'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 dark:border-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            Auditoría de Errores & Juicio Clínico
          </button>

          <button
            onClick={() => setActiveTab('SCENARIOS')}
            className={`pb-3.5 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'SCENARIOS'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 dark:border-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Layers className="w-4 h-4" />
            Casos Clínicos ({scenarioOptions.length})
          </button>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: EXPLORADOR DE SESIONES CON FILTRADO ULTRA-RÁPIDO */}
        {/* ========================================================= */}
        {activeTab === 'EXPLORER' && (
          <div className="space-y-4">
            {/* 1. FILTRADO RÁPIDO MEDIANTE CHIPS DE ESCENARIOS (UN CLIC) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold px-1">
                <span className="flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-sky-600" />
                  Filtrar Rápido por Caso Clínico (Un Clic):
                </span>
                <span>{scenarioOptions.length} casos disponibles</span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <button
                  onClick={() => { setSelectedScenario('ALL'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    selectedScenario === 'ALL'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Todos los Casos ({stats.totalSims})
                </button>
                {scenarioOptions.slice(0, 6).map(sc => (
                  <button
                    key={sc.id}
                    onClick={() => {
                      setSelectedScenario(selectedScenario === sc.id ? 'ALL' : sc.id);
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      selectedScenario === sc.id
                        ? 'bg-sky-600 text-white shadow-sm font-bold'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span>{sc.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      selectedScenario === sc.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}>
                      {sc.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. BARRA DE HERRAMIENTAS Y BÚSQUEDA */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-3">
              <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                {/* Buscador de texto con botón de limpiar */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Escribe para buscar (alumno, docente, caso o fecha)..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full pl-10 pr-9 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filtros complementarios */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Selector desplegable de todos los escenarios */}
                  <select
                    value={selectedScenario}
                    onChange={(e) => { setSelectedScenario(e.target.value); setCurrentPage(1); }}
                    className="py-2 px-3 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-white outline-none cursor-pointer"
                  >
                    <option value="ALL">Más Casos...</option>
                    {scenarioOptions.map(sc => (
                      <option key={sc.id} value={sc.id}>{sc.name} ({sc.count})</option>
                    ))}
                  </select>

                  {/* Toggle: Solo sesiones efectivas */}
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={onlyEffectiveSessions}
                      onChange={(e) => { setOnlyEffectiveSessions(e.target.checked); setCurrentPage(1); }}
                      className="rounded text-sky-600 focus:ring-sky-500"
                    />
                    <span>≥ 2 min</span>
                  </label>

                  {/* Toggle de Aprobados / Refuerzo */}
                  <div className="flex items-center rounded-xl p-0.5 bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
                    <button
                      onClick={() => { setSelectedStatus('ALL'); setCurrentPage(1); }}
                      className={`px-2.5 py-1.5 rounded-lg transition-all ${selectedStatus === 'ALL' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => { setSelectedStatus('APPROVED'); setCurrentPage(1); }}
                      className={`px-2.5 py-1.5 rounded-lg transition-all ${selectedStatus === 'APPROVED' ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500'}`}
                    >
                      ≥70%
                    </button>
                    <button
                      onClick={() => { setSelectedStatus('REVIEW'); setCurrentPage(1); }}
                      className={`px-2.5 py-1.5 rounded-lg transition-all ${selectedStatus === 'REVIEW' ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-sm' : 'text-slate-500'}`}
                    >
                      &lt;70%
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. CHIPS DE FILTROS ACTIVOS CON BOTÓN PARA LIMPIAR TODO */}
              {hasActiveFilters && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-400 font-semibold mr-1">Filtros activos:</span>

                  {selectedScenario !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-medium">
                      Caso: {getScenarioFriendlyName(selectedScenario)}
                      <button onClick={() => setSelectedScenario('ALL')}><X className="w-3 h-3 hover:text-sky-900" /></button>
                    </span>
                  )}

                  {selectedUserFilter && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium">
                      Alumno: {selectedUserFilter}
                      <button onClick={() => setSelectedUserFilter(null)}><X className="w-3 h-3 hover:text-indigo-900" /></button>
                    </span>
                  )}

                  {onlyEffectiveSessions && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-medium">
                      Solo efectivas (≥ 2 min)
                      <button onClick={() => setOnlyEffectiveSessions(false)}><X className="w-3 h-3 hover:text-emerald-900" /></button>
                    </span>
                  )}

                  {selectedStatus !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">
                      Nota: {selectedStatus === 'APPROVED' ? 'Aprobados' : 'Refuerzo'}
                      <button onClick={() => setSelectedStatus('ALL')}><X className="w-3 h-3 hover:text-amber-900" /></button>
                    </span>
                  )}

                  {searchTerm && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                      Texto: &quot;{searchTerm}&quot;
                      <button onClick={() => setSearchTerm('')}><X className="w-3 h-3" /></button>
                    </span>
                  )}

                  <button
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 font-bold ml-auto hover:underline cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Limpiar todos los filtros
                  </button>
                </div>
              )}
            </div>

            {/* TABLA PRINCIPAL DE SESIONES CON ORDENAMIENTO POR COLUMNA */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-950/50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 select-none">
                      <th className="py-3.5 px-4 text-center w-12">#</th>

                      {/* Header Ordenable: Escenario */}
                      <th
                        onClick={() => handleSort('scenario')}
                        className="py-3.5 px-4 cursor-pointer hover:text-sky-600 transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Escenario Clínico</span>
                          {sortField === 'scenario' ? (
                            sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-600" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      {/* Header Ordenable: Fecha */}
                      <th
                        onClick={() => handleSort('date')}
                        className="py-3.5 px-4 cursor-pointer hover:text-sky-600 transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Fecha y Hora</span>
                          {sortField === 'date' ? (
                            sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-600" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      {/* Header Ordenable: Duración */}
                      <th
                        onClick={() => handleSort('duration')}
                        className="py-3.5 px-4 cursor-pointer hover:text-sky-600 transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Duración</span>
                          {sortField === 'duration' ? (
                            sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-600" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th className="py-3.5 px-4">Tipo</th>
                      <th className="py-3.5 px-4">Estudiantes Evaluados</th>

                      {/* Header Ordenable: Nota Media */}
                      <th
                        onClick={() => handleSort('score')}
                        className="py-3.5 px-4 text-center cursor-pointer hover:text-sky-600 transition-colors"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Nota Media</span>
                          {sortField === 'score' ? (
                            sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-600" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th className="py-3.5 px-4 text-center">Estado</th>
                      <th className="py-3.5 px-4 text-right">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="py-16 text-center text-slate-500">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-600" />
                          Cargando sesiones desde Simtryx...
                        </td>
                      </tr>
                    ) : paginatedSimulations.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-16 text-center text-slate-500">
                          <p className="font-semibold text-slate-700 dark:text-slate-300">No se encontraron sesiones para los filtros activos.</p>
                          <button
                            onClick={handleResetFilters}
                            className="mt-2 text-xs font-bold text-sky-600 hover:underline"
                          >
                            Restablecer todos los filtros
                          </button>
                        </td>
                      </tr>
                    ) : (
                      paginatedSimulations.map((sim, idx) => {
                        const durSec = getDurationSec(sim);
                        const durMin = Math.floor(durSec / 60);
                        const durRestSec = durSec % 60;
                        const isFull = durSec >= 120;
                        const avgScore = getSimAvgScore(sim);
                        const isApproved = avgScore !== null && avgScore >= 70;

                        return (
                          <tr
                            key={sim.id}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer"
                            onClick={() => setSelectedSim(sim)}
                          >
                            <td className="py-3.5 px-4 text-center text-xs font-mono text-slate-400">
                              {(currentPage - 1) * itemsPerPage + idx + 1}
                            </td>

                            {/* Clic en caso para filtrar por ese caso */}
                            <td className="py-3.5 px-4">
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedScenario(sim.sceneryID);
                                  setCurrentPage(1);
                                }}
                                className="font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors hover:underline"
                                title="Haz clic para filtrar solo por este caso clínico"
                              >
                                {getScenarioFriendlyName(sim.sceneryID)}
                              </div>
                              <div className="text-[11px] font-mono text-slate-400">{sim.sceneryID}</div>
                            </td>

                            <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                              <div className="flex items-center gap-1.5 font-medium">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                {sim.startTime ? new Date(sim.startTime).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                              </div>
                              <div className="text-[11px] text-slate-400 pl-5">
                                {sim.startTime ? new Date(sim.startTime).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '-'}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {durMin}m {durRestSec}s
                            </td>

                            {/* Clic en Tipo para alternar filtro de efectivas */}
                            <td className="py-3.5 px-4">
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOnlyEffectiveSessions(prev => !prev);
                                  setCurrentPage(1);
                                }}
                                className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer transition-transform hover:scale-105 ${
                                  isFull ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                }`}
                                title="Haz clic para alternar filtro de efectivas"
                              >
                                {isFull ? 'Completa' : 'Breve'}
                              </span>
                            </td>

                            {/* Clic en alumno para filtrar directamente por ese alumno */}
                            <td className="py-3.5 px-4">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {(sim.results?.users || []).map((u, uIdx) => (
                                  <span
                                    key={uIdx}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedUserFilter(selectedUserFilter === u.user ? null : u.user);
                                      setCurrentPage(1);
                                    }}
                                    className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-md font-medium cursor-pointer transition-colors ${
                                      selectedUserFilter === u.user
                                        ? 'bg-indigo-600 text-white font-bold'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-indigo-950 hover:text-indigo-700'
                                    }`}
                                    title={`Clic para filtrar solo por ${u.user}`}
                                  >
                                    {u.user.split('@')[0]}
                                  </span>
                                ))}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {avgScore !== null ? (
                                <span className={`font-extrabold text-sm ${isApproved ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                  {avgScore.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">Sin nota</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {avgScore !== null ? (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  isApproved
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                                }`}>
                                  {isApproved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                                  {isApproved ? 'Aprobado' : 'Refuerzo'}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">-</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSim(sim);
                                }}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                              >
                                <ChevronRight className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINACIÓN */}
              {totalPages > 1 && (
                <div className="py-4 px-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Mostrando <span className="font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> a{' '}
                    <span className="font-semibold">{Math.min(currentPage * itemsPerPage, filteredAndSortedSimulations.length)}</span> de{' '}
                    <span className="font-semibold">{filteredAndSortedSimulations.length}</span> sesiones
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Anterior
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                      let pageNum = currentPage;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (currentPage <= 3) pageNum = i + 1;
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = currentPage - 2 + i;

                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                            currentPage === pageNum
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: KARDEX DE HORAS POR USUARIO */}
        {/* ========================================================= */}
        {activeTab === 'USERS' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    Ranking de Participación y Carga Horaria por Colaborador
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Horas invertidas correspondientes a: <strong>{formatMonthLabel(selectedMonth)}</strong>
                  </p>
                </div>
                <span className="text-xs font-bold px-3 py-1 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 rounded-lg">
                  {stats.uniqueUsers} Colaboradores Activos en este período
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-950/50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <th className="py-3.5 px-4 text-center w-12">#</th>
                      <th className="py-3.5 px-4">Usuario / Correo</th>
                      <th className="py-3.5 px-4 text-center">Horas en Período</th>
                      <th className="py-3.5 px-4 text-center">Total Sesiones</th>
                      <th className="py-3.5 px-4 text-center">Finalizadas (≥2m)</th>
                      <th className="py-3.5 px-4 text-center">Breves (&lt;2m)</th>
                      <th className="py-3.5 px-4 text-center">Casos Únicos</th>
                      <th className="py-3.5 px-4 text-center">Nota Media</th>
                      <th className="py-3.5 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                    {Object.entries(stats.userAgg)
                      .sort((a, b) => b[1].durationSec - a[1].durationSec)
                      .map(([email, d], idx) => {
                        const hrs = d.durationSec / 3600;
                        const avgScore = d.scores.length > 0 ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0;

                        return (
                          <tr
                            key={email}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                            onClick={() => setSelectedUserEmail(email)}
                          >
                            <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {email}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {d.passedSessions} aprobadas de {d.sessions} prácticas
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="font-extrabold text-sky-600 dark:text-sky-400 text-sm">
                                {hrs.toFixed(2)} hrs
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold text-slate-700 dark:text-slate-300">
                              {d.sessions}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="text-emerald-600 font-semibold">{d.fullSessions}</span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="text-amber-600">{d.shortSessions}</span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300">
                                {d.scenarios.size} casos
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-extrabold">
                              <span className={avgScore >= 70 ? 'text-emerald-600' : 'text-amber-600'}>
                                {avgScore.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedUserEmail(email);
                                }}
                                className="px-3 py-1 rounded-lg text-xs font-semibold bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 hover:bg-sky-100 transition-colors"
                              >
                                Ver Ficha
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: AUDITORÍA DE ERRORES & JUICIO CLÍNICO */}
        {/* ========================================================= */}
        {activeTab === 'ERRORS' && (
          <div className="space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-rose-500" />
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">
                      Matriz de Seguridad del Paciente: Errores de Omisión
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Procedimientos críticos exigidos y omitidos en el período: <strong>{formatMonthLabel(selectedMonth)}</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {Object.entries(stats.checklistErrors)
                  .sort((a, b) => b[1].omitted - a[1].omitted)
                  .map(([actionName, data]) => {
                    const omitPct = (data.omitted / data.total) * 100;
                    const isCritical = omitPct >= 75;

                    return (
                      <div key={actionName} className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                          <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">
                            {actionName}
                          </span>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-500">
                              Exigido <strong>{data.total}</strong> veces
                            </span>
                            <span className={`px-2 py-0.5 rounded font-bold ${
                              isCritical ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}>
                              {omitPct.toFixed(1)}% Omitido ({data.omitted} fallos)
                            </span>
                          </div>
                        </div>

                        <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden flex">
                          <div
                            className="bg-emerald-500 h-full"
                            style={{ width: `${100 - omitPct}%` }}
                            title={`Completado: ${data.completed} (${(100 - omitPct).toFixed(1)}%)`}
                          />
                          <div
                            className="bg-rose-500 h-full"
                            style={{ width: `${omitPct}%` }}
                            title={`Omitido: ${data.omitted} (${omitPct.toFixed(1)}%)`}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <HelpCircle className="w-5 h-5 text-indigo-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Auditoría de Juicio Diagnóstico en Debriefing ({formatMonthLabel(selectedMonth)})
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(stats.debriefingQuestions).map(([qTitle, data]) => {
                  const successPct = data.total > 0 ? (data.correct / data.total) * 100 : 0;
                  return (
                    <div key={qTitle} className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-relaxed mb-3">
                          {qTitle}
                        </h4>
                        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                          <span>Aciertos: <strong className="text-emerald-600">{data.correct}</strong></span>
                          <span>Errores/Sin responder: <strong className="text-rose-600">{data.incorrect}</strong></span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
                        <div
                          className="bg-emerald-500 h-full rounded-full"
                          style={{ width: `${successPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: CASOS CLÍNICOS */}
        {/* ========================================================= */}
        {activeTab === 'SCENARIOS' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Object.entries(stats.scenarioAgg)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([name, data]) => {
                  const hrs = data.durationSec / 3600;
                  const avg = data.scores.length > 0 ? (data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0;
                  const passRate = data.scores.length > 0 ? (data.scores.filter(s => s >= 70).length / data.scores.length) * 100 : 0;

                  return (
                    <div
                      key={name}
                      className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <h3 className="font-bold text-slate-900 dark:text-white leading-tight">
                            {name}
                          </h3>
                          <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400">
                            {data.count} sesiones
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-4">
                          Tiempo acumulado: <strong className="text-slate-700 dark:text-slate-300">{hrs.toFixed(1)} hrs</strong> ({((data.fullSessions / data.count) * 100).toFixed(0)}% efectivas)
                        </p>
                      </div>

                      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Nota Promedio</span>
                          <span className="font-extrabold text-slate-800 dark:text-slate-200">{avg.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Tasa de Aprobación</span>
                          <span className={`font-bold ${passRate >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>{passRate.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-sky-600 h-full rounded-full"
                            style={{ width: `${(data.count / stats.totalSims) * 100 * 3}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: FICHA DE AUDITORÍA DE SESIÓN */}
      {selectedSim && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between bg-slate-50/50 dark:bg-slate-950/50">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  Ficha de Auditoría Clínica
                </span>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                  {getScenarioFriendlyName(selectedSim.sceneryID)}
                </h2>
                <p className="text-xs text-slate-500 font-mono mt-1">ID: {selectedSim.id}</p>
              </div>
              <button
                onClick={() => setSelectedSim(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Inicio</span>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                    {selectedSim.startTime || '-'}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Fin</span>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                    {selectedSim.endTime || '-'}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Docente / Admin</span>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 truncate" title={selectedSim.startUser}>
                    {selectedSim.startUser || '-'}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Estudiantes</span>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                    {selectedSim.results?.users?.length || 0} registrados
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Resultados por Alumno
                </h4>
                <div className="space-y-2">
                  {(selectedSim.results?.users || []).map((u, i) => {
                    const pct = (u.success || 0) * 100;
                    const pass = pct >= 70;
                    return (
                      <div
                        key={i}
                        className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${pass ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {u.user}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-extrabold ${pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {pct.toFixed(1)}%
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                            pass ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}>
                            {pass ? 'Aprobado' : 'Refuerzo'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedSim.results?.debriefing?.questions && selectedSim.results.debriefing.questions.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Preguntas de Juicio Clínico (Debriefing)
                  </h4>
                  <div className="space-y-3">
                    {selectedSim.results.debriefing.questions.map((q, qIdx) => (
                      <div key={qIdx} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
                        <p className="text-xs font-bold text-slate-900 dark:text-white mb-2">
                          {qIdx + 1}. {q.title}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {q.options.map((opt, oIdx) => {
                            const isCorrect = oIdx === q.correctOption;
                            return (
                              <div
                                key={oIdx}
                                className={`p-2 rounded-lg border text-xs flex items-center gap-2 ${
                                  isCorrect
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 font-semibold text-emerald-800 dark:text-emerald-300'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                                }`}
                              >
                                {isCorrect ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-700 flex-shrink-0" />}
                                <span>{opt}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedSim.results?.checklist && selectedSim.results.checklist.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Checklist de Acciones Obligatorias
                  </h4>
                  <div className="space-y-3">
                    {selectedSim.results.checklist.map((chk, cIdx) => (
                      <div key={cIdx} className="space-y-2">
                        {(chk.actionsData || []).map((cat, catIdx) => (
                          <div key={catIdx} className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 bg-white dark:bg-slate-900">
                            <span className="text-[11px] font-extrabold uppercase text-sky-600 dark:text-sky-400">
                              {cat.categoryTitle}
                            </span>
                            <div className="mt-2 space-y-1.5">
                              {(cat.required || []).map((req, rIdx) => (
                                <div key={rIdx} className="flex items-center justify-between text-xs py-1">
                                  <span className="text-slate-700 dark:text-slate-300">{req.title}</span>
                                  {req.success === 1 ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">
                                      <CheckCircle2 className="w-3 h-3" /> Realizado
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 bg-rose-50 dark:bg-rose-950 px-2 py-0.5 rounded">
                                      <X className="w-3 h-3" /> Omitido
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AVISO INFORMATIVO CUANDO NO HAY DEBRIEFING NI CHECKLIST */}
              {(!selectedSim.results?.debriefing?.questions || selectedSim.results.debriefing.questions.length === 0) &&
               (!selectedSim.results?.checklist || selectedSim.results.checklist.length === 0) && (
                <div className="p-5 rounded-2xl border border-dashed border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 text-center">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-2.5">
                    <HelpCircle className="w-5 h-5" />
                  </div>
                  <h5 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Sin Cuestionario de Debriefing ni Rúbrica Registrada
                  </h5>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-lg mx-auto mt-1.5 leading-relaxed">
                    {selectedSim.sceneryID === 'abdominal_sepsis-p0' || selectedSim.sceneryID === 'advance-acute_ischemic_stroke-p0' || selectedSim.sceneryID.includes('local')
                      ? 'Este escenario clínico en Simtryx fue desarrollado como simulación libre/procedimental y la plataforma aún no tiene programada la matriz de debriefing ni checklist.'
                      : 'Esta sesión finalizó o fue cerrada antes de pasar a la etapa de evaluación interactiva (debriefing) en la plataforma Simtryx.'}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex justify-end">
              <button
                onClick={() => setSelectedSim(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-xs hover:opacity-90 transition-opacity"
              >
                Cerrar Ficha
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: KARDEX INDIVIDUAL POR USUARIO */}
      {selectedUserEmail && stats.userAgg[selectedUserEmail] && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between bg-slate-50/50 dark:bg-slate-950/50">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  Ficha Kardex del Colaborador
                </span>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedUserEmail}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Registro histórico de sesiones, tiempos y desempeño en Simtryx
                </p>
              </div>
              <button
                onClick={() => setSelectedUserEmail(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Horas Conectado</span>
                  <div className="text-lg font-extrabold text-sky-600 dark:text-sky-400 mt-1">
                    {(stats.userAgg[selectedUserEmail].durationSec / 3600).toFixed(2)} hrs
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Sesiones</span>
                  <div className="text-lg font-extrabold text-slate-800 dark:text-slate-200 mt-1">
                    {stats.userAgg[selectedUserEmail].sessions}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Casos Distintos</span>
                  <div className="text-lg font-extrabold text-slate-800 dark:text-slate-200 mt-1">
                    {stats.userAgg[selectedUserEmail].scenarios.size}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Aprobadas</span>
                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                    {stats.userAgg[selectedUserEmail].passedSessions} / {stats.userAgg[selectedUserEmail].sessions}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Casos Clínicos Abordados
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(stats.userAgg[selectedUserEmail].scenarios).map(sc => (
                    <span key={sc} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                      {sc}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Historial de Prácticas
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Fecha</th>
                        <th className="py-2.5 px-3">Escenario</th>
                        <th className="py-2.5 px-3 text-center">Duración</th>
                        <th className="py-2.5 px-3 text-center">Nota</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {stats.userAgg[selectedUserEmail].sims.map((s, idx) => {
                        const dur = getDurationSec(s);
                        const avg = getSimAvgScore(s);
                        return (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                              {s.startTime ? s.startTime.split(' ')[0] : '-'}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                              {getScenarioFriendlyName(s.sceneryID)}
                            </td>
                            <td className="py-2.5 px-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                              {Math.floor(dur / 60)}m {dur % 60}s
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold">
                              {avg !== null ? (
                                <span className={avg >= 70 ? 'text-emerald-600' : 'text-amber-600'}>
                                  {avg.toFixed(1)}%
                                </span>
                              ) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex justify-end">
              <button
                onClick={() => setSelectedUserEmail(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-xs hover:opacity-90 transition-opacity"
              >
                Cerrar Kardex
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { CheckCircle2, RotateCw, Filter, MessageSquare, Briefcase, Clock, X } from "lucide-react";
import { format, isAfter, subDays, startOfDay } from "date-fns";
import { es } from "date-fns/locale";

interface Config {
  hasTelegramToken: boolean;
  hasGeminiToken: boolean;
  hasGoogleCreds: boolean;
}

interface LeadLog {
  id: string;
  date: string;
  receivedData: string;
  isQualified: boolean;
  reason: string;
  sheetLogged: boolean;
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [leads, setLeads] = useState<LeadLog[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [dateFilter, setDateFilter] = useState("all");

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error("Failed to fetch config", e);
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchLeads = async () => {
    try {
      const res = await fetch("/api/leads");
      const data = await res.json();
      setLeads(data);
    } catch (e) {
      console.error("Failed to fetch leads", e);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchLeads();
    
    const interval = setInterval(() => {
      fetchLeads();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const filteredLeads = useMemo(() => {
    const now = new Date();
    return leads.filter((lead) => {
      const leadDate = new Date(lead.date);
      if (dateFilter === "today") {
        return isAfter(leadDate, startOfDay(now));
      }
      if (dateFilter === "7days") {
        return isAfter(leadDate, subDays(now, 7));
      }
      return true;
    });
  }, [leads, dateFilter]);

  const qualifiedLeads = filteredLeads.filter(l => l.isQualified);
  const unqualifiedLeads = filteredLeads.filter(l => !l.isQualified);

  if (loadingConfig) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-400">
        <RotateCw className="animate-spin w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] font-sans selection:bg-blue-200">
      {/* Top Navigation */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black text-white rounded-xl flex items-center justify-center shadow-sm">
              <Briefcase className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Lead Intelligence</h1>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium text-gray-500 hidden sm:flex">
            <StatusIndicator label="Telegram" active={config?.hasTelegramToken} />
            <StatusIndicator label="Gemini AI" active={config?.hasGeminiToken} />
            <StatusIndicator label="Sheets" active={config?.hasGoogleCreds} />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">Resumen de Leads</h2>
            <p className="text-gray-500">Supervisando flujos de cualificación en tiempo real.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <select 
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="appearance-none bg-white border border-gray-200 text-gray-700 py-2 pl-4 pr-10 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-shadow cursor-pointer font-medium"
              >
                <option value="all">Todo el histórico</option>
                <option value="today">Hoy</option>
                <option value="7days">Últimos 7 días</option>
              </select>
              <Filter className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Grids */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          
          {/* Qualified Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Cualificados
              </h3>
              <span className="bg-green-100 text-green-700 py-0.5 px-2.5 rounded-full text-xs font-bold">
                {qualifiedLeads.length}
              </span>
            </div>
            {qualifiedLeads.length === 0 ? (
              <EmptyState type="qualified" />
            ) : (
              <div className="space-y-4">
                {qualifiedLeads.map(lead => <LeadCard key={lead.id} lead={lead} type="qualified" />)}
              </div>
            )}
          </div>

          {/* Unqualified Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <X className="w-5 h-5 text-gray-400" />
                No Cualificados
              </h3>
              <span className="bg-gray-200 text-gray-600 py-0.5 px-2.5 rounded-full text-xs font-bold">
                {unqualifiedLeads.length}
              </span>
            </div>
            {unqualifiedLeads.length === 0 ? (
              <EmptyState type="unqualified" />
            ) : (
              <div className="space-y-4">
                {unqualifiedLeads.map(lead => <LeadCard key={lead.id} lead={lead} type="unqualified" />)}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

function StatusIndicator({ label, active }: { label: string, active?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={active ? "Conectado" : "Desconectado"}>
      <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-red-500'}`}></div>
      <span>{label}</span>
    </div>
  );
}

function LeadCard({ lead, type }: { lead: LeadLog, type: 'qualified' | 'unqualified' }) {
  const isQualified = type === 'qualified';
  return (
    <div className={`bg-white rounded-2xl p-5 shadow-sm border transition-all hover:shadow-md ${isQualified ? 'border-green-100' : 'border-gray-100'}`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <Clock className="w-3.5 h-3.5" />
          {format(new Date(lead.date), "d MMM, HH:mm", { locale: es })}
        </div>
        {!lead.sheetLogged && (
           <span className="text-[10px] uppercase font-bold text-orange-500 bg-orange-50 px-2 py-0.5 rounded-md">Error al Guardar(Sheet)</span>
        )}
      </div>
      
      <div className="mb-4">
        <div className="flex gap-2 items-start text-sm text-gray-800 bg-gray-50/50 p-3 rounded-xl border border-gray-100/50 leading-relaxed">
          <MessageSquare className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="line-clamp-3">"{lead.receivedData}"</p>
        </div>
      </div>
      
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Evaluación IA</p>
        <p className={`text-sm leading-relaxed ${isQualified ? 'text-gray-700' : 'text-gray-500'}`}>
          {lead.reason}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ type }: { type: 'qualified' | 'unqualified' }) {
  return (
    <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center text-gray-400 h-48">
      {type === 'qualified' ? <CheckCircle2 className="w-8 h-8 mb-3 opacity-20" /> : <X className="w-8 h-8 mb-3 opacity-20" />}
      <p className="font-medium text-sm">
        No hay leads {type === 'qualified' ? 'cualificados' : 'no cualificados'} en este periodo.
      </p>
    </div>
  );
}

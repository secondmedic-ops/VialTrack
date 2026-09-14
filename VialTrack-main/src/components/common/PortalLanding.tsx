import React from 'react';
import { BrandLogo } from './BrandLogo';
import {
  ShieldCheck,
  Building2,
  Bike,
  LayoutDashboard,
  ArrowRight,
  Activity,
  MapPin,
  Thermometer,
  Lock,
  FileCheck2,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

interface PortalLandingProps {
  onSelectPortal: (portal: 'admin' | 'client' | 'rider') => void;
}

export const PortalLanding: React.FC<PortalLandingProps> = ({ onSelectPortal }) => {
  return (
    <div className="min-h-[88vh] flex flex-col justify-between py-6 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      {/* Header / Hero Section */}
      <div className="text-center pt-4 pb-8 sm:pb-12 max-w-3xl mx-auto flex flex-col items-center">
        <div className="mb-4">
          <BrandLogo size="lg" className="h-12 sm:h-14 w-auto" />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 bg-sky-50 border border-sky-200 text-sky-800 rounded-full text-xs font-semibold mb-4">
          <Activity className="w-3.5 h-3.5 text-sky-700" />
          <span>Diagnostic Specimen Cold-Chain Logistics • Mumbai Network</span>
        </div>

        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
          Unified Cold-Chain Operations Portals
        </h1>
        <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
          Secure, isolated portals for real-time biological specimen tracking, cold-chain temperature compliance (2°C–8°C), and digital chain-of-custody verification.
        </p>
      </div>

      {/* 3 Isolated Portal Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mb-12">
        {/* Card 1: Admin Console */}
        <div
          id="portal-card-admin"
          onClick={() => onSelectPortal('admin')}
          className="group relative bg-white rounded-2xl border border-slate-200 hover:border-sky-600 p-6 sm:p-7 shadow-xs hover:shadow-lg transition-all duration-200 flex flex-col justify-between cursor-pointer"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center mb-5 group-hover:bg-sky-700 transition-colors shadow-xs">
              <LayoutDashboard className="w-6 h-6" />
            </div>

            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold uppercase tracking-wider border border-slate-200">
                Operations
              </span>
              <span className="text-[11px] text-slate-400 font-mono">#/admin</span>
            </div>

            <h3 className="text-xl font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
              Admin Console
            </h3>

            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Centralized fleet dispatch, live Mumbai interactive radar, courier management, SLA reports, and automated alert rules.
            </p>

            <ul className="mt-4 space-y-2 text-xs text-slate-500">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Live GPS fleet radar & task dispatch</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Rider attendance & route optimization</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Chain of custody & tamper verification</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 group-hover:text-sky-700 transition-colors">
              Enter Admin Portal
            </span>
            <div className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-sky-700 group-hover:text-white flex items-center justify-center text-slate-600 transition-all">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Card 2: Diagnostic Client */}
        <div
          id="portal-card-client"
          onClick={() => onSelectPortal('client')}
          className="group relative bg-white rounded-2xl border border-slate-200 hover:border-emerald-600 p-6 sm:p-7 shadow-xs hover:shadow-lg transition-all duration-200 flex flex-col justify-between cursor-pointer"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center mb-5 group-hover:bg-emerald-700 group-hover:text-white transition-colors shadow-xs">
              <Building2 className="w-6 h-6" />
            </div>

            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded text-[10px] font-bold uppercase tracking-wider border border-emerald-200">
                Partner Labs
              </span>
              <span className="text-[11px] text-slate-400 font-mono">#/client</span>
            </div>

            <h3 className="text-xl font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
              Diagnostic Client
            </h3>

            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Real-time specimen collection tracking for diagnostic centers and hospitals. Monitor active courier arrival, vial manifests, and temperature logs.
            </p>

            <ul className="mt-4 space-y-2 text-xs text-slate-500">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Live courier ETA & GPS map tracking</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Digital specimen pickup manifests</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Instant SLA issue reporting to ops</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 group-hover:text-emerald-700 transition-colors">
              Enter Client Portal
            </span>
            <div className="w-8 h-8 rounded-full bg-emerald-50 group-hover:bg-emerald-700 group-hover:text-white flex items-center justify-center text-emerald-700 transition-all">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Card 3: Courier / Rider */}
        <div
          id="portal-card-rider"
          onClick={() => onSelectPortal('rider')}
          className="group relative bg-white rounded-2xl border border-slate-200 hover:border-sky-600 p-6 sm:p-7 shadow-xs hover:shadow-lg transition-all duration-200 flex flex-col justify-between cursor-pointer"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center mb-5 group-hover:bg-sky-700 group-hover:text-white transition-colors shadow-xs">
              <Bike className="w-6 h-6" />
            </div>

            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 bg-sky-50 text-sky-800 rounded text-[10px] font-bold uppercase tracking-wider border border-sky-200">
                Courier Mobile
              </span>
              <span className="text-[11px] text-slate-400 font-mono">#/rider</span>
            </div>

            <h3 className="text-xl font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
              Rider Mobile App
            </h3>

            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Mobile collection workflow for pickup boys. Stop-by-stop navigation, cold-box temperature recording, vial camera scans, and lab handovers.
            </p>

            <ul className="mt-4 space-y-2 text-xs text-slate-500">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>Geofenced stop check-in & navigation</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>Cold-box 2°C–8°C temperature logging</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>Watermarked digital proof of pickup</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 group-hover:text-sky-700 transition-colors">
              Enter Rider App
            </span>
            <div className="w-8 h-8 rounded-full bg-sky-50 group-hover:bg-sky-700 group-hover:text-white flex items-center justify-center text-sky-700 transition-all">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Compliance & Standards Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-sky-700 shrink-0" />
          <span className="font-semibold text-slate-800">ISO 15189 & NABL Specimen Handling Compliance</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <Thermometer className="w-4 h-4 text-sky-600" />
            <span>Strict 2°C–8°C Cold Chain</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <span>Real-Time GPS Fleet Radar</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-amber-600" />
            <span>Isolated Role Boundaries</span>
          </div>
        </div>
      </div>
    </div>
  );
};

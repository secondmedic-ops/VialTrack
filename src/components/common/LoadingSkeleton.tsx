import React from 'react';
import { Activity, Shield, RefreshCw } from 'lucide-react';
import { UserRole } from '../../types';

interface LoadingSkeletonProps {
  rolePortal?: UserRole;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ rolePortal = 'admin' }) => {
  return (
    <div
      id="app-loading-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-sky-600 selection:text-white"
    >
      {/* Top Demo Bar Placeholder */}
      <div className="bg-slate-900 text-slate-300 text-xs px-4 py-2 flex items-center justify-between border-b border-slate-800 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-sky-400 rounded-full animate-ping" />
          <div className="h-3.5 w-44 bg-slate-700 rounded-sm" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-20 bg-slate-800 rounded-md" />
          <div className="h-4 w-20 bg-slate-800 rounded-md" />
          <div className="h-4 w-20 bg-slate-800 rounded-md" />
        </div>
      </div>

      {/* App Header Skeleton */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-sky-700 rounded-lg flex items-center justify-center text-white shadow-xs">
              <Activity className="w-4 h-4 text-white animate-spin" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold tracking-tight text-sky-900">
                  SecondMedic <span className="text-teal-600 font-semibold">VialTrack</span>
                </span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-slate-200">
                  {rolePortal === 'admin' ? 'Admin Ops' : rolePortal === 'client' ? 'Client Lab' : 'Rider App'}
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium hidden md:block">
                Diagnostic Specimen Cold-Chain Logistics • ISO 15189 Compliant
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md text-xs text-slate-500 animate-pulse">
              <span className="w-2 h-2 bg-sky-500 rounded-full animate-ping" />
              <span>Hydrating Cold-Chain Engine...</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-600" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Skeleton Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 animate-pulse">
        {/* Navigation Tabs Placeholder (for Admin) */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          <div className="h-8 w-28 bg-white border border-slate-200 rounded-lg shadow-xs" />
          <div className="h-8 w-28 bg-white border border-slate-200 rounded-lg shadow-xs" />
          <div className="h-8 w-32 bg-white border border-slate-200 rounded-lg shadow-xs" />
          <div className="h-8 w-24 bg-white border border-slate-200 rounded-lg shadow-xs" />
          <div className="h-8 w-24 bg-white border border-slate-200 rounded-lg shadow-xs" />
        </div>

        {/* 4 Metric Cards Skeleton Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="h-3 w-20 bg-slate-200 rounded-sm" />
                <div className="w-7 h-7 bg-slate-100 rounded-lg border border-slate-200" />
              </div>
              <div className="h-6 w-16 bg-slate-300 rounded-md mb-2" />
              <div className="h-2.5 w-28 bg-slate-100 rounded-sm" />
            </div>
          ))}
        </div>

        {/* Operational Split Layout Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
          {/* Main Radar / Route Pipeline Skeleton */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <div className="space-y-1.5">
                  <div className="h-4 w-48 bg-slate-200 rounded-sm" />
                  <div className="h-3 w-32 bg-slate-100 rounded-sm" />
                </div>
                <div className="h-6 w-24 bg-slate-100 rounded-full border border-slate-200" />
              </div>

              {/* Map Canvas Skeleton Placeholder */}
              <div className="w-full h-72 sm:h-80 bg-slate-100 rounded-lg border border-slate-200 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                <Shield className="w-10 h-10 text-sky-300 mb-2 animate-bounce" />
                <span className="text-xs font-semibold text-slate-500">
                  Synchronizing GPS Geofences & Fleet Radar
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  SecondMedic Safe-Drop & Cold-Chain Tracking
                </span>
              </div>
            </div>

            {/* Sub-card list */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <div className="h-4 w-36 bg-slate-200 rounded-sm" />
              <div className="space-y-2">
                {[1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-slate-200" />
                      <div className="space-y-1">
                        <div className="h-3.5 w-36 bg-slate-300 rounded-sm" />
                        <div className="h-2.5 w-24 bg-slate-200 rounded-sm" />
                      </div>
                    </div>
                    <div className="h-6 w-20 bg-slate-200 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar Status Skeleton */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="h-4 w-32 bg-slate-200 rounded-sm" />
                <div className="h-4 w-12 bg-slate-100 rounded-sm" />
              </div>
              <div className="space-y-3">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-28 bg-slate-300 rounded-sm" />
                      <div className="h-3 w-12 bg-sky-100 rounded-sm" />
                    </div>
                    <div className="h-2.5 w-full bg-slate-200 rounded-sm" />
                    <div className="h-2 w-3/4 bg-slate-100 rounded-sm" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Footer indicator */}
      <footer className="py-4 text-center text-xs text-slate-400 border-t border-slate-200 bg-white">
        <div className="flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-ping" />
          <span>VialTrack Specimen Engine v2.4 • Initializing Application State...</span>
        </div>
      </footer>
    </div>
  );
};

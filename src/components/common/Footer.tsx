import React from 'react';
import { UserRole } from '../../types';
import { ExternalLink, CheckCircle2 } from 'lucide-react';

interface FooterProps {
  role?: UserRole;
}

export const Footer: React.FC<FooterProps> = ({ role }) => {
  return (
    <footer className="mt-auto py-3 sm:py-3.5 bg-white border-t border-slate-200 text-slate-500 text-[10px] sm:text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-sky-700 text-white flex items-center justify-center font-bold text-[9px]">
            SM
          </div>
          <span className="font-bold text-slate-800">SecondMedic VialTrack</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">Internal Operations Console v2.4.0</span>
        </div>

        {/* Small "Powered by SecondMedic" line */}
        {(role === 'client' || role === 'rider') && (
          <div className="flex items-center gap-1.5 text-slate-600 bg-slate-50 px-2.5 py-0.5 rounded-md border border-slate-200 text-[11px]">
            <span>Secured by</span>
            <a
              href="https://secondmedic.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 font-bold hover:underline flex items-center gap-0.5"
            >
              SecondMedic <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
            </a>
          </div>
        )}

        <div className="flex items-center gap-4 text-slate-400 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            GPS Fleet Sync
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            Cold-Chain Safe (2-8°C)
          </span>
          <span className="hidden md:inline text-slate-300">•</span>
          <span className="hidden md:inline">© {new Date().getFullYear()} SecondMedic Healthcare</span>
        </div>
      </div>
    </footer>
  );
};

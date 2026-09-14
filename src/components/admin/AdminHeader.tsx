import React from 'react';
import { UserAuth } from '../../types';
import { Bell, LogOut, Radio, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo';

interface AdminHeaderProps {
  user: UserAuth;
  onLogout: () => void;
  unreadNotifsCount: number;
  onOpenNotifications: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  user,
  onLogout,
  unreadNotifsCount,
  onOpenNotifications
}) => {
  const displayName = 'Delvin Nadar';

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs text-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-4">
        {/* Brand Logo & Pill Badge */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="h-8 w-auto flex items-center shrink-0">
            <BrandLogo className="h-8 w-auto" />
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-slate-900 text-white rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-slate-800 shadow-xs whitespace-nowrap">
              VIALTRACK | OPERATIONS CONSOLE
            </span>
          </div>
        </div>

        {/* Right Actions & Status */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          {/* Live Fleet Indicator */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-600 font-medium bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            <span>Live GPS Radar</span>
          </div>

          {/* Notifications Button */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            title="View Live Alerts & WhatsApp/SMS Log"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifsCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
                {unreadNotifsCount}
              </span>
            )}
          </button>

          {/* User Profile info & Logout */}
          <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-200">
            <div className="text-right hidden sm:flex flex-col items-end justify-center">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900 text-sm">{displayName}</span>
                <span className="px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                  Ops Head
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">Creator & System Admin</p>
            </div>

            <button
              onClick={onLogout}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-600 hover:text-rose-600 transition-colors text-xs flex items-center gap-1.5 cursor-pointer font-semibold"
              title="Exit Admin Console"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs">Exit Admin</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

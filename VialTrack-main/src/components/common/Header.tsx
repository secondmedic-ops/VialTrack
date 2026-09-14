import React from 'react';
import { UserAuth } from '../../types';
import { Shield, Bell, LogOut, Radio, Play, Activity } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface HeaderProps {
  user: UserAuth;
  onLogout: () => void;
  unreadNotifsCount: number;
  onOpenNotifications: () => void;
  onNavigateTab?: (tab: string) => void;
  currentTab?: string;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
  unreadNotifsCount,
  onOpenNotifications
}) => {
  const getRoleBadge = () => {
    switch (user.role) {
      case 'admin':
        return (
          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-slate-200">
            Admin Ops Center
          </span>
        );
      case 'client':
        return (
          <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-teal-200">
            Client Diagnostic Lab
          </span>
        );
      case 'rider':
        return (
          <span className="px-2 py-0.5 bg-sky-50 text-sky-700 rounded text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-sky-200">
            Pickup Boy (Rider)
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs text-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-4">
        {/* Brand Logo & Title */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <BrandLogo className="h-8 w-auto" />
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-slate-900 text-white rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-slate-700 shadow-xs whitespace-nowrap">
              VialTrack | Operations Console
            </span>
            <div className="hidden sm:inline-block">{getRoleBadge()}</div>
          </div>
        </div>

        {/* Right Actions & Status */}
        <div className="flex items-center gap-3 sm:gap-5">
          {/* Live Fleet Indicator */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-600 font-medium bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            <span>Live GPS Radar Active</span>
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
          <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-800 leading-tight">{user.name}</div>
              <div className="text-[10px] text-slate-400 font-mono truncate max-w-[130px]">{user.email}</div>
            </div>

            <div className="w-8 h-8 bg-slate-100 text-slate-700 font-bold text-xs rounded-full flex items-center justify-center border border-slate-300">
              {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>

            <button
              onClick={onLogout}
              className="p-1.5 sm:px-2.5 sm:py-1 rounded-lg bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-500 hover:text-rose-600 transition-colors text-xs flex items-center gap-1 cursor-pointer"
              title="Logout from this portal"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline font-semibold text-[11px]">Exit</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

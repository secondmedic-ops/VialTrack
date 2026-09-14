import React from 'react';
import { UserAuth } from '../../types';
import { Bell, LogOut, Shield, Eye, ArrowLeft } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface NavbarProps {
  user?: UserAuth | null;
  portalType?: 'admin' | 'client' | 'rider';
  titleBadge?: string;
  onLogout?: () => void;
  unreadNotifsCount?: number;
  onOpenNotifications?: () => void;
  onExitPreview?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  portalType = 'admin',
  titleBadge,
  onLogout,
  unreadNotifsCount = 0,
  onOpenNotifications,
  onExitPreview
}) => {
  const defaultBadge =
    portalType === 'admin'
      ? 'VIALTRACK | OPERATIONS CONSOLE'
      : portalType === 'client'
      ? 'VIALTRACK | CLIENT DIAGNOSTIC PORTAL'
      : 'VIALTRACK | RIDER PORTAL';

  const badgeText = titleBadge || defaultBadge;

  const getBadgeStyle = () => {
    switch (portalType) {
      case 'client':
        return 'bg-emerald-900 text-white border-emerald-700';
      case 'rider':
        return 'bg-sky-900 text-white border-sky-700';
      default:
        return 'bg-slate-900 text-white border-slate-800';
    }
  };

  const displayName = user?.role === 'admin' ? (user.name || 'Administrator') : user?.name;
  const displayEmail = user?.email || '';

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs text-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-4">
        {/* Brand Logo & Badge */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="h-8 w-auto flex items-center shrink-0">
            <BrandLogo className="h-8 w-auto" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider border shadow-xs whitespace-nowrap ${getBadgeStyle()}`}
            >
              {badgeText}
            </span>
            {user?.role === 'admin' ? (
              <span className="hidden md:inline-block px-2 py-0.5 bg-sky-50 text-sky-800 rounded text-[10px] sm:text-xs font-bold border border-sky-200">
                Ops Head
              </span>
            ) : user?.name ? (
              <span className="hidden md:inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] sm:text-xs font-semibold border border-slate-200">
                {user.name.split('(')[0].trim()}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          {/* Notifications Button */}
          {onOpenNotifications && (
            <button
              onClick={onOpenNotifications}
              className="relative p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              title="View Alerts & Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifsCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
                  {unreadNotifsCount}
                </span>
              )}
            </button>
          )}

          {/* User Info & Actions */}
          {user && (
            <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-200">
              {user.role === 'admin' ? (
                <div className="text-right hidden sm:flex flex-col items-end justify-center">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">Delvin Nadar</span>
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                      Ops Head
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight mt-0.5">Creator & System Admin</p>
                </div>
              ) : (
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-slate-800 leading-tight truncate max-w-[150px]">
                    {displayName}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">
                    {displayEmail}
                  </div>
                </div>
              )}

              {user.isPreview && onExitPreview ? (
                <button
                  onClick={onExitPreview}
                  className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 transition-colors text-xs flex items-center gap-1.5 cursor-pointer font-semibold"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Exit Preview</span>
                </button>
              ) : onLogout ? (
                <button
                  onClick={onLogout}
                  className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-600 hover:text-rose-600 transition-colors text-xs flex items-center gap-1.5 cursor-pointer font-semibold"
                  title="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Exit</span>
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

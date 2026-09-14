import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { UserAuth } from '../../types';
import { Building2, Bell, LogOut, PhoneCall, Eye, ArrowLeft } from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo';

interface ClientHeaderProps {
  user: UserAuth;
  onLogout: () => void;
  unreadNotifsCount: number;
  onOpenNotifications: () => void;
  onExitPreview?: () => void;
}

export const ClientHeader: React.FC<ClientHeaderProps> = ({
  user,
  onLogout,
  unreadNotifsCount,
  onOpenNotifications,
  onExitPreview
}) => {
  const [opsHotline, setOpsHotline] = useState<string>('+91 93216 40508');

  // Pull Ops Hotline dynamically from the organization settings Firestore doc
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'organization'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.opsHotline || data.hotline || data.phone || data.supportContact) {
          setOpsHotline(data.opsHotline || data.hotline || data.phone || data.supportContact);
        }
      }
    }, (err) => {
      console.warn('[ClientHeader] Organization settings listener:', err);
    });

    return () => unsub();
  }, []);

  return (
    <>
      {/* Admin Preview Mode Banner */}
      {user.isPreview && (
        <div className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-xs sticky top-0 z-50">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-slate-950 animate-pulse" />
              <span>
                <strong>Admin Preview Mode:</strong> Viewing client portal for <strong>{user.name}</strong> (Client ID: {user.clientId}).
              </span>
            </div>
            {onExitPreview && (
              <button
                type="button"
                onClick={onExitPreview}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Exit Preview & Return to Admin</span>
              </button>
            )}
          </div>
        </div>
      )}

      <header className={`sticky ${user.isPreview ? 'top-8' : 'top-0'} z-40 bg-white border-b border-slate-200 shadow-xs text-slate-900`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-4">
          {/* Client Brand Logo & Lab Name */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="h-8 w-auto flex items-center shrink-0">
              <BrandLogo className="h-8 w-auto" />
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-slate-900 text-white rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-slate-800 shadow-xs whitespace-nowrap">
                VIALTRACK | CLIENT DIAGNOSTIC PORTAL
              </span>
              <span className="hidden md:inline-block px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded text-[10px] sm:text-xs font-bold border border-emerald-200">
                {user.name.split('(')[0].trim()}
              </span>
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2.5 sm:gap-4">
            {/* Ops Support Hotline */}
            <a
              href={`tel:${opsHotline.replace(/\D/g, '')}`}
              className="hidden md:flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 hover:text-emerald-700 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors shadow-2xs"
              title={`Call Ops Hotline: ${opsHotline}`}
            >
              <PhoneCall className="w-3.5 h-3.5 text-emerald-600" />
              <span>Ops Hotline: <strong className="font-mono">{opsHotline}</strong></span>
            </a>

            {/* Notifications Button */}
            <button
              onClick={onOpenNotifications}
              className="relative p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              title="View Delivery Alerts & Pickup Updates"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifsCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-emerald-600 text-white font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
                  {unreadNotifsCount}
                </span>
              )}
            </button>

            {/* Client Profile Info & Exit */}
            <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-200">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-slate-800 leading-tight truncate max-w-[140px]">{user.email}</div>
                <div className="text-[10px] text-emerald-700 font-medium">{user.isPreview ? 'Preview Mode' : 'Verified Partner'}</div>
              </div>

              {user.isPreview && onExitPreview ? (
                <button
                  onClick={onExitPreview}
                  className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 transition-colors text-xs flex items-center gap-1.5 cursor-pointer font-semibold"
                  title="Exit Preview"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Exit Preview</span>
                </button>
              ) : (
                <button
                  onClick={onLogout}
                  className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-600 hover:text-rose-600 transition-colors text-xs flex items-center gap-1.5 cursor-pointer font-semibold"
                  title="Exit Client Portal"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Exit Lab</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
};

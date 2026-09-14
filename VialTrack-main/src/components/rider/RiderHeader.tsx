import React, { useState, useEffect } from 'react';
import { UserAuth, PickupBoy } from '../../types';
import { Bike, Bell, LogOut, Radio, Battery, BatteryCharging, Zap } from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo';
import { subscribeToBatteryChanges, DeviceBatteryInfo } from '../../utils/deviceBattery';

interface RiderHeaderProps {
  user: UserAuth;
  rider?: PickupBoy;
  onLogout: () => void;
  unreadNotifsCount: number;
  onOpenNotifications: () => void;
}

export const RiderHeader: React.FC<RiderHeaderProps> = ({
  user,
  rider,
  onLogout,
  unreadNotifsCount,
  onOpenNotifications
}) => {
  const isCheckedIn = rider?.isCheckedIn ?? true;
  const [batteryInfo, setBatteryInfo] = useState<DeviceBatteryInfo>({
    level: rider?.batteryLevel || 90,
    isCharging: false,
    supported: false
  });

  useEffect(() => {
    const unsub = subscribeToBatteryChanges((info) => {
      setBatteryInfo(info);
    });
    return unsub;
  }, []);

  const getBatteryColor = (level: number) => {
    if (level <= 20) return 'text-red-700 bg-red-50 border-red-200';
    if (level <= 45) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-slate-700 bg-slate-50 border-slate-200';
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs text-slate-900">
      {/* min-w-0 + shrink on the identity block, shrink-0 on the controls: previously the rider's
          name and duty badge were allowed to grow, so on a real phone the name wrapped to three
          lines and pushed the Exit button clean off the right edge of the screen. */}
      <div className="w-full max-w-md md:max-w-4xl mx-auto px-3 sm:px-6 min-h-14 sm:h-16 py-2 sm:py-0 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand Logo & Rider Identification */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="h-7 sm:h-8 w-auto flex items-center shrink-0">
            <BrandLogo size="sm" className="h-7 w-auto hidden md:inline-flex" />
          </div>

          <div className="relative">
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-sky-700 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 overflow-hidden border border-sky-600 shadow-xs">
              {rider?.photoUrl ? (
                <img
                  src={rider.photoUrl}
                  alt={rider.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Bike className="w-4 h-4 text-white" />
              )}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                isCheckedIn ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            ></span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-xs sm:text-sm font-bold text-slate-900 leading-tight truncate">
                {rider?.name || user.name}
              </h1>
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider shrink-0 whitespace-nowrap ${
                  isCheckedIn
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {isCheckedIn ? 'On Duty' : 'Off Shift'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono truncate">
              {rider?.vehicleNumber || rider?.plateNumber || 'Courier Partner'}
            </p>
          </div>
        </div>

        {/* Right Status & Exit */}
        <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
          {/* Live Device Battery Indicator */}
          <div
            className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-md border text-[11px] font-mono font-bold shrink-0 ${getBatteryColor(
              batteryInfo.level
            )}`}
            title={`Real-Time Device Battery: ${batteryInfo.level}% ${batteryInfo.isCharging ? '(Charging)' : ''}`}
          >
            {batteryInfo.isCharging ? (
              <Zap className="w-3 h-3 text-amber-500 fill-amber-500 animate-bounce" />
            ) : (
              <Battery className={`w-3.5 h-3.5 ${batteryInfo.level <= 20 ? 'text-red-600' : 'text-slate-600'}`} />
            )}
            <span>{batteryInfo.level}%</span>
          </div>

          {/* Signal & GPS Status */}
          <div className="hidden min-[380px]:flex items-center gap-1.5 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-medium shrink-0">
            <Radio className="w-3 h-3 text-emerald-600 animate-pulse" />
            <span className="hidden sm:inline">GPS Active</span>
          </div>

          {/* Notifications Button */}
          <button
            onClick={onOpenNotifications}
            className="relative p-1.5 sm:p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
            title="View Route & Dispatch Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifsCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-sky-600 text-white font-bold text-[9px] w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center shadow-xs">
                {unreadNotifsCount}
              </span>
            )}
          </button>

          {/* Exit / Logout / End Shift */}
          <button
            onClick={onLogout}
            className="p-2 sm:px-3 sm:py-1.5 rounded-lg bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-600 hover:text-rose-600 transition-colors text-xs flex items-center gap-1.5 cursor-pointer font-semibold shrink-0"
            title="Logout / End Shift"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-xs">Exit</span>
          </button>
        </div>
      </div>
    </header>
  );
};

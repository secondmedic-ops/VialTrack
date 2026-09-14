import React, { useState } from 'react';
import { NotificationLog, AlertType } from '../../types';
import { X, Bell, MessageSquare, PhoneCall, CheckCheck, Clock, ShieldAlert, Sparkles, Filter } from 'lucide-react';
import { StorageService } from '../../services/storage';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationLog[];
  onRefresh?: () => void;
  onMarkAllRead?: () => void;
  onClearAll?: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  notifications,
  onRefresh,
  onMarkAllRead,
  onClearAll
}) => {
  const [filter, setFilter] = useState<'all' | 'whatsapp' | 'sms' | 'system'>('all');

  if (!isOpen) return null;

  const handleMarkAllRead = () => {
    if (onMarkAllRead) {
      onMarkAllRead();
    } else {
      StorageService.markAllNotificationsRead();
      onRefresh?.();
    }
  };

  const handleClearAll = () => {
    if (onClearAll) {
      onClearAll();
    }
  };

  const filteredNotifs = notifications.filter((n) => {
    if (filter === 'all') return true;
    return n.channel === filter;
  });

  const getChannelBadge = (channel: string) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
            <MessageSquare className="w-3 h-3 text-emerald-600" /> WhatsApp
          </span>
        );
      case 'sms':
        return (
          <span className="bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
            <PhoneCall className="w-3 h-3 text-sky-600" /> SMS / Push
          </span>
        );
      default:
        return (
          <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200">
            System
          </span>
        );
    }
  };

  const getIconForType = (type: AlertType) => {
    switch (type) {
      case 'delay':
      case 'missed_slot':
      case 'temp_excursion':
        return <ShieldAlert className="w-4 h-4 text-amber-600" />;
      case 'drop_done':
        return <CheckCheck className="w-4 h-4 text-emerald-600" />;
      default:
        return <Bell className="w-4 h-4 text-sky-700" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
      <div className="w-full max-w-md bg-white border-l border-slate-200 h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-50 text-sky-700 border border-sky-200">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">Alerts & WhatsApp Log</h3>
              <p className="text-[11px] text-slate-500">Live operational dispatches & notifications</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                filter === 'all' ? 'bg-sky-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter('whatsapp')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                filter === 'whatsapp' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              WhatsApp
            </button>
            <button
              onClick={() => setFilter('sms')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                filter === 'sms' ? 'bg-sky-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              SMS / Push
            </button>
          </div>

          <button
            onClick={handleMarkAllRead}
            className="text-xs text-sky-700 hover:underline font-semibold cursor-pointer"
          >
            Mark all read
          </button>
        </div>

        {/* List of notifications */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filteredNotifs.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
              No notifications recorded yet.
            </div>
          ) : (
            filteredNotifs.map((notif) => (
              <div
                key={notif.id}
                className={`p-3.5 rounded-lg border transition-all ${
                  notif.read
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : 'bg-sky-50/50 border-sky-200 text-slate-900 shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    {getIconForType(notif.type)}
                    <span className="font-bold text-xs text-slate-900">{notif.title}</span>
                  </div>
                  {getChannelBadge(notif.channel)}
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">{notif.message}</p>

                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1 font-mono text-slate-500">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {new Date(notif.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Recipient: {notif.recipientRole}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 text-center font-medium">
          Automated WhatsApp & Push Engine for SecondMedic Logistics
        </div>
      </div>
    </div>
  );
};

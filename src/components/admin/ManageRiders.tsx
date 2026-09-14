import React, { useState, useMemo } from 'react';
import { PickupBoy, Route } from '../../types';
import {
  Bike,
  Plus,
  Edit2,
  Phone,
  Mail,
  Shield,
  MapPin,
  CheckCircle2,
  X,
  Copy,
  Share2,
  Smartphone,
  Battery,
  Radio,
  Calendar,
  AlertCircle,
  Search,
  Trash2,
  Clock,
  Car,
  Briefcase
} from 'lucide-react';
import { StorageService } from '../../services/storage';
import { db } from '../../services/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { isRiderLocationStale } from '../../services/locationService';
import { formatCredentialsMessage, copyTextToClipboard } from '../../utils/security';
import {
  evaluateRiderPunctuality,
  getRiderAppStatus,
  generateRiderWhatsAppAlertUrl
} from '../../utils/riderTelemetry';
import { MessageSquare } from 'lucide-react';
import { EditRiderModal } from './EditRiderModal';

interface ManageRidersProps {
  riders: PickupBoy[];
  routes: Route[];
  onRefresh: () => void;
}

export const ManageRiders: React.FC<ManageRidersProps> = ({ riders, routes, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddingRider, setIsAddingRider] = useState(false);
  const [editingRider, setEditingRider] = useState<PickupBoy | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [createdCredentialsModal, setCreatedCredentialsModal] = useState<{
    name: string;
    phone: string;
    email: string;
    password: string;
    portalUrl: string;
  } | null>(null);

  const getEmploymentBadge = (rider: PickupBoy) => {
    let empType = rider.employmentType;
    if (!empType && rider.shiftTimings) {
      const lower = rider.shiftTimings.toLowerCase();
      if (lower.includes('part-time') || lower.includes('part time')) empType = 'part_time';
      else if (lower.includes('stat') || lower.includes('demand')) empType = 'stat_on_demand';
      else empType = 'full_time';
    }
    if (!empType) empType = 'full_time';

    if (empType === 'part_time') {
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
          <Briefcase className="w-3 h-3 text-purple-600" /> Part-Time
        </span>
      );
    }
    if (empType === 'stat_on_demand') {
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
          <Briefcase className="w-3 h-3 text-amber-600" /> STAT / On-Demand
        </span>
      );
    }
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200 flex items-center gap-1">
        <Briefcase className="w-3 h-3 text-sky-600" /> Full-Time
      </span>
    );
  };

  const getShiftPill = (rider: PickupBoy) => {
    const timeText = (rider.shiftStart && rider.shiftEnd)
      ? `${rider.shiftStart} - ${rider.shiftEnd}`
      : (rider.shiftTimings || '08:00 AM - 04:00 PM');

    return (
      <span className="text-[10px] font-mono font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
        <Clock className="w-3 h-3 text-slate-500" />
        <span>{timeText}</span>
      </span>
    );
  };

  const handleDeleteRider = async (riderId: string, riderName: string) => {
    if (window.confirm(`Are you sure you want to remove rider "${riderName}" from the fleet?`)) {
      StorageService.deleteRider(riderId);
      try {
        await deleteDoc(doc(db, 'riders', riderId));
      } catch (err: any) {
        if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
          console.warn('Firestore quota exceeded; deleted rider locally.');
        } else {
          console.error("Firestore Write Error:", err);
        }
      }
      onRefresh();
    }
  };

  const filteredRiders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const seenIds = new Set<string>();
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();

    return riders.filter((r) => {
      if (!r || !r.id) return false;
      const cleanPhone = (r.phone || '').replace(/\D/g, '');
      const cleanEmail = (r.email || '').trim().toLowerCase();

      if (seenIds.has(r.id)) return false;
      if (cleanPhone && cleanPhone.length >= 8 && seenPhones.has(cleanPhone)) return false;
      if (cleanEmail && seenEmails.has(cleanEmail)) return false;

      seenIds.add(r.id);
      if (cleanPhone && cleanPhone.length >= 8) seenPhones.add(cleanPhone);
      if (cleanEmail) seenEmails.add(cleanEmail);

      if (!term) return true;
      return (
        (r.name && r.name.toLowerCase().includes(term)) ||
        (r.phone && r.phone.toLowerCase().includes(term)) ||
        (r.email && r.email.toLowerCase().includes(term)) ||
        (r.vehicleNumber && r.vehicleNumber.toLowerCase().includes(term)) ||
        (r.plateNumber && r.plateNumber.toLowerCase().includes(term))
      );
    });
  }, [riders, searchTerm]);

  const handleCopyFormattedCredentials = async (loginId: string, tempPassword: string) => {
    const text = formatCredentialsMessage({
      portalUrl: 'https://delvin-nadar.github.io/VialTrack/#/rider',
      loginId,
      tempPassword
    });
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    }
  };

  const handleCopyCredentialsInModal = async () => {
    if (createdCredentialsModal) {
      await handleCopyFormattedCredentials(
        createdCredentialsModal.phone || createdCredentialsModal.email,
        createdCredentialsModal.password
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-4 sm:p-5 rounded-xl shadow-xs">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <Bike className="w-5 h-5 text-sky-700" />
            <span>Manage Pickup Boys (Riders Fleet)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Create rider login credentials, assign collection routes, and monitor live fleet connectivity. No public self-registration.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingRider(null);
            setIsAddingRider(true);
          }}
          className="px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Pickup Boy</span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-xs flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search riders by name, phone, email, or vehicle number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-sky-600 outline-hidden"
          />
        </div>
        <span className="text-xs text-slate-500 font-medium whitespace-nowrap hidden sm:inline">
          {filteredRiders.length} of {riders.length} Riders Active
        </span>
      </div>

      {/* Riders Grid */}
      {filteredRiders.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Bike className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">0 Active Fleet Riders</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No delivery riders are registered or online. Click &quot;Add New Pickup Boy&quot; above to onboard your fleet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRiders.map((rider) => {
            const assignedRouteIds = Array.isArray(rider?.assignedRouteIds) ? rider.assignedRouteIds : [];
            const assignedRoutes = routes.filter((r) => assignedRouteIds.includes(r.id));
            const punctuality = evaluateRiderPunctuality(rider, routes);
            const appStatus = getRiderAppStatus(rider);
            const whatsappUrl = generateRiderWhatsAppAlertUrl(
              rider,
              punctuality.isOverdue ? 'overdue_alert' : 'punch_in_reminder',
              punctuality.routeName,
              punctuality.firstSlot
            );

            return (
              <div
                key={rider.id}
                className={`bg-white border rounded-xl p-4.5 shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-all ${
                  punctuality.isOverdue ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                }`}
              >
                <div>
                  {/* Rider Photo & Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {rider.photoUrl ? (
                        <img
                          src={rider.photoUrl}
                          alt={rider.name}
                          className="w-11 h-11 rounded-lg object-cover border border-slate-200 shadow-xs"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                      {!rider.photoUrl && (
                        <div className="w-11 h-11 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center font-bold text-sm border border-sky-200 shadow-xs">
                          {rider.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{rider.name}</h4>
                        <p className="text-xs text-sky-700 font-mono font-medium">{rider.vehicleNumber}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {getEmploymentBadge(rider)}
                          {getShiftPill(rider)}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${appStatus.badgeClass}`}>
                        {appStatus.label}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                          isRiderLocationStale(rider, 10)
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1'
                        }`}
                      >
                        {!isRiderLocationStale(rider, 10) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>}
                        {isRiderLocationStale(rider, 10) ? 'GPS Stale / Offline' : 'Live GPS Broadcast'}
                      </span>
                    </div>
                  </div>

                  {/* Punch-In Punctuality & Route Readiness Bar */}
                  <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 font-semibold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-sky-700" />
                        <span>1st Route Slot:</span>
                      </span>
                      <span className="font-bold text-slate-800 font-mono">
                        {punctuality.firstSlot || 'No scheduled slot'}
                      </span>
                    </div>
                    <div className="pt-1 border-t border-slate-200/60 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-semibold">Duty Punch-In:</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md border ${punctuality.badgeClass}`}>
                        {punctuality.label}
                      </span>
                    </div>
                  </div>

                  {/* Contact & Live Telemetry Info */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase">Phone:</span>
                      <span className="font-mono text-slate-800 font-medium">{rider.phone}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase">Battery & Speed:</span>
                      <span className="font-mono font-semibold text-slate-700 flex items-center gap-1">
                        <Battery className="w-3.5 h-3.5 text-slate-600" /> {rider.batteryLevel || 88}% • {rider.speed || 0} km/h
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase">GPS Coordinates:</span>
                      <span className="font-mono text-slate-700 text-[11px] truncate block">
                        {rider.currentLocation?.lat ? `${Number(rider.currentLocation.lat).toFixed(4)}, ${Number(rider.currentLocation.lng).toFixed(4)} (±${rider.currentLocation.accuracy || 5}m)` : 'Broadcasting on route start'}
                      </span>
                    </div>
                  </div>

                  {/* Assigned Routes */}
                  <div className="mt-3 space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Assigned Collection Routes:
                    </span>
                    {assignedRoutes.length === 0 ? (
                      <span className="text-xs text-slate-400 italic">No routes currently assigned</span>
                    ) : (
                      <div className="space-y-1">
                        {assignedRoutes.map((r) => (
                          <div
                            key={r.id}
                            className="text-xs bg-slate-50 text-slate-800 px-2.5 py-1 rounded-md border border-slate-200 flex items-center justify-between"
                          >
                            <span className="truncate">{r.name}</span>
                            <span className="text-[10px] text-sky-700 font-mono shrink-0 ml-1 font-semibold">
                              {r.stops.length} Stops
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions & Corrective WhatsApp */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5 text-xs flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <a
                      href={`tel:${rider.phone}`}
                      className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold flex items-center gap-1 border border-slate-300 transition-colors"
                      title="Call Rider"
                    >
                      <Phone className="w-3.5 h-3.5 text-sky-700" />
                      <span>Call</span>
                    </a>

                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold flex items-center gap-1 shadow-xs transition-colors"
                      title="Send WhatsApp Alert"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => handleCopyFormattedCredentials(rider.phone || rider.email, rider.password || '')}
                      className="px-2 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg font-bold flex items-center gap-1 transition-colors border border-sky-200 cursor-pointer"
                      title="Copy formatted credentials text to clipboard"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copySuccess ? 'Copied' : 'Credentials'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingRider(rider);
                        setIsAddingRider(true);
                      }}
                      className="px-2 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg font-semibold flex items-center gap-1 transition-colors border border-slate-200 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-sky-700" />
                      <span>Edit</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteRider(rider.id, rider.name)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                    title="Remove Rider from Fleet"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
      </div>
      )}

      {/* Add / Edit Rider Modal */}
      <EditRiderModal
        isOpen={isAddingRider}
        rider={editingRider}
        routes={routes}
        onClose={() => {
          setIsAddingRider(false);
          setEditingRider(null);
        }}
        onSaved={(createdCredentials) => {
          onRefresh();
          if (createdCredentials) {
            setCreatedCredentialsModal({
              ...createdCredentials,
              portalUrl: 'https://delvin-nadar.github.io/VialTrack/#/rider'
            });
          }
        }}
      />

      {/* Share Created Credentials Modal */}
      {createdCredentialsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Rider Credentials Generated</h3>
                <p className="text-xs text-slate-500">Provide these credentials for mobile PWA login</p>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs space-y-2">
              <div>
                <span className="text-slate-400 block text-[10px] font-semibold uppercase">Rider Name:</span>
                <span className="font-bold text-slate-900 text-sm">{createdCredentialsModal.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] font-semibold uppercase">Portal URL:</span>
                <code className="text-sky-700 font-mono font-semibold break-all">{createdCredentialsModal.portalUrl}</code>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] font-semibold uppercase">Login ID (Phone):</span>
                  <span className="font-mono text-slate-800 font-bold">{createdCredentialsModal.phone}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-semibold uppercase">Temporary Password:</span>
                  <span className="font-mono text-emerald-700 font-bold">{createdCredentialsModal.password}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCopyCredentialsInModal}
                className="flex-1 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>{copySuccess ? 'Copied to Clipboard!' : 'Copy Credentials'}</span>
              </button>
              <button
                type="button"
                onClick={() => setCreatedCredentialsModal(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

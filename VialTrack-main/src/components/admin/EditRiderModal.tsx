import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PickupBoy, Route, RiderStatus, EmploymentType, ShiftType } from '../../types';
import {
  Bike,
  X,
  Camera,
  KeyRound,
  RefreshCw,
  Clock,
  Car,
  AlertCircle,
  Check,
  Briefcase,
  SlidersHorizontal,
  Sun,
  Sunset,
  Eye,
  EyeOff,
  Copy
} from 'lucide-react';
import { StorageService } from '../../services/storage';
import { compressImageToBase64 } from '../../services/imageWatermark';
import { generateStrongPassword } from '../../utils/security';
import { db, provisionRiderAccount, removeLegacyPassword } from '../../services/firebase';
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';

interface EditRiderModalProps {
  isOpen: boolean;
  rider: PickupBoy | null;
  routes: Route[];
  onClose: () => void;
  onSaved: (createdCredentials?: { name: string; phone: string; email: string; password: string }) => void;
}

export interface ShiftPreset {
  id: string;
  label: string;
  badge: string;
  employmentType: EmploymentType;
  shiftType: ShiftType;
  start: string;
  end: string;
}

export const SHIFT_PRESETS: ShiftPreset[] = [
  {
    id: 'ft_morning',
    label: 'Full-Time Morning',
    badge: '08:00 AM - 04:00 PM',
    employmentType: 'full_time',
    shiftType: 'morning',
    start: '08:00 AM',
    end: '04:00 PM'
  },
  {
    id: 'ft_general',
    label: 'Full-Time General',
    badge: '09:00 AM - 06:00 PM',
    employmentType: 'full_time',
    shiftType: 'morning',
    start: '09:00 AM',
    end: '06:00 PM'
  },
  {
    id: 'ft_afternoon',
    label: 'Full-Time Afternoon',
    badge: '12:00 PM - 08:00 PM',
    employmentType: 'full_time',
    shiftType: 'afternoon',
    start: '12:00 PM',
    end: '08:00 PM'
  },
  {
    id: 'pt_morning',
    label: 'Part-Time Morning',
    badge: '07:00 AM - 12:00 PM',
    employmentType: 'part_time',
    shiftType: 'morning',
    start: '07:00 AM',
    end: '12:00 PM'
  },
  {
    id: 'pt_evening',
    label: 'Part-Time Evening',
    badge: '04:00 PM - 09:00 PM',
    employmentType: 'part_time',
    shiftType: 'evening',
    start: '04:00 PM',
    end: '09:00 PM'
  },
  {
    id: 'stat_peak',
    label: 'STAT Peak Hours',
    badge: '09:00 AM - 02:00 PM',
    employmentType: 'stat_on_demand',
    shiftType: 'morning',
    start: '09:00 AM',
    end: '02:00 PM'
  },
  {
    id: 'stat_evening',
    label: 'STAT Evening Surge',
    badge: '05:00 PM - 10:00 PM',
    employmentType: 'stat_on_demand',
    shiftType: 'evening',
    start: '05:00 PM',
    end: '10:00 PM'
  }
];

export function compileShiftTimings(
  empType: EmploymentType,
  start: string,
  end: string
): string {
  const empLabel =
    empType === 'full_time'
      ? 'Full-Time'
      : empType === 'part_time'
      ? 'Part-Time'
      : 'STAT / On-Demand';
  if (!start && !end) return empLabel;
  return `${empLabel} (${start || '--'} - ${end || '--'})`;
}

export function formatTime24to12(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const hDisplay = h < 10 ? `0${h}` : `${h}`;
  return `${hDisplay}:${m} ${ampm}`;
}

export function formatTime12to24(time12: string): string {
  if (!time12) return '08:00';
  const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return '08:00';
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = (match[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${h < 10 ? `0${h}` : `${h}`}:${m}`;
}

export const EditRiderModal: React.FC<EditRiderModalProps> = ({
  isOpen,
  rider,
  routes,
  onClose,
  onSaved
}) => {
  const [formError, setFormError] = useState<string | null>(null);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const [dbRoutes, setDbRoutes] = useState<Route[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(true);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setIsLoadingRoutes(true);

    const fetchLiveRoutes = async () => {
      try {
        const snap = await getDocs(collection(db, 'routes'));
        if (!isMounted) return;
        const fetched: Route[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any)
        }));
        setDbRoutes(fetched);
      } catch (err) {
        console.warn('[EditRiderModal] Error fetching live routes from Firestore:', err);
        if (isMounted) {
          setDbRoutes(routes || []);
        }
      } finally {
        if (isMounted) {
          setIsLoadingRoutes(false);
        }
      }
    };

    fetchLiveRoutes();
    return () => {
      isMounted = false;
    };
  }, [isOpen, routes]);

  const availableRoutes = useMemo(() => {
    if (dbRoutes.length > 0) return dbRoutes;
    return routes || [];
  }, [dbRoutes, routes]);

  const [form, setForm] = useState<{
    name: string;
    phone: string;
    email: string;
    password: string;
    plateNumber: string;
    vehicleNumber: string;
    vehicleType: string;
    employmentType: EmploymentType;
    shiftType: ShiftType;
    shiftStart: string;
    shiftEnd: string;
    shiftTimings: string;
    selectedPresetId: string;
    assignedRouteIds: string[];
    status: RiderStatus;
    photoUrl: string;
  }>({
    name: '',
    phone: '',
    email: '',
    password: '',
    plateNumber: '',
    vehicleNumber: '',
    vehicleType: 'Motorcycle / Bike',
    employmentType: 'full_time',
    shiftType: 'morning',
    shiftStart: '08:00 AM',
    shiftEnd: '04:00 PM',
    shiftTimings: 'Full-Time (08:00 AM - 04:00 PM)',
    selectedPresetId: 'ft_morning',
    assignedRouteIds: [],
    status: 'active',
    photoUrl: ''
  });

  useEffect(() => {
    if (rider) {
      const initialAssignedRoutes = Array.isArray(rider.assignedRouteIds) ? rider.assignedRouteIds : [];
      
      let empType: EmploymentType = rider.employmentType || 'full_time';
      if (!rider.employmentType && rider.shiftTimings) {
        const lower = rider.shiftTimings.toLowerCase();
        if (lower.includes('part-time') || lower.includes('part time')) empType = 'part_time';
        else if (lower.includes('stat') || lower.includes('demand')) empType = 'stat_on_demand';
      }

      const sStart = rider.shiftStart || '08:00 AM';
      const sEnd = rider.shiftEnd || '04:00 PM';
      const sType = rider.shiftType || 'morning';
      
      const matchedPreset = SHIFT_PRESETS.find(
        (p) => p.employmentType === empType && p.start === sStart && p.end === sEnd
      );

      const compiled = rider.shiftTimings || compileShiftTimings(empType, sStart, sEnd);

      setForm({
        name: rider.name || '',
        phone: rider.phone || '',
        email: rider.email || '',
        password: rider.password || '',
        plateNumber: rider.plateNumber || rider.vehicleNumber || '',
        vehicleNumber: rider.vehicleNumber || rider.plateNumber || '',
        vehicleType: rider.vehicleType || 'Motorcycle / Bike',
        employmentType: empType,
        shiftType: sType,
        shiftStart: sStart,
        shiftEnd: sEnd,
        shiftTimings: compiled,
        selectedPresetId: matchedPreset ? matchedPreset.id : 'custom',
        assignedRouteIds: initialAssignedRoutes,
        status: rider.status || 'active',
        photoUrl: rider.photoUrl || ''
      });
    } else {
      setForm({
        name: '',
        phone: '',
        email: '',
        password: generateStrongPassword(8),
        plateNumber: '',
        vehicleNumber: '',
        vehicleType: 'Motorcycle / Bike',
        employmentType: 'full_time',
        shiftType: 'morning',
        shiftStart: '08:00 AM',
        shiftEnd: '04:00 PM',
        shiftTimings: 'Full-Time (08:00 AM - 04:00 PM)',
        selectedPresetId: 'ft_morning',
        assignedRouteIds: [],
        status: 'active',
        photoUrl: ''
      });
    }
    setFormError(null);
  }, [rider, isOpen]);

  if (!isOpen) return null;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressingPhoto(true);
    try {
      const base64 = await compressImageToBase64(file, 800, 0.6);
      setForm((prev) => ({ ...prev, photoUrl: base64 }));
    } catch (err) {
      console.error('Failed to compress rider photo:', err);
      setFormError('Could not process rider photo image.');
    } finally {
      setIsCompressingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleGeneratePassword = () => {
    const strong = generateStrongPassword(8);
    setForm((prev) => ({ ...prev, password: strong }));
    setFormError(null);
  };

  const handleEmploymentTypeChange = (newEmpType: EmploymentType) => {
    const matchingPreset = SHIFT_PRESETS.find((p) => p.employmentType === newEmpType);
    if (matchingPreset) {
      setForm((prev) => ({
        ...prev,
        employmentType: newEmpType,
        shiftType: matchingPreset.shiftType,
        shiftStart: matchingPreset.start,
        shiftEnd: matchingPreset.end,
        shiftTimings: compileShiftTimings(newEmpType, matchingPreset.start, matchingPreset.end),
        selectedPresetId: matchingPreset.id
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        employmentType: newEmpType,
        shiftType: 'custom',
        shiftTimings: compileShiftTimings(newEmpType, prev.shiftStart, prev.shiftEnd),
        selectedPresetId: 'custom'
      }));
    }
  };

  const handlePresetSelect = (preset: ShiftPreset) => {
    setForm((prev) => ({
      ...prev,
      employmentType: preset.employmentType,
      shiftType: preset.shiftType,
      shiftStart: preset.start,
      shiftEnd: preset.end,
      shiftTimings: compileShiftTimings(preset.employmentType, preset.start, preset.end),
      selectedPresetId: preset.id
    }));
  };

  const handleCustomTimeChange = (type: 'start' | 'end', value24: string) => {
    const formatted12 = formatTime24to12(value24);
    setForm((prev) => {
      const newStart = type === 'start' ? formatted12 : prev.shiftStart;
      const newEnd = type === 'end' ? formatted12 : prev.shiftEnd;
      return {
        ...prev,
        shiftStart: newStart,
        shiftEnd: newEnd,
        shiftType: 'custom',
        selectedPresetId: 'custom',
        shiftTimings: compileShiftTimings(prev.employmentType, newStart, newEnd)
      };
    });
  };

  const handleToggleRoute = (routeId: string) => {
    setForm((prev) => {
      const currentIds = Array.isArray(prev.assignedRouteIds) ? prev.assignedRouteIds : [];
      const exists = currentIds.includes(routeId);
      return {
        ...prev,
        assignedRouteIds: exists
          ? currentIds.filter((id) => id !== routeId)
          : [...currentIds, routeId]
      };
    });
  };

  // Gives this rider a real, secure Firebase Auth login the moment they're saved -- instead of
  // only ever getting one the next time someone clicks the bulk "Migrate Accounts" button. Once
  // that succeeds, the plaintext password Firestore doc field is no longer needed for this rider,
  // so it's removed right away (removeLegacyPassword double-checks the account really is migrated
  // before touching anything, so this can never strip a rider's only working login). Both steps
  // are best-effort and never block the save that already happened -- if either fails, the
  // plaintext password already written stays in place as a working fallback, and the admin is
  // told so they can retry from the rider's row later.
  const provisionAndCleanupRiderAccount = async (riderId: string, phone: string, password: string, name: string) => {
    const provisionResult = await provisionRiderAccount({ riderId, phone, password, displayName: name });
    if (!provisionResult.success) {
      console.warn(`[EditRiderModal] Could not provision a secure login for ${name}:`, provisionResult.message);
      window.alert(
        `${name} was saved, but setting up their secure login failed (their old password/PIN still works). ` +
        `You can retry by editing and re-saving this rider once your connection is stable.\n\nDetails: ${provisionResult.message || 'unknown error'}`
      );
      return;
    }
    await removeLegacyPassword({ role: 'rider', id: riderId });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = form.name.trim();
    const cleanPhone = form.phone.trim();

    if (!cleanName) {
      setFormError('Rider full name is required.');
      return;
    }

    if (!cleanPhone) {
      setFormError('Phone number is required.');
      return;
    }

    if (!rider && (!form.password || form.password.length < 4)) {
      setFormError('Please enter a password/PIN of at least 4 characters for the new rider.');
      return;
    }

    if (rider && form.password.trim() && form.password.trim().length < 4) {
      setFormError('New password must be at least 4 characters long.');
      return;
    }

    const effectivePlate = form.plateNumber.trim() || form.vehicleNumber.trim();
    const effectiveVehicleType = form.vehicleType || 'Motorcycle / Bike';

    if (rider) {
      const newPasswordTyped = form.password.trim();
      const preservedPassword = newPasswordTyped ? newPasswordTyped : (rider.password || generateStrongPassword(8));

      const updatedRider: PickupBoy = {
        ...rider,
        name: cleanName,
        phone: cleanPhone,
        email: form.email.trim() || `${cleanName.toLowerCase().replace(/\s+/g, '.')}@vialtrack.in`,
        password: preservedPassword,
        plateNumber: effectivePlate,
        vehicleNumber: effectivePlate,
        vehicleType: effectiveVehicleType,
        employmentType: form.employmentType,
        shiftType: form.shiftType,
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
        shiftTimings: form.shiftTimings,
        assignedRouteIds: form.assignedRouteIds,
        status: form.status,
        photoUrl: form.photoUrl,
        mustChangePassword: false,
        failedAttempts: 0,
        lockoutUntil: undefined
      };

      StorageService.updateRider(updatedRider);

      try {
        const firestorePayload: any = {
          id: updatedRider.id,
          name: updatedRider.name,
          phone: updatedRider.phone,
          email: updatedRider.email,
          password: preservedPassword,
          vehicleNo: effectivePlate,
          vehicleNumber: effectivePlate,
          vehiclePlate: effectivePlate,
          vehicleType: effectiveVehicleType,
          status: updatedRider.status,
          employmentType: updatedRider.employmentType,
          shiftType: updatedRider.shiftType,
          shiftStart: updatedRider.shiftStart,
          shiftEnd: updatedRider.shiftEnd,
          shiftTimings: updatedRider.shiftTimings,
          assignedRouteIds: updatedRider.assignedRouteIds,
          photoUrl: updatedRider.photoUrl,
          isOnline: true,
          isCheckedIn: true,
          failedAttempts: 0,
          lockoutUntil: null,
          lastUpdated: serverTimestamp()
        };

        await setDoc(doc(db, 'riders', updatedRider.id), firestorePayload, { merge: true });
        await provisionAndCleanupRiderAccount(updatedRider.id, updatedRider.phone, preservedPassword, updatedRider.name);
      } catch (err: any) {
        if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
          console.warn('Firestore quota exceeded; updated rider locally.');
        } else {
          console.error('Firestore Write Error:', err);
        }
      }

      onSaved();
      onClose();
    } else {
      const existingRiders = StorageService.getRiders();
      const existingRider = existingRiders.find(
        (r) =>
          (cleanPhone && cleanPhone.length >= 8 && r.phone && r.phone.replace(/\D/g, '') === cleanPhone.replace(/\D/g, '')) ||
          (form.email.trim() && r.email && r.email.toLowerCase() === form.email.trim().toLowerCase())
      );

      const riderId = existingRider ? existingRider.id : `rider-${cleanPhone.replace(/\D/g, '') || Date.now()}`;
      const riderEmail = form.email.trim() || `${cleanName.toLowerCase().replace(/\s+/g, '.')}@vialtrack.in`;
      const effectivePassword = form.password.trim() || existingRider?.password || generateStrongPassword(8);

      const newRider: PickupBoy = {
        id: riderId,
        name: cleanName,
        phone: cleanPhone,
        email: riderEmail,
        password: effectivePassword,
        role: 'rider',
        plateNumber: effectivePlate,
        vehicleNumber: effectivePlate,
        vehicleType: effectiveVehicleType,
        employmentType: form.employmentType,
        shiftType: form.shiftType,
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
        shiftTimings: form.shiftTimings,
        photoUrl: form.photoUrl,
        assignedRouteIds: form.assignedRouteIds,
        status: 'active',
        mustChangePassword: false,
        failedAttempts: 0,
        joiningDate: new Date().toISOString().split('T')[0],
        currentLocation: {
          lat: 19.1287,
          lng: 72.8294,
          timestamp: new Date().toISOString(),
          accuracy: 5
        },
        batteryLevel: 100,
        isOnline: true,
        isCheckedIn: true
      };

      StorageService.addRider(newRider);

      try {
        await setDoc(
          doc(db, 'riders', newRider.id),
          {
            id: newRider.id,
            name: newRider.name,
            phone: newRider.phone,
            email: newRider.email,
            password: effectivePassword,
            vehicleNo: effectivePlate,
            vehicleNumber: effectivePlate,
            vehiclePlate: effectivePlate,
            vehicleType: effectiveVehicleType,
            employmentType: newRider.employmentType,
            shiftType: newRider.shiftType,
            shiftStart: newRider.shiftStart,
            shiftEnd: newRider.shiftEnd,
            shiftTimings: newRider.shiftTimings,
            battery: 100,
            isOnline: true,
            isCheckedIn: true,
            status: 'active',
            assignedRouteIds: newRider.assignedRouteIds,
            photoUrl: newRider.photoUrl,
            lastUpdated: serverTimestamp()
          },
          { merge: true }
        );
        await provisionAndCleanupRiderAccount(newRider.id, newRider.phone, effectivePassword, newRider.name);
      } catch (err: any) {
        if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
          console.warn('Firestore quota exceeded; saved rider locally.');
        } else {
          console.error('Firestore Write Error:', err);
        }
      }

      onSaved({
        name: cleanName,
        phone: cleanPhone,
        email: riderEmail,
        password: effectivePassword
      });
      onClose();
    }
  };

  const filteredPresets = SHIFT_PRESETS.filter((p) => p.employmentType === form.employmentType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn overflow-y-auto">
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden my-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center">
              <Bike className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                {rider ? `Edit Rider: ${rider.name}` : 'Onboard New Pickup Boy'}
              </h3>
              <p className="text-[11px] text-slate-500">
                Configure profile, credentials, shift timing, and assigned routes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                {form.photoUrl ? (
                  <img src={form.photoUrl} alt="Rider" className="w-full h-full object-cover" />
                ) : (
                  <Bike className="w-8 h-8 text-slate-400" />
                )}
              </div>
              <input
                ref={photoFileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => photoFileInputRef.current?.click()}
                disabled={isCompressingPhoto}
                className="absolute -bottom-1.5 -right-1.5 p-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-full shadow-md cursor-pointer transition-transform hover:scale-105"
                title="Upload Photo"
              >
                {isCompressingPhoto ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Camera className="w-3 h-3" />
                )}
              </button>
            </div>

            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                  Rider Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Full Name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold focus:outline-hidden focus:border-sky-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                    Phone Number (Login ID) *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="9820011223"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-hidden focus:border-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="ramesh@vialtrack.in"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-slate-700 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-sky-700" />
                <span>{rider ? 'Rider Password / PIN' : 'Rider Login Password / PIN *'}</span>
              </label>
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="text-[10px] text-sky-700 hover:text-sky-900 font-bold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Generate Strong Password</span>
              </button>
            </div>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={rider ? 'Enter or reset password' : 'Enter or generate password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full pl-3 pr-20 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-sm focus:outline-hidden focus:border-sky-600"
              />
              <div className="absolute right-2 flex items-center gap-1">
                {form.password && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(form.password);
                      setCopiedPassword(true);
                      setTimeout(() => setCopiedPassword(false), 2000);
                    }}
                    className="p-1 text-slate-500 hover:text-slate-700 cursor-pointer rounded"
                    title="Copy password"
                  >
                    {copiedPassword ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-slate-500 hover:text-slate-700 cursor-pointer rounded"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 flex items-center justify-between">
              <span>{rider ? 'Visible to admin. Modify to reset rider password & immediately unlock account.' : 'Enter a strong password or 4-6 digit security PIN for the rider to log into the Rider Portal.'}</span>
              {copiedPassword && <span className="text-emerald-700 font-semibold">Copied to clipboard!</span>}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px] flex items-center gap-1">
                <Car className="w-3.5 h-3.5 text-slate-500" />
                <span>Vehicle Plate Number *</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. MH-02-AB-1234"
                value={form.plateNumber || form.vehicleNumber}
                onChange={(e) => setForm({ ...form, plateNumber: e.target.value, vehicleNumber: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono uppercase focus:outline-hidden focus:border-sky-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px] flex items-center gap-1">
                <Bike className="w-3.5 h-3.5 text-slate-500" />
                <span>Vehicle Type</span>
              </label>
              <select
                value={form.vehicleType}
                onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-hidden focus:border-sky-600"
              >
                <option value="Motorcycle / Bike">Motorcycle / Bike (Cold-Box Mounted)</option>
                <option value="Scooter / Scooty">Scooter / Scooty</option>
                <option value="Electric EV 2-Wheeler">Electric EV 2-Wheeler</option>
              </select>
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <label className="text-slate-800 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-sky-700" />
                <span>Employment & Shift Timings</span>
              </label>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                {form.shiftTimings}
              </span>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1.5 text-[11px]">
                1. Employment Model *
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleEmploymentTypeChange('full_time')}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    form.employmentType === 'full_time'
                      ? 'bg-sky-50 border-sky-600 text-sky-950 shadow-xs ring-1 ring-sky-600'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">Full-Time</span>
                    {form.employmentType === 'full_time' && <Check className="w-3.5 h-3.5 text-sky-700" />}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5">8–9 hr Standard</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleEmploymentTypeChange('part_time')}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    form.employmentType === 'part_time'
                      ? 'bg-purple-50 border-purple-600 text-purple-950 shadow-xs ring-1 ring-purple-600'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">Part-Time</span>
                    {form.employmentType === 'part_time' && <Check className="w-3.5 h-3.5 text-purple-700" />}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5">4–5 hr Slots</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleEmploymentTypeChange('stat_on_demand')}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    form.employmentType === 'stat_on_demand'
                      ? 'bg-amber-50 border-amber-600 text-amber-950 shadow-xs ring-1 ring-amber-600'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">STAT / On-Demand</span>
                    {form.employmentType === 'stat_on_demand' && <Check className="w-3.5 h-3.5 text-amber-700" />}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5">Flexible / Peak</span>
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-600 font-semibold text-[11px] flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>2. Shift Slot Presets & Working Hours *</span>
                </label>
                {form.selectedPresetId === 'custom' && (
                  <span className="text-[10px] font-semibold text-sky-700 flex items-center gap-1">
                    <SlidersHorizontal className="w-3 h-3" /> Custom Time Range Active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2.5">
                {filteredPresets.map((preset) => {
                  const isSelected = form.selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handlePresetSelect(preset)}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-sky-50 border-sky-600 text-sky-950 font-bold ring-1 ring-sky-600'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {preset.shiftType === 'morning' && <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        {preset.shiftType === 'afternoon' && <Sun className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                        {preset.shiftType === 'evening' && <Sunset className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                        <div>
                          <p className="text-xs font-semibold">{preset.label}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{preset.badge}</p>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-sky-700 shrink-0 ml-1" />}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({
                      ...prev,
                      shiftType: 'custom',
                      selectedPresetId: 'custom',
                      shiftTimings: compileShiftTimings(prev.employmentType, prev.shiftStart, prev.shiftEnd)
                    }));
                  }}
                  className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between ${
                    form.selectedPresetId === 'custom'
                      ? 'bg-sky-50 border-sky-600 text-sky-950 font-bold ring-1 ring-sky-600'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">Custom Time Range</p>
                      <p className="text-[10px] text-slate-500">Pick exact start & end time</p>
                    </div>
                  </div>
                  {form.selectedPresetId === 'custom' && <Check className="w-4 h-4 text-sky-700 shrink-0 ml-1" />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-white p-2.5 rounded-lg border border-slate-200">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1 text-[10px] uppercase tracking-wider">
                    Shift Start Time
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={formatTime12to24(form.shiftStart)}
                      onChange={(e) => handleCustomTimeChange('start', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md text-xs font-mono font-semibold text-slate-900 focus:outline-hidden focus:border-sky-600"
                    />
                    <span className="text-[11px] font-mono text-slate-600 whitespace-nowrap">{form.shiftStart}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1 text-[10px] uppercase tracking-wider">
                    Shift End Time
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={formatTime12to24(form.shiftEnd)}
                      onChange={(e) => handleCustomTimeChange('end', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md text-xs font-mono font-semibold text-slate-900 focus:outline-hidden focus:border-sky-600"
                    />
                    <span className="text-[11px] font-mono text-slate-600 whitespace-nowrap">{form.shiftEnd}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1.5 text-[11px]">
              Assign Collection Routes ({(form.assignedRouteIds || []).length} Selected)
            </label>
            <div className="space-y-1 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200">
              {isLoadingRoutes ? (
                <div className="py-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
                  <span>Loading routes from database...</span>
                </div>
              ) : availableRoutes.length === 0 ? (
                <div className="py-4 text-center text-slate-400 text-xs">
                  <span>No routes created in system yet.</span>
                </div>
              ) : (
                availableRoutes.map((r) => {
                  const isChecked = (form.assignedRouteIds || []).includes(r.id);
                  return (
                    <label
                      key={r.id}
                      className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                        isChecked ? 'bg-sky-50 border border-sky-200 text-sky-900' : 'hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleRoute(r.id)}
                          className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                        />
                        <span className="font-semibold">{r.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">{r.stops?.length || 0} Stops</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
              Rider Operational Status
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as RiderStatus })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
            >
              <option value="active">Active & Available for Rounds</option>
              <option value="on_leave">On Leave / Sick</option>
              <option value="inactive">Inactive / Deactivated</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-lg font-bold transition-all shadow-xs cursor-pointer"
            >
              {rider ? 'Save Changes' : 'Create Rider Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
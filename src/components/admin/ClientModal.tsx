import React, { useState } from 'react';
import { Client } from '../../types';
import { normalizeLatLng } from '../../utils/coordinates';
import { generateStrongPassword } from '../../utils/security';
import {
  X,
  Building2,
  Lock,
  RefreshCw,
  MapPin,
  CheckCircle2,
  IndianRupee,
  Phone,
  Mail,
  User
} from 'lucide-react';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveClient: (clientData: Partial<Client>) => void;
  client?: Client | null;
}

export const ClientModal: React.FC<ClientModalProps> = ({
  isOpen,
  onClose,
  onSaveClient,
  client
}) => {
  const [name, setName] = useState(client?.name || '');
  const [contactPerson, setContactPerson] = useState(client?.contactPerson || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [email, setEmail] = useState(client?.email || '');
  const [password, setPassword] = useState(client?.password || generateStrongPassword(9));
  const [address, setAddress] = useState(client?.address || '');
  const [lat, setLat] = useState<number | string>(client?.lat ?? '');
  const [lng, setLng] = useState<number | string>(client?.lng ?? '');
  const [billingRate, setBillingRate] = useState<number | string>(client?.billingRatePerPickup || '');
  const [active, setActive] = useState<boolean>(client?.active ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGeneratePassword = () => {
    setPassword(generateStrongPassword(9));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Client Diagnostic Center Name is required.');
      return;
    }

    const [vLat, vLng] = normalizeLatLng(lat, lng, 19.1287852, 72.8294183);

    onSaveClient({
      id: client?.id || `client-${Date.now()}`,
      name: name.trim(),
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim(),
      password,
      address: address.trim(),
      lat: Number(vLat),
      lng: Number(vLng),
      billingRatePerPickup: Number(billingRate) || 0,
      active,
      role: 'client'
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl space-y-4 my-6 max-h-[92vh] overflow-y-auto p-5 sm:p-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5 text-sky-700" />
              <span>{client ? `Edit Client: ${client.name}` : 'Register Diagnostic Client'}</span>
            </h3>
            <p className="text-xs text-slate-500">
              Diagnostic laboratory and hospital partner intake account.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
              Diagnostic Center / Hospital Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Lifecare Diagnostic Hub (Andheri West)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:bg-white focus:border-sky-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Contact Person / In-charge
              </label>
              <input
                type="text"
                placeholder="Dr. Lab Coordinator"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-sky-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Contact Phone
              </label>
              <input
                type="text"
                placeholder="+91 98200 33445"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono focus:bg-white focus:border-sky-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Account Email / Login
              </label>
              <input
                type="email"
                placeholder="ops@clientfacility.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-sky-700"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Portal Password
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono focus:bg-white focus:border-sky-700"
                />
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 cursor-pointer"
                  title="Generate Password"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
              Central Lab Full Address
            </label>
            <textarea
              rows={2}
              placeholder="Plot 42, SV Road / Link Road Junction, Andheri West, Mumbai 400058"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-sky-700 resize-none"
            />
          </div>

          {/* Strict Coordinates Section: Latitude ~19.1287852, Longitude ~72.8294183 */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div>
              <label className="block text-[10px] font-bold text-slate-700 uppercase mb-0.5">
                Latitude (e.g. 19.1287852)
              </label>
              <input
                type="number"
                step="any"
                required
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-900 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-700 uppercase mb-0.5">
                Longitude (e.g. 72.8294183)
              </label>
              <input
                type="number"
                step="any"
                required
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-900 font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Rate per Pickup Round (₹)
              </label>
              <input
                type="number"
                value={billingRate}
                onChange={(e) => setBillingRate(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <label className="flex items-center gap-2 cursor-pointer text-slate-800">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-slate-300 text-sky-700 focus:ring-sky-600 w-4 h-4"
                />
                <span className="font-bold text-xs">Active Account</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold rounded-lg shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{client ? 'Update Client Account' : 'Register Client Account'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

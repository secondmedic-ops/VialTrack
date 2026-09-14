import React, { useState } from 'react';
import { UserAuth } from '../../types';
import { Lock, ShieldCheck, AlertCircle, Check, KeyRound, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { validatePasswordStrength } from '../../utils/security';
import { StorageService } from '../../services/storage';

interface ForcePasswordModalProps {
  user: UserAuth;
  onPasswordChanged: (newPassword: string) => void;
}

export const ForcePasswordModal: React.FC<ForcePasswordModalProps> = ({ user, onPasswordChanged }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = validatePasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-type to confirm.');
      return;
    }

    if (!strength.valid) {
      setError('Password must include a mix of uppercase, lowercase, numbers, or symbols.');
      return;
    }

    setLoading(true);

    try {
      if (user.role === 'rider' && user.riderId) {
        StorageService.updateRiderPassword(user.riderId, newPassword);
      } else if (user.role === 'client' && user.clientId) {
        StorageService.updateClientPassword(user.clientId, newPassword);
      }

      onPasswordChanged(newPassword);
    } catch (err: any) {
      setError(err?.message || 'Failed to update permanent password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-2xl space-y-4 relative">
        {/* Header */}
        <div className="text-center space-y-1.5 pb-2 border-b border-slate-100">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto mb-2 shadow-xs">
            <KeyRound className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Setup Permanent Password</h2>
          <p className="text-xs text-slate-600">
            Welcome to SecondMedic VialTrack, <strong className="text-slate-900">{user.name}</strong>. Your temporary access password has expired and a permanent password is required to continue.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3.5 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              New Permanent Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showNewPassword ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                className="w-full pl-9 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs focus:outline-hidden focus:border-sky-600 focus:ring-1 focus:ring-sky-600 transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                title={showNewPassword ? 'Hide password' : 'Show password'}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Live Password Strength Indicator */}
            {newPassword.length > 0 && (
              <div className="mt-2 space-y-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-medium">Strength:</span>
                  <span
                    className={`font-bold ${
                      strength.score <= 2
                        ? 'text-rose-600'
                        : strength.score === 3
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                    }`}
                  >
                    {strength.score <= 2 ? 'Weak' : strength.score === 3 ? 'Medium' : 'Strong'}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      strength.score <= 2
                        ? 'bg-rose-500 w-1/3'
                        : strength.score === 3
                        ? 'bg-amber-500 w-2/3'
                        : 'bg-emerald-500 w-full'
                    }`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-600 pt-1">
                  <span className={`flex items-center gap-1 ${newPassword.length >= 8 ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                    <Check className="w-3 h-3" /> Min 8 chars
                  </span>
                  <span className={`flex items-center gap-1 ${/[0-9]/.test(newPassword) ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                    <Check className="w-3 h-3" /> Number (0-9)
                  </span>
                  <span className={`flex items-center gap-1 ${/[A-Z]/.test(newPassword) ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                    <Check className="w-3 h-3" /> Uppercase (A-Z)
                  </span>
                  <span className={`flex items-center gap-1 ${/[^A-Za-z0-9]/.test(newPassword) ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                    <Check className="w-3 h-3" /> Symbol (@#$%)
                  </span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Confirm New Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Re-type new password"
                className="w-full pl-9 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs focus:outline-hidden focus:border-sky-600 focus:ring-1 focus:ring-sky-600 transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
            >
              {loading ? 'Securing Account...' : 'Set Permanent Password & Enter'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="text-center pt-1 border-t border-slate-100">
          <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            Protected by SecondMedic Enterprise Logistics Security
          </span>
        </div>
      </div>
    </div>
  );
};

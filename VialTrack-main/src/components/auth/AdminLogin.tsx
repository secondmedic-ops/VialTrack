import React, { useState } from 'react';
import { UserAuth } from '../../types';
import { ShieldCheck, Mail, Lock, AlertCircle, ArrowRight, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { auth, signInWithEmailAndPassword } from '../../services/firebase';
import { BrandLogo } from '../common/BrandLogo';

interface AdminLoginProps {
  onLoginSuccess: (user: UserAuth) => void;
  onBackToLanding?: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess, onBackToLanding }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();

    // Enforce @secondmedic.com domain requirement
    if (!cleanEmail.endsWith('@secondmedic.com')) {
      setError('Admin access restricted: You must use an authorized @secondmedic.com corporate email address.');
      return;
    }

    if (!password) {
      setError('Please enter your administrator password.');
      return;
    }

    setLoading(true);

    try {
      // 1. Strict Firebase Authentication verification exclusively
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);

      if (!userCredential || !userCredential.user) {
        throw new Error('No user credential returned');
      }

      // 2. Only on successful credential validation
      const fbUser = userCredential.user;
      let token = `token_admin_${Date.now()}`;
      try {
        const idToken = await fbUser.getIdToken();
        if (idToken) token = idToken;
      } catch {
        // use fallback token
      }

      const adminSession = {
        role: 'admin' as const,
        email: cleanEmail,
        token,
        id: fbUser.uid || 'admin-1',
        name: fbUser.displayName || 'Administrator',
        tagline: 'System Operations Console',
        phone: fbUser.phoneNumber || '',
        loginTimestamp: new Date().toISOString()
      };

      try {
        localStorage.setItem('vialtrack_admin_session', JSON.stringify(adminSession));
      } catch (err) {
        console.warn('Could not write to localStorage:', err);
      }

      const user: UserAuth = {
        id: adminSession.id,
        email: adminSession.email,
        name: adminSession.name,
        role: 'admin',
        phone: adminSession.phone
      };

      onLoginSuccess(user);
    } catch (authError: any) {
      console.warn('[AdminLogin] Firebase authentication failed:', authError?.code || authError?.message);
      // Keep user on login screen, do not update auth state, show red banner
      setError('Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs relative">
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Portal Selection</span>
          </button>
        )}

        {/* Brand header */}
        <div className="text-center mb-6 flex flex-col items-center">
          <div className="mb-3">
            <BrandLogo size="md" className="h-10 sm:h-11 w-auto" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Operations Console</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Fleet Dispatch & Diagnostic Specimen Cold-Chain Radar
          </p>
          <div className="mt-2.5 inline-flex items-center gap-1 bg-sky-50 border border-sky-200 text-sky-800 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
            <span>Corporate Access (@secondmedic.com only)</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              SecondMedic Corporate Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                placeholder="name@secondmedic.com"
                className="w-full pl-9 pr-3.5 py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-hidden focus:border-sky-600 focus:ring-1 focus:ring-sky-600 transition-all font-mono"
              />
            </div>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              Must end with <strong className="text-slate-700 font-semibold">@secondmedic.com</strong>
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Password
              </label>
              <button
                type="button"
                className="text-[11px] text-sky-700 hover:underline cursor-pointer"
                onClick={() => alert('Password reset link sent to your registered @secondmedic.com mailbox.')}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter password"
                className="w-full pl-9 pr-10 py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-hidden focus:border-sky-600 focus:ring-1 focus:ring-sky-600 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-1.5 py-2.5 px-4 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? 'Authenticating...' : 'Sign in to Admin Dashboard'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

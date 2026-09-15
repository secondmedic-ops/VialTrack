import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, KeyRound, AlertCircle, ArrowRight, ArrowLeft, ShieldCheck, Mail, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { StorageService } from '../../services/storage';
import {
  auth,
  db,
  signInWithEmailAndPassword,
  passwordForFirebaseAuth,
  lookupLoginEmail
} from '../../services/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { UserAuth } from '../../types';

interface ClientLoginProps {
  onLoginSuccess?: (user: UserAuth) => void;
  onBackToLanding?: () => void;
}

export const ClientLogin: React.FC<ClientLoginProps> = ({ onLoginSuccess, onBackToLanding }) => {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const cleanInput = identifier.trim().toLowerCase();
    const cleanPass = password.trim();

    if (!cleanInput || !cleanPass) {
      setError('Please enter your registered email or phone, and your password.');
      setIsLoading(false);
      return;
    }

    try {
      // ---------------------------------------------------------------------------------------
      // AUTH PATH 1 (preferred): real Firebase Authentication.
      //
      // When the account has been provisioned (Admin -> Alerts & Rules -> "Migrate Accounts to
      // Secure Login"), the password is verified by Firebase itself and the session carries the
      // custom claims (role: 'client', clientId) that firestore.rules checks. This is the only
      // path that keeps working once the hardened rules are published, because it is the only one
      // that produces a real request.auth for this browser.
      // ---------------------------------------------------------------------------------------
      const looksLikeEmail = cleanInput.includes('@');
      let authedClientId: string | null = null;

      // When a phone number was typed instead of an email, resolve it to the account's Auth email
      // through the narrow lookupLoginEmail Cloud Function -- which returns only that one string
      // -- rather than downloading the whole clients collection to search it in the browser.
      let emailToAuth = looksLikeEmail ? cleanInput : '';
      if (!looksLikeEmail) {
        emailToAuth = (await lookupLoginEmail('client', cleanInput)) || '';
      }

      if (emailToAuth) {
        try {
          const credential = await signInWithEmailAndPassword(auth, emailToAuth, passwordForFirebaseAuth(cleanPass));
          const tokenResult = await credential.user.getIdTokenResult();
          const claimRole = tokenResult.claims.role;
          const claimClientId = tokenResult.claims.clientId;

          if (claimRole && claimRole !== 'client') {
            setError('This login is for diagnostic client accounts only. Please use the correct portal.');
            setIsLoading(false);
            return;
          }
          authedClientId = (claimClientId as string) || null;
        } catch {
          // Not provisioned yet (or wrong password) -- fall through to the legacy check below,
          // which is strict about the password and will reject a genuinely wrong one.
        }
      }

      // 1. Check local storage first
      const localClients = StorageService.getClients();
      let matchedClient = localClients.find(
        (c) =>
          (authedClientId && c.id === authedClientId) ||
          (c.email && c.email.toLowerCase().trim() === cleanInput) ||
          (c.phone && c.phone.replace(/\D/g, '') === cleanInput.replace(/\D/g, '')) ||
          (c.id && c.id.toLowerCase() === cleanInput)
      );

      // 2. Read this client's OWN document from Firestore.
      //
      // This used to list the entire clients collection. The hardened rules allow a client to
      // read only their own document (isThisClient(clientId)), and a list query cannot satisfy a
      // per-document condition, so that read is now denied. Once signed in we know exactly which
      // document to fetch from the clientId custom claim.
      if (!matchedClient) {
        if (authedClientId) {
          const ownDoc = await getDoc(doc(db, 'clients', authedClientId));
          if (ownDoc.exists()) {
            matchedClient = { id: ownDoc.id, ...ownDoc.data() } as any;
          }
        } else {
          // Legacy path for an account not yet provisioned -- only reachable while the collection
          // is still readable, and harmless once it is not.
          const snap = await getDocs(collection(db, 'clients'));
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
          matchedClient = docs.find(
            (c) =>
              (c.email && c.email.toLowerCase().trim() === cleanInput) ||
              (c.phone && c.phone.replace(/\D/g, '') === cleanInput.replace(/\D/g, '')) ||
              (c.id && c.id.toLowerCase() === cleanInput)
          );
        }
      }

      if (!matchedClient) {
        setError('No diagnostic client account found matching this email or phone.');
        setIsLoading(false);
        return;
      }

      // 3. Lockout check -- mirrors the rider portal's 5-attempt / 3-minute throttle.
      if (matchedClient.lockoutUntil) {
        const lockoutTime = new Date(matchedClient.lockoutUntil).getTime();
        if (lockoutTime > Date.now()) {
          const remainingSecs = Math.ceil((lockoutTime - Date.now()) / 1000);
          const minutes = Math.floor(remainingSecs / 60);
          const seconds = remainingSecs % 60;
          setError(
            `Account temporarily locked due to failed attempts. Retry in ${
              minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
            }.`
          );
          setIsLoading(false);
          return;
        }
      }

      // ---------------------------------------------------------------------------------------
      // AUTH PATH 2 (legacy, transitional): the plaintext password stored on the client document.
      //
      // This check used to read `if (validPass && cleanPass !== validPass) reject`, which meant a
      // client document with a missing or empty `password` field made the whole condition falsy
      // and let ANY typed password through -- an outright authentication bypass for every client
      // that had not had a password set. It is now inverted: a stored password must exist AND
      // match exactly, or access is denied. An account with no password cannot be logged into at
      // all here; it must be provisioned through Firebase Auth (path 1) instead.
      //
      // Remove this branch entirely once every client has been migrated and their plaintext
      // passwords stripped via the stripAllLegacyPasswords function.
      // ---------------------------------------------------------------------------------------
      if (!authedClientId) {
        const storedPass = typeof matchedClient.password === 'string' ? matchedClient.password.trim() : '';

        if (!storedPass || cleanPass !== storedPass) {
          const { attempts, isLocked } = StorageService.recordClientFailedAttempt(matchedClient.id);
          if (isLocked) {
            setError('Account temporarily locked due to 5 failed attempts. Please retry in 3 minutes.');
          } else if (!storedPass) {
            setError(
              'This account has no password set up yet. Please contact SecondMedic operations to have secure login provisioned.'
            );
          } else {
            const remaining = Math.max(1, 5 - attempts);
            setError(
              `Invalid password. (${remaining} attempts remaining before temporary lockout)`
            );
          }
          setIsLoading(false);
          return;
        }
      }

      StorageService.resetClientFailedAttempts(matchedClient.id);

      // 4. Save clean session and navigate to dashboard
      const clientSession = {
        role: 'client' as const,
        clientId: matchedClient.id,
        name: matchedClient.name,
        email: matchedClient.email || `${matchedClient.id}@vialtrack.in`,
        phone: matchedClient.phone || '',
        token: `token_client_${Date.now()}`,
        loginTimestamp: new Date().toISOString()
      };

      StorageService.setClientSession(clientSession);

      const user: UserAuth = {
        id: `user-${clientSession.clientId}`,
        email: clientSession.email,
        name: clientSession.name,
        role: 'client',
        clientId: clientSession.clientId,
        phone: clientSession.phone,
        mustChangePassword: false
      };

      if (onLoginSuccess) {
        onLoginSuccess(user);
      }

      navigate('/client');
    } catch (err: any) {
      console.error('Client login error:', err);
      setError('Connection to database failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden p-6 sm:p-8 space-y-6">
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Portal Selection</span>
          </button>
        )}

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 mb-1">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Client Diagnostic Portal</h1>
          <p className="text-xs text-slate-500">
            Hospital & Diagnostic Lab Partner Specimen Intake
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold border border-teal-200">
            <ShieldCheck className="w-3 h-3" />
            <span>Verified Diagnostic Centers & Hospital Partners</span>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
              Laboratory / Hospital Email or Phone
            </label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="ops@lifecarediagnostics.com or phone"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-hidden focus:border-teal-600 shadow-2xs"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Enter the credentials registered with SecondMedic Ops
            </p>
          </div>

          <div>
            <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-hidden focus:border-teal-600 shadow-2xs"
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
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-700 hover:bg-teal-800 disabled:bg-teal-400 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer text-xs"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>Sign in to Lab Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};




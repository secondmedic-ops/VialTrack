import React, { useState, useEffect } from 'react';
import { UserAuth } from '../../types';
import { Smartphone, Phone, Lock, AlertCircle, ArrowRight, Bike, KeyRound, Eye, EyeOff } from 'lucide-react';
import { StorageService } from '../../services/storage';
import { auth, signInWithEmailAndPassword, db, passwordForFirebaseAuth } from '../../services/firebase';
import { collection, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { BrandLogo } from '../common/BrandLogo';

interface RiderLoginProps {
  onLoginSuccess: (user: UserAuth) => void;
  onBackToLanding?: () => void;
}

export const RiderLogin: React.FC<RiderLoginProps> = ({ onLoginSuccess, onBackToLanding }) => {
  const [mobileNumber, setMobileNumber] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only accept numeric digits up to 10 characters
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 10);
    setMobileNumber(digitsOnly);
    if (error) setError(null);
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Accept password or PIN string up to 32 chars
    setPin(e.target.value);
    if (error) setError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = mobileNumber.trim();
    const cleanPin = pin.trim();

    // Enforce 10-digit mobile validation
    const indianMobileRegex = /^[6-9]\d{9}$/;
    if (!indianMobileRegex.test(cleanPhone)) {
      setError('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    if (!cleanPin || cleanPin.length < 4) {
      setError('Please enter your password or PIN (minimum 4 characters).');
      return;
    }

    setLoading(true);

    try {
      // -------------------------------------------------------------------------------------
      // STEP 0: authenticate FIRST, before touching Firestore.
      //
      // A rider's Firebase Auth email is derived purely from their phone number
      // (rider-<digits>@riders.vialtrack.internal -- see riderAuthEmail in functions/index.js),
      // so no lookup is needed to attempt a real sign-in. Doing this first means the Firestore
      // reads below happen inside an authenticated session, which is what the hardened
      // firestore.rules require. The password is padded exactly the way provisioning padded it,
      // otherwise a short legacy PIN could never match its own Auth account.
      // -------------------------------------------------------------------------------------
      let isFirebaseAuthed = false;
      let authedRiderId: string | null = null;

      // The Auth email is built from the digits of whatever is stored in the rider's `phone`
      // field, which is NOT consistent across records: some are saved as "8268826200" and others
      // as "+91 9029186608", producing rider-8268826200@... and rider-919029186608@... . The rider
      // only ever types 10 digits, so every plausible spelling is tried rather than assuming one.
      const emailCandidates = Array.from(
        new Set([
          `rider-${cleanPhone}@riders.vialtrack.internal`,
          `rider-91${cleanPhone}@riders.vialtrack.internal`,
          `rider-0${cleanPhone}@riders.vialtrack.internal`
        ])
      );

      for (const candidate of emailCandidates) {
        try {
          const credential = await signInWithEmailAndPassword(auth, candidate, password);
          if (credential?.user) return credential.user;
        } catch (authErr: any) {
          console.warn("[VialTrack Auth] Candidate failed:", candidate, authErr?.code || authErr?.message);
        }
          authedRiderId = (tokenResult.claims.riderId as string) || null;
          isFirebaseAuthed = true;
          break;
        } catch {
          // Try the next spelling; if none match, the legacy checks below decide.
        }
      }

      // 1. Fetch riders from Storage and Firestore
      const localRiders = StorageService.getRiders();
      let matchedRider = localRiders.find((r) => {
        const rClean = (r.phone || '').replace(/\D/g, '');
        return rClean.endsWith(cleanPhone) || rClean === cleanPhone;
      });

      // 2. If not found locally, read the rider's OWN document from Firestore.
      //
      // This used to be getDocs(collection(db, 'riders')) -- a collection-wide list query. The
      // hardened rules allow a rider to read only their own document (isThisRider(riderId)), and
      // a list query cannot satisfy a per-document condition, so that read is denied outright and
      // every rider saw "Mobile number not registered". Once signed in we know exactly which
      // document we need from the riderId custom claim, so we fetch that one directly.
      if (!matchedRider) {
        try {
          let found: any = null;

          if (authedRiderId) {
            const ownDoc = await getDoc(doc(db, 'riders', authedRiderId));
            if (ownDoc.exists()) {
              found = { id: ownDoc.id, ...ownDoc.data() };
            }
          }

          // Legacy path for an account that has not been provisioned yet: only reachable while
          // the collection is still readable, and harmless once it is not.
          if (!found && !isFirebaseAuthed) {
            const snapshot = await getDocs(collection(db, 'riders'));
            const firestoreRiders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            found = firestoreRiders.find((fr) => {
              const frClean = (fr.phone || '').replace(/\D/g, '');
              return frClean.endsWith(cleanPhone) || frClean === cleanPhone || fr.id === `rider-${cleanPhone}`;
            });
          }

          if (found) {
            matchedRider = {
              id: found.id,
              name: found.name || `Rider ${cleanPhone.slice(-4)}`,
              phone: found.phone || `+91 ${cleanPhone}`,
              email: found.email || `rider.${cleanPhone}@vialtrack.in`,
              // NEVER fall back to the PIN the user just typed here. It used to read
              // `found.password || cleanPin`, which meant any rider document without a stored
              // password got the attacker's own input written into matchedRider.password -- and
              // the equality check further down then passed, letting anyone in with any PIN.
              password: found.password || '',
              vehicleNumber: found.vehicleNo || found.vehicleNumber || '',
              vehicleType: found.vehicleType || 'Motorcycle / Bike',
              photoUrl: found.photoUrl || '',
              assignedRouteIds: found.assignedRouteIds || [],
              status: 'active',
              joiningDate: found.joiningDate || new Date().toISOString().split('T')[0],
              isOnline: true,
              isCheckedIn: true
            };
          }
        } catch (firestoreErr) {
          console.warn('[RiderLogin] Firestore fetch fallback:', firestoreErr);
        }
      }

      // 3. If not found, strictly deny access - only admin-registered riders can log in.
      // A Firebase-authenticated rider whose document could not be read is a data problem, not an
      // access problem, so it gets its own message instead of "not registered".
      if (!matchedRider && isFirebaseAuthed) {
        setError('Your login is valid but your rider profile could not be loaded. Contact Ops Admin.');
        setLoading(false);
        return;
      }

      if (!matchedRider) {
        setError('Access Denied: Mobile number not registered with SecondMedic Operations. Contact Ops Admin.');
        setLoading(false);
        return;
      }

      // 4. Rate Limiting Check
      if (matchedRider.lockoutUntil) {
        const lockoutTime = new Date(matchedRider.lockoutUntil).getTime();
        const now = Date.now();
        if (lockoutTime > now) {
          const remainingSecs = Math.ceil((lockoutTime - now) / 1000);
          const minutes = Math.floor(remainingSecs / 60);
          const seconds = remainingSecs % 60;
          setError(
            `Account temporarily locked due to failed attempts. Retry in ${
              minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
            }.`
          );
          setLoading(false);
          return;
        }
      }

      // 5. Verify the PIN. Firebase Authentication is tried FIRST, because it is the only path
      // that produces a real request.auth (with the role/riderId custom claims that
      // firestore.rules checks) for this browser. The plaintext comparison below it is a
      // transitional fallback for riders who have not been through "Migrate Accounts to Secure
      // Login" yet, and it now requires a stored password that is actually set -- an empty or
      // missing one denies access instead of matching.
      let isAuthenticated = isFirebaseAuthed;

      if (!isAuthenticated) {
        const storedPin = typeof matchedRider.password === 'string' ? matchedRider.password.trim() : '';
        if (storedPin && storedPin === cleanPin) {
          isAuthenticated = true;
        }
      }

      if (!isAuthenticated) {
        const { attempts, isLocked } = StorageService.recordRiderFailedAttempt(matchedRider.id);
        if (isLocked) {
          setError('Account temporarily locked due to 5 failed attempts. Please retry in 3 minutes.');
        } else {
          const remaining = Math.max(1, 5 - attempts);
          setError(`Invalid PIN for ${cleanPhone}. (${remaining} attempts remaining before temporary lockout)`);
        }
        setLoading(false);
        return;
      }

      // 6. Reset failed attempts and set session
      StorageService.resetRiderFailedAttempts(matchedRider.id);

      const riderSession = {
        role: 'rider' as const,
        riderId: matchedRider.id,
        phone: matchedRider.phone,
        name: matchedRider.name,
        email: matchedRider.email,
        avatar: matchedRider.photoUrl,
        vehicleNo: matchedRider.vehicleNumber || '',
        vehicleNumber: matchedRider.vehicleNumber || '',
        vehicleType: matchedRider.vehicleType || 'Motorcycle / Bike',
        token: `rider_token_${Date.now()}`,
        mustChangePassword: matchedRider.mustChangePassword ?? false,
        loginTimestamp: new Date().toISOString()
      };

      StorageService.setRiderSession(riderSession);
      try {
        localStorage.setItem('vialtrack_active_rider', JSON.stringify(riderSession));
        localStorage.setItem('vialtrack_rider_session', JSON.stringify(riderSession));
      } catch (err) {
        console.warn('Could not write rider session:', err);
      }

      const user: UserAuth = {
        id: `user-${riderSession.riderId}`,
        email: riderSession.email,
        name: riderSession.name,
        role: 'rider',
        riderId: riderSession.riderId,
        phone: riderSession.phone,
        avatar: riderSession.avatar,
        mustChangePassword: riderSession.mustChangePassword
      };

      onLoginSuccess(user);
    } catch (err: any) {
      console.warn('[RiderLogin] Login exception:', err);
      setError('Unable to authenticate. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] sm:min-h-[80vh] flex items-center justify-center px-4 py-6 sm:py-8 max-w-md mx-auto"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))'
      }}
    >
      <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 shadow-xs relative">
        {/* No portal-selection link here at all.
            The rider portal is a destination in its own right: riders arrive via their installed
            app or a direct link and have no reason to reach the landing page or the other portals.
            This was previously hidden only in standalone PWA mode, which still exposed it to any
            rider opening the site in a browser tab.

            NOTE: this is a UI measure, not a security boundary -- someone could still type the
            admin URL directly. What actually stops them is firestore.rules, which denies any read
            their role does not permit. */}

        {/* Brand header */}
        <div className="text-center mb-6 flex flex-col items-center">
          <div className="mb-3">
            <BrandLogo size="md" className="h-10 sm:h-11 w-auto" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Rider Operations Portal</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Diagnostic Sample Logistics & Cold-Chain Delivery
          </p>
          <div className="mt-2.5 inline-flex items-center gap-1.5 bg-sky-50 border border-sky-200 text-sky-800 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
            <Smartphone className="w-3.5 h-3.5" />
            <span>Mobile-Optimized PWA Edition</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-start gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Standard Form with method="POST" so modern browsers prompt Save Password */}
        <form
          method="POST"
          action="#"
          onSubmit={handleLogin}
          autoComplete="on"
          className="space-y-4"
        >
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Mobile Number (10 Digits) *
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-slate-500 font-mono text-xs pointer-events-none">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-semibold text-slate-600">+91</span>
              </div>
              <input
                type="tel"
                id="username"
                name="username"
                inputMode="numeric"
                autoComplete="username tel"
                pattern="[0-9]{10}"
                maxLength={10}
                placeholder="10-digit Mobile Number"
                required
                value={mobileNumber}
                onChange={handlePhoneChange}
                className="w-full pl-16 pr-3.5 py-3.5 bg-white border border-slate-300 rounded-xl text-base text-slate-900 font-mono tracking-wider focus:outline-hidden focus:border-sky-600 focus:ring-1 focus:ring-sky-600 transition-all placeholder:text-slate-400 placeholder:font-sans placeholder:tracking-normal"
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-slate-400">
                {mobileNumber.length}/10 digits entered
              </span>
              <span className="text-[10px] text-sky-700 font-medium">
                e.g. 9876543210
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Rider Password / PIN *
              </label>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter PIN or password"
                required
                value={pin}
                onChange={handlePinChange}
                className="w-full pl-10 pr-12 py-3.5 bg-white border border-slate-300 rounded-xl text-base text-slate-900 font-mono tracking-wider focus:outline-hidden focus:border-sky-600 focus:ring-1 focus:ring-sky-600 transition-all placeholder:text-slate-400 placeholder:font-sans placeholder:tracking-normal"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-2.5"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-slate-400">
                Enter your configured PIN or password
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            id="rider-login-submit-btn"
            className="w-full mt-3 py-4 px-4 bg-sky-700 hover:bg-sky-800 text-white font-bold text-base rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
          >
            {loading ? 'Authenticating Rider...' : 'Login & Open My Schedule'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-slate-100 text-center">
          <span className="text-[11px] text-slate-500">Powered by </span>
          <span className="text-[11px] font-bold text-sky-700">SecondMedic Logistics</span>
        </div>
      </div>
    </div>
  );
};




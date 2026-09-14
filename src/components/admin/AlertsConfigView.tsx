import React, { useState } from 'react';
import { Bell, ShieldAlert, Sliders, MessageSquare, Send, CheckCircle2, AlertTriangle, Thermometer, MapPin, Trash2, RefreshCw, Smartphone, KeyRound } from 'lucide-react';
import { NotificationService } from '../../services/notificationService';
import { cleanupFirestoreCollections, sendRiderPushAlert, runAccountSecurityMigration, removeAllLegacyPasswords } from '../../services/firebase';
import { PickupBoy } from '../../types';

interface AlertsConfigViewProps {
  onRefresh: () => void;
  riders?: PickupBoy[];
}

export const AlertsConfigView: React.FC<AlertsConfigViewProps> = ({ onRefresh, riders = [] }) => {
  const [pushRiderId, setPushRiderId] = useState<string>('all');
  const [pushTitle, setPushTitle] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [isSendingPush, setIsSendingPush] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [isStrippingPasswords, setIsStrippingPasswords] = useState(false);
  const [stripPasswordsResult, setStripPasswordsResult] = useState<string | null>(null);
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(15);
  const [minTemp, setMinTemp] = useState(2.0);
  const [maxTemp, setMaxTemp] = useState(8.0);
  const [enableWhatsApp, setEnableWhatsApp] = useState(true);
  const [enableSMS, setEnableSMS] = useState(true);
  const [enableInApp, setEnableInApp] = useState(true);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleSendTestAlert = () => {
    NotificationService.sendAlert({
      type: 'delay',
      title: 'TEST ALERT: Pickup Delayed (+15m)',
      message: 'Automated test simulation: Courier partner delayed on scheduled route (Slot 14:00).',
      recipientRole: 'admin',
      channel: 'both'
    });
    setTestSent(true);
    onRefresh();
    setTimeout(() => setTestSent(false), 3000);
  };

  const handleSendPushAlert = async () => {
    if (!pushTitle.trim() || !pushMessage.trim()) {
      setPushResult('Please enter both a title and a message.');
      return;
    }
    setIsSendingPush(true);
    setPushResult(null);
    try {
      const res = await sendRiderPushAlert({
        riderId: pushRiderId as string | 'all',
        title: pushTitle.trim(),
        message: pushMessage.trim(),
      });
      setPushResult(res.message || (res.success ? 'Sent.' : 'Failed to send.'));
      if (res.success) {
        setPushTitle('');
        setPushMessage('');
      }
    } catch (err: any) {
      setPushResult(`Error: ${err?.message || 'Failed to send push alert'}`);
    } finally {
      setIsSendingPush(false);
    }
  };

  const handleMigrateAccounts = async () => {
    if (
      !window.confirm(
        'This creates real, secure login accounts for every rider and client who doesn\'t already have one, using their current password (nothing changes for them -- they keep logging in the same way). It does NOT change database access rules and is safe to run more than once. Continue?'
      )
    ) {
      return;
    }
    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const res = await runAccountSecurityMigration();
      if (res.success && res.results) {
        const { admins, riders: r, clients: c } = res.results;
        const failedCount = (r?.failed?.length || 0) + (c?.failed?.length || 0);
        setMigrationResult(
          `Done. Admin accounts tagged: ${admins}. Riders migrated: ${r?.migrated ?? 0} (already done: ${
            r?.skipped ?? 0
          }). Clients migrated: ${c?.migrated ?? 0} (already done: ${c?.skipped ?? 0}).${
            failedCount > 0 ? ` ${failedCount} record(s) failed -- see console for details.` : ''
          }`
        );
        if (failedCount > 0) {
          console.warn('[Migration] Failures:', r?.failed, c?.failed);
        }
      } else {
        setMigrationResult(`Error: ${res.message || 'Migration failed'}`);
      }
    } catch (err: any) {
      setMigrationResult(`Error: ${err?.message || 'Migration failed'}`);
    } finally {
      setIsMigrating(false);
    }
  };

  const handleRemoveLegacyPasswords = async () => {
    if (
      !window.confirm(
        'This permanently deletes the old plaintext password field from every rider/client record that already has a confirmed, working secure login -- anything not yet migrated is automatically skipped and left untouched, so this can never lock anyone out. Continue?'
      )
    ) {
      return;
    }
    setIsStrippingPasswords(true);
    setStripPasswordsResult(null);
    try {
      const res = await removeAllLegacyPasswords();
      if (res.success && res.results) {
        const { riders: r, clients: c } = res.results;
        setStripPasswordsResult(
          `Done. Riders cleaned: ${r?.cleaned ?? 0} (skipped, not yet migrated: ${r?.skipped ?? 0}). ` +
          `Clients cleaned: ${c?.cleaned ?? 0} (skipped, not yet migrated: ${c?.skipped ?? 0}).`
        );
      } else {
        setStripPasswordsResult(`Error: ${res.message || 'Failed to remove legacy passwords'}`);
      }
    } catch (err: any) {
      setStripPasswordsResult(`Error: ${err?.message || 'Failed to remove legacy passwords'}`);
    } finally {
      setIsStrippingPasswords(false);
    }
  };

  const handleCleanDatabase = async () => {
    if (!window.confirm('Are you sure you want to clean up all Firestore collections (clients, locations, riders, routes, tasks)? This will leave the database completely empty so you can create new production records.')) {
      return;
    }

    setIsCleaning(true);
    setCleanupMessage(null);
    try {
      const res = await cleanupFirestoreCollections();
      setCleanupMessage(res.message);
      onRefresh();
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      setCleanupMessage(`Error: ${err?.message || 'Failed to cleanup database'}`);
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="bg-white border border-slate-200 p-4 sm:p-5 rounded-xl shadow-xs">
        <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
          <Sliders className="w-5 h-5 text-sky-700" />
          <span>Automated Operational Rules & Alert Thresholds</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure automated SLA monitoring, grace periods, cold-chain temperature thresholds, and notification channels.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* SLA Grace Period */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Pickup Slot Delay Detection (Grace Period)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Time allowed past the scheduled slot before auto-flagging delay and notifying client/admin.
              </p>
            </div>
            <span className="font-mono font-bold text-amber-800 text-sm sm:text-base bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
              {gracePeriodMinutes} Minutes
            </span>
          </div>

          <div className="space-y-2">
            <input
              type="range"
              min="5"
              max="45"
              step="5"
              value={gracePeriodMinutes}
              onChange={(e) => setGracePeriodMinutes(Number(e.target.value))}
              className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-700"
            />
            <div className="flex justify-between text-[11px] text-slate-400 font-mono">
              <span>5 min (Strict)</span>
              <span>15 min (Standard)</span>
              <span>30 min</span>
              <span>45 min (Lenient)</span>
            </div>
          </div>
        </div>

        {/* Cold-Chain Limits */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-sky-700" />
                <span>Cold-Chain Biological Safe Range</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Alarms sound if chiller box temperature reading falls outside this certified range.
              </p>
            </div>
            <span className="font-mono font-bold text-emerald-800 text-xs sm:text-sm bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
              {minTemp}°C to {maxTemp}°C
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                Minimum Temperature (°C)
              </label>
              <input
                type="number"
                step="0.5"
                value={minTemp}
                onChange={(e) => setMinTemp(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-hidden focus:border-sky-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                Maximum Temperature (°C)
              </label>
              <input
                type="number"
                step="0.5"
                value={maxTemp}
                onChange={(e) => setMaxTemp(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-hidden focus:border-sky-600"
              />
            </div>
          </div>
        </div>

        {/* Notification Channels */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2 pb-3 border-b border-slate-100">
            <MessageSquare className="w-4 h-4 text-sky-700" />
            <span>Automated Notification Channels</span>
          </h3>

          <div className="space-y-2.5 text-xs">
            <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
              <div>
                <span className="font-bold text-slate-900 block">WhatsApp Automated Updates</span>
                <span className="text-slate-500 text-[11px]">
                  Instant WhatsApp alerts to hospital contact person on pickup and delivery.
                </span>
              </div>
              <input
                type="checkbox"
                checked={enableWhatsApp}
                onChange={(e) => setEnableWhatsApp(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 w-4 h-4 focus:ring-sky-600"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
              <div>
                <span className="font-bold text-slate-900 block">SMS Fallback Alerts</span>
                <span className="text-slate-500 text-[11px]">
                  High-priority SMS alerts for delayed loops or temperature alerts.
                </span>
              </div>
              <input
                type="checkbox"
                checked={enableSMS}
                onChange={(e) => setEnableSMS(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 w-4 h-4 focus:ring-sky-600"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
              <div>
                <span className="font-bold text-slate-900 block">In-App Push & Sound Alerts</span>
                <span className="text-slate-500 text-[11px]">
                  Real-time notification bell and browser audio chimes for Ops team.
                </span>
              </div>
              <input
                type="checkbox"
                checked={enableInApp}
                onChange={(e) => setEnableInApp(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 w-4 h-4 focus:ring-sky-600"
              />
            </label>
          </div>
        </div>

        {/* Save & Test Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleSendTestAlert}
            className="w-full sm:w-auto px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-sky-700 font-bold text-xs rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{testSent ? 'Test Alert Broadcasted!' : 'Send Test Alert to Ops'}</span>
          </button>

          <button
            type="submit"
            className="w-full sm:w-auto px-5 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {savedSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Configuration Saved!</span>
              </>
            ) : (
              <span>Save Alert Rules</span>
            )}
          </button>
        </div>
      </form>

      {/* Security Overhaul: Migrate Accounts to Secure Login */}
      <div className="bg-white border border-amber-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="pb-3 border-b border-amber-100">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-600" />
            <span>Migrate Accounts to Secure Login</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            One-time step: creates a real, secure Firebase login for every rider and client that
            doesn't have one yet, using their current password -- nobody has to reset anything or
            relearn a password. Safe to click more than once (already-migrated accounts are
            skipped). This is step 1 of tightening database access; it does not change database
            rules by itself.
          </p>
        </div>

        {migrationResult && (
          <div className="p-3 bg-slate-900 text-white rounded-lg text-xs font-mono whitespace-pre-wrap">
            {migrationResult}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleMigrateAccounts}
            disabled={isMigrating}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isMigrating ? 'animate-spin' : ''}`} />
            <span>{isMigrating ? 'Migrating...' : 'Migrate Accounts to Secure Login'}</span>
          </button>
        </div>
      </div>

      {/* Security Overhaul: Remove Legacy Plaintext Passwords */}
      <div className="bg-white border border-amber-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="pb-3 border-b border-amber-100">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-600" />
            <span>Remove Legacy Plaintext Passwords</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Step 2, after the migration above: deletes the old plaintext password field from every
            rider/client record, but only once that record has a confirmed, working secure login --
            anything not yet migrated is left exactly as-is. Run the migration above first; new
            riders/clients you add from now on get a secure login (and never a stored plaintext
            password) automatically, so this is mainly a one-time cleanup for older records.
          </p>
        </div>

        {stripPasswordsResult && (
          <div className="p-3 bg-slate-900 text-white rounded-lg text-xs font-mono whitespace-pre-wrap">
            {stripPasswordsResult}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleRemoveLegacyPasswords}
            disabled={isStrippingPasswords}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isStrippingPasswords ? 'animate-spin' : ''}`} />
            <span>{isStrippingPasswords ? 'Cleaning up...' : 'Remove Legacy Plaintext Passwords'}</span>
          </button>
        </div>
      </div>

      {/* Send Push Alert to Rider(s) -- Android Rider app */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-sky-700" />
            <span>Send Push Alert to Rider(s)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Sends a real push notification to the Android VialTrack Rider app. Only reaches riders who
            have logged into the Android app at least once (their device needs to have registered) --
            it has no effect on riders only using the website.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
              Send To
            </label>
            <select
              value={pushRiderId}
              onChange={(e) => setPushRiderId(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
            >
              <option value="all">All Riders</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
              Title
            </label>
            <input
              type="text"
              value={pushTitle}
              onChange={(e) => setPushTitle(e.target.value)}
              placeholder="e.g. Route change"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
            Message
          </label>
          <textarea
            value={pushMessage}
            onChange={(e) => setPushMessage(e.target.value)}
            rows={2}
            placeholder="e.g. Please collect an extra cold box from the dispatch hub before starting your 2 PM loop."
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
          />
        </div>

        {pushResult && (
          <div className="p-3 bg-slate-900 text-white rounded-lg text-xs font-mono">{pushResult}</div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSendPushAlert}
            disabled={isSendingPush}
            className="px-4 py-2 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSendingPush ? 'Sending...' : 'Send Push Notification'}</span>
          </button>
        </div>
      </div>

      {/* Database Maintenance & Production Cleanup */}
      <div className="bg-white border border-rose-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3 mt-8">
        <div className="flex items-center justify-between pb-3 border-b border-rose-100">
          <div>
            <h3 className="font-bold text-rose-900 text-sm sm:text-base flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Strict Production Database Cleanup</span>
            </h3>
            <p className="text-xs text-rose-600 mt-0.5">
              Purge all collections (clients, locations, riders, routes, tasks) to start with a pure empty database.
            </p>
          </div>
        </div>

        {cleanupMessage && (
          <div className="p-3 bg-slate-900 text-white rounded-lg text-xs font-mono">
            {cleanupMessage}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-slate-500">
            Use this action when switching to production or preparing to register clean client accounts and pickup boy profiles from scratch.
          </p>
          <button
            type="button"
            onClick={handleCleanDatabase}
            disabled={isCleaning}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-2 cursor-pointer shrink-0 shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCleaning ? 'animate-spin' : ''}`} />
            <span>{isCleaning ? 'Cleaning Database...' : 'Wipe All Collections'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

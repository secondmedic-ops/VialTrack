import React, { useState, useEffect } from 'react';
import { StorageService } from '../../services/storage';
import { CloudSync, formatUnifiedTask } from '../../services/firebase';
import { RiderDashboard } from './RiderDashboard';
import { Route, PickupTask, RiderSession, UserAuth } from '../../types';
import { ProofModal } from '../common/ProofModal';
import { AlertCircle, LogIn } from 'lucide-react';

interface RiderAppProps {
  onLogout?: () => void;
  onNavigateToLogin?: () => void;
}

export const RiderApp: React.FC<RiderAppProps> = ({ onLogout, onNavigateToLogin }) => {
  const [session, setSession] = useState<RiderSession | null>(() => StorageService.getRiderSession());
  const [routes, setRoutes] = useState<Route[]>(() => StorageService.getRoutes());
  const [tasks, setTasks] = useState<PickupTask[]>(() => StorageService.getTasks());
  const [selectedProofTask, setSelectedProofTask] = useState<PickupTask | null>(null);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Strictly check session on mount and when storage changes
  useEffect(() => {
    const activeSession = StorageService.getRiderSession();
    if (!activeSession) {
      if (onNavigateToLogin) {
        onNavigateToLogin();
      } else if (onLogout) {
        onLogout();
      } else {
        window.location.href = '/rider/login';
      }
      return;
    }
    setSession(activeSession);
  }, [onLogout, onNavigateToLogin, refreshTrigger]);

  // Synchronize live cloud state for rider
  useEffect(() => {
    if (!session?.riderId) return;

    const unsubRoutes = CloudSync.subscribeToRoutes((cloudRoutes) => {
      if (cloudRoutes && Array.isArray(cloudRoutes) && cloudRoutes.length > 0) {
        setRoutes(cloudRoutes);
      }
    });

    const unsubTrips = CloudSync.subscribeToRiderTrips(session.riderId, session.phone, (cloudTrips) => {
      if (cloudTrips && Array.isArray(cloudTrips) && cloudTrips.length > 0) {
        const formatted = cloudTrips.map((t) => formatUnifiedTask(t.id, t));
        setTasks((prev) => {
          const map = new Map<string, PickupTask>();
          (prev || []).forEach((item) => map.set(item.id, item));
          formatted.forEach((item) => map.set(item.id, item));
          return Array.from(map.values());
        });
      }
    });

    const unsubTasks = CloudSync.subscribeToRiderTasks(session.riderId, session.phone, (cloudTasks) => {
      if (cloudTasks && Array.isArray(cloudTasks)) {
        setTasks((prev) => {
          const map = new Map<string, PickupTask>();
          (prev || []).forEach((item) => map.set(item.id, item));
          cloudTasks.forEach((item) => map.set(item.id, item));
          return Array.from(map.values());
        });
      }
    });

    return () => {
      unsubRoutes();
      unsubTrips();
      unsubTasks();
    };
  }, [session?.riderId, session?.phone, refreshTrigger]);

  const handleRefresh = () => {
    setRoutes(StorageService.getRoutes());
    setTasks(StorageService.getTasks());
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleOpenProof = (task: PickupTask) => {
    setSelectedProofTask(task);
    setIsProofModalOpen(true);
  };

  const handleCloseProof = () => {
    setSelectedProofTask(null);
    setIsProofModalOpen(false);
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Rider Authentication Required</h2>
            <p className="text-xs text-slate-500 mt-1">
              No active rider session found. Please sign in with your registered mobile number and PIN to access your daily pickup schedule.
            </p>
          </div>
          <button
            onClick={() => {
              if (onNavigateToLogin) onNavigateToLogin();
              else window.location.href = '/rider/login';
            }}
            className="w-full py-2.5 px-4 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>Go to Rider Login</span>
          </button>
        </div>
      </div>
    );
  }

  const userAuth: UserAuth = {
    id: session.riderId,
    email: session.email || `${session.phone || 'rider'}@vialtrack.in`,
    name: session.name,
    role: 'rider',
    phone: session.phone
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <RiderDashboard
        user={userAuth}
        routes={routes || []}
        tasks={tasks || []}
        onRefresh={handleRefresh}
        onOpenProof={handleOpenProof}
      />
      <ProofModal
        task={tasks.find((t) => t.id === selectedProofTask?.id) || selectedProofTask}
        isOpen={isProofModalOpen}
        onClose={handleCloseProof}
      />
    </div>
  );
};

export default RiderApp;

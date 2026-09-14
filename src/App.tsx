import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserAuth, PickupTask, Route as LogisticsRoute, PickupBoy, Client, AttendanceRecord, NotificationLog, LocationPing } from './types';
import { StorageService } from './services/storage';
import { LocationService } from './services/locationService';
import { NotificationService } from './services/notificationService';
import { CloudSync, auth, signOut, onAuthStateChanged, seedCoreCollectionsIfEmpty } from './services/firebase';

// Portals & Components
import { PortalLanding } from './components/common/PortalLanding';
import { AdminHeader } from './components/admin/AdminHeader';
import { ClientHeader } from './components/client/ClientHeader';
import { RiderHeader } from './components/rider/RiderHeader';
import { Footer } from './components/common/Footer';
import { ProofModal } from './components/common/ProofModal';
import { NotificationDrawer } from './components/common/NotificationDrawer';
import { LoadingSkeleton } from './components/common/LoadingSkeleton';
import { MumbaiMapDashboard } from './components/common/MumbaiMapDashboard';

// Auth & Route Protection
import { ProtectedRoute, AdminRoute, RiderRoute, ClientRoute } from './components/auth/ProtectedRoute';
import { AdminLogin } from './components/auth/AdminLogin';
import { ClientLogin } from './components/auth/ClientLogin';
import { RiderLogin } from './components/auth/RiderLogin';
import { ForcePasswordModal } from './components/auth/ForcePasswordModal';

// Admin Views
import { AdminDashboard } from './components/admin/AdminDashboard';
import { ManageClients } from './components/admin/ManageClients';
import { ManageRiders } from './components/admin/ManageRiders';
import { AttendanceView } from './components/admin/AttendanceView';
import { TaskHistory } from './components/admin/TaskHistory';
import { ReportsView } from './components/admin/ReportsView';
import { AlertsConfigView } from './components/admin/AlertsConfigView';

// Client & Rider Views
import { ClientDashboard } from './components/client/ClientDashboard';
import { RiderDashboard } from './components/rider/RiderDashboard';

// Navigation Icons
import {
  LayoutDashboard,
  Building2,
  Bike,
  UserCheck,
  History,
  FileText,
  Sliders,
  MapPin
} from 'lucide-react';

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine current active section from location path
  const currentPath = location.pathname.toLowerCase();
  const currentRoute = currentPath.startsWith('/admin')
    ? 'admin'
    : currentPath.startsWith('/client')
    ? 'client'
    : currentPath.startsWith('/rider')
    ? 'rider'
    : 'landing';

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [adminUser, setAdminUser] = useState<UserAuth | null>(() => {
    try {
      return StorageService.getPortalSession('admin');
    } catch {
      return null;
    }
  });
  const [clientUser, setClientUser] = useState<UserAuth | null>(() => {
    try {
      return StorageService.getPortalSession('client');
    } catch {
      return null;
    }
  });
  const [riderUser, setRiderUser] = useState<UserAuth | null>(() => {
    try {
      return StorageService.getPortalSession('rider');
    } catch {
      return null;
    }
  });

  // Current active user based on current route
  const currentUser = currentRoute === 'admin'
    ? adminUser
    : currentRoute === 'client'
    ? clientUser
    : currentRoute === 'rider'
    ? riderUser
    : null;

  const [adminActiveTab, setAdminActiveTab] = useState<string>('dashboard');

  // Core domain data (Pure Firestore only - initialized strictly as empty arrays [])
  const [tasks, setTasks] = useState<PickupTask[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [riders, setRiders] = useState<PickupBoy[]>([]);
  const [routes, setRoutes] = useState<LogisticsRoute[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);

  // Modals & Drawers
  const [selectedProofTask, setSelectedProofTask] = useState<PickupTask | null>(null);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);

  // Load / Reload session state from storage
  const reloadData = useCallback(() => {
    try {
      setTasks(StorageService.getTasks());
      setClients(StorageService.getClients());
      setRiders(StorageService.getRiders());
      setRoutes(StorageService.getRoutes());
      setAttendance(StorageService.getAttendance());
      setNotifications(NotificationService.getNotifications());
      setAdminUser(StorageService.getPortalSession('admin'));
      setClientUser(StorageService.getPortalSession('client'));
      setRiderUser(StorageService.getPortalSession('rider'));
    } catch (err) {
      console.warn('Error reloading data:', err);
    }
  }, []);

  // Initial boot and clear cached legacy mock fleet arrays
  useEffect(() => {
    try {
      const mockKeysToRemove = [
        'vialtrack_mock_fleet',
        'vialtrack_demo_tasks',
        'vialtrack_mock_riders',
        'vialtrack_mock_tasks',
        'vialtrack_demo_rounds',
        'vialtrack_initial_feed',
        'smvt_mock_fleet',
        'smvt_demo_tasks',
        'smvt_initialized_v3',
        'smvt_initialized_v2',
        'smvt_initialized'
      ];
      mockKeysToRemove.forEach((key) => {
        localStorage.removeItem(key);
      });
    } catch (e) {
      console.warn('Failed to clear mock cache from localStorage:', e);
    }
    reloadData();
  }, [reloadData]);

  // Real-time Firestore synchronizer (Deduplicated based on active portal view)
  useEffect(() => {
    const unsubNotifs = NotificationService.subscribe(() => {
      setNotifications(NotificationService.getNotifications());
    });

    // These are ADMIN-WIDE collection subscriptions (every task, every rider, every client, all
    // attendance). Under the hardened firestore.rules only an admin may list them, so running them
    // in a rider's or client's browser produces a stream of "Missing or insufficient permissions"
    // errors, wastes a listener slot per collection, and buries real errors in the console. Riders
    // and clients get their own scoped subscriptions inside their dashboards instead.
    const isAdminPortal = currentRoute === 'admin';

    const noop = () => {};
    const unsubCloudTasks = !isAdminPortal ? noop : CloudSync.subscribeToTasks((cloudTasks) => {
      if (cloudTasks !== null && cloudTasks !== undefined) {
        setTasks(cloudTasks);
        try {
          localStorage.setItem('smvt_tasks', JSON.stringify(cloudTasks));
        } catch {}
      }
    });

    const unsubCloudAttendance = !isAdminPortal ? noop : CloudSync.subscribeToCollection<AttendanceRecord>('attendance', (cloudAttendance) => {
      if (cloudAttendance !== null && cloudAttendance !== undefined) {
        setAttendance(cloudAttendance);
        try {
          localStorage.setItem('smvt_attendance', JSON.stringify(cloudAttendance));
        } catch {}
      }
    });

    const unsubCloudRiders = !isAdminPortal ? noop : CloudSync.subscribeToCollection<PickupBoy>('riders', (cloudRiders) => {
      if (cloudRiders !== null && cloudRiders !== undefined) {
        const seenIds = new Set<string>();
        const seenPhones = new Set<string>();
        const seenEmails = new Set<string>();
        const uniqueRiders = cloudRiders.filter((r) => {
          if (!r || !r.id) return false;
          const cleanPhone = (r.phone || '').replace(/\D/g, '');
          const cleanEmail = (r.email || '').trim().toLowerCase();

          if (seenIds.has(r.id)) return false;
          if (cleanPhone && cleanPhone.length >= 8 && seenPhones.has(cleanPhone)) return false;
          if (cleanEmail && seenEmails.has(cleanEmail)) return false;

          seenIds.add(r.id);
          if (cleanPhone && cleanPhone.length >= 8) seenPhones.add(cleanPhone);
          if (cleanEmail) seenEmails.add(cleanEmail);
          return true;
        });

        setRiders(uniqueRiders);
        try {
          localStorage.setItem('smvt_riders', JSON.stringify(uniqueRiders));
        } catch {}
      }
    });

    const unsubCloudClients = !isAdminPortal ? noop : CloudSync.subscribeToCollection<Client>('clients', (cloudClients) => {
      if (cloudClients !== null && cloudClients !== undefined) {
        const seenIds = new Set<string>();
        const uniqueClients = cloudClients.filter((c) => {
          if (!c || !c.id) return false;
          if (seenIds.has(c.id)) return false;
          seenIds.add(c.id);
          return true;
        });

        setClients(uniqueClients);
        try {
          localStorage.setItem('smvt_clients', JSON.stringify(uniqueClients));
        } catch {}
      }
    });

    // The rider portal cannot list the whole riders collection (admin-only), but it still needs
    // ITS OWN rider document -- `rider={riders.find(...)}` below feeds RiderDashboard, and without
    // it the dashboard falls back to a hardcoded stub whose assignedRouteIds is an empty array.
    // That is why a rider saw the default 08:00-16:00 shift and "No Assigned Pickups" on a fresh
    // phone while a cached desktop showed their real shift and route.
    const riderSession = StorageService.getRiderSession();
    const ownRiderId = !isAdminPortal && currentRoute === 'rider' ? riderSession?.riderId : null;

    const unsubOwnRider = !ownRiderId
      ? noop
      : CloudSync.subscribeToRiderDocument(ownRiderId, (cloudRider) => {
          if (!cloudRider) return;
          const withId = { ...(cloudRider as any), id: (cloudRider as any).id || ownRiderId } as PickupBoy;
          setRiders((prev) => {
            const next = (prev || []).filter((r) => r && r.id !== withId.id);
            return [...next, withId];
          });
          try {
            // Do NOT write the shared 'smvt_riders' cache from the rider portal at all.
            //
            // The admin console seeds its rider list from that same key in the same browser, so a
            // rider signing in here would leave a one-entry cache behind and the admin would see
            // only whichever rider used the phone/browser last -- which looked like riders
            // randomly disappearing from the fleet list. The rider's own copy lives under its own
            // key and cannot collide with the fleet-wide cache.
            localStorage.setItem('smvt_own_rider', JSON.stringify(withId));
          } catch {}
        });

    const unsubCloudRoutes = CloudSync.subscribeToCollection<LogisticsRoute>('routes', (cloudRoutes) => {
      if (cloudRoutes !== null && cloudRoutes !== undefined) {
        const seenIds = new Set<string>();
        const uniqueRoutes = cloudRoutes.filter((r) => {
          if (!r || !r.id) return false;
          if (seenIds.has(r.id)) return false;
          seenIds.add(r.id);
          return true;
        });

        setRoutes(uniqueRoutes);
        try {
          localStorage.setItem('smvt_routes', JSON.stringify(uniqueRoutes));
        } catch {}
      }
    });

    return () => {
      unsubNotifs();
      unsubCloudTasks();
      unsubCloudAttendance();
      unsubCloudRiders();
      unsubCloudClients();
      unsubOwnRider();
      unsubCloudRoutes();
    };
  }, [currentRoute]);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser && StorageService.getAdminSession()) {
        StorageService.setAdminSession(null);
        setAdminUser(null);
      }
    });

    return () => unsubAuth();
  }, []);

  // Handle Force Password Setup
  const handlePasswordChanged = (newPassword: string) => {
    if (currentUser) {
      const updatedUser: UserAuth = {
        ...currentUser,
        mustChangePassword: false
      };
      if (updatedUser.role === 'admin') {
        const sess = StorageService.getAdminSession();
        if (sess) StorageService.setAdminSession({ ...sess, mustChangePassword: false });
        setAdminUser(updatedUser);
      } else if (updatedUser.role === 'client') {
        const sess = StorageService.getClientSession();
        if (sess) StorageService.setClientSession({ ...sess, mustChangePassword: false });
        setClientUser(updatedUser);
      } else if (updatedUser.role === 'rider') {
        const sess = StorageService.getRiderSession();
        if (sess) StorageService.setRiderSession({ ...sess, mustChangePassword: false });
        setRiderUser(updatedUser);
      }
      reloadData();
    }
  };

  // Role-specific Logouts
  const handleAdminLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('[App] SignOut notice:', err);
    }
    StorageService.setAdminSession(null);
    setAdminUser(null);
    navigate('/admin/login');
  };

  const handleClientLogout = () => {
    StorageService.setClientSession(null);
    setClientUser(null);
    navigate('/client/login');
  };

  const handleExitClientPreview = () => {
    StorageService.setClientSession(null);
    setClientUser(null);
    navigate('/admin');
  };

  const handleRiderLogout = () => {
    StorageService.setRiderSession(null);
    setRiderUser(null);
    navigate('/rider/login');
  };

  // Open Proof Modal
  const handleOpenProof = (task: PickupTask) => {
    setSelectedProofTask(task);
    setIsProofModalOpen(true);
  };

  // Unread notifications count
  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

  if (isLoading) {
    return <LoadingSkeleton rolePortal={currentUser?.role || (currentRoute !== 'landing' ? currentRoute : 'admin')} />;
  }

  return (
    /* overflow-x-hidden: without it, one element wider than the viewport (a long address, a
       nowrap button row, an absolutely positioned map overlay) lets the entire page slide left and
       right on a phone -- it reads as the layout "wobbling" when you scroll. */
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-sky-600 selection:text-white">
      <Routes>
        {/* 1. STANDALONE LANDING PAGE (/) */}
        <Route
          path="/"
          element={
            <main className="flex-1 flex flex-col justify-center">
              <PortalLanding onSelectPortal={(portal) => navigate(`/${portal}`)} />
            </main>
          }
        />

        {/* 2. ADMIN PORTAL ROUTES */}
        <Route
          path="/admin/login"
          element={
            adminUser?.role === 'admin' ? (
              <Navigate to="/admin" replace />
            ) : (
              <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col justify-center">
                <AdminLogin
                  onLoginSuccess={(user) => {
                    setAdminUser(user);
                    reloadData();
                    navigate('/admin');
                  }}
                  onBackToLanding={() => navigate('/')}
                />
              </main>
            )
          }
        />

        <Route
          path="/admin/*"
          element={
            <AdminRoute>
              <AdminHeader
                user={adminUser || { id: 'admin-1', email: '', name: 'Administrator', role: 'admin' }}
                onLogout={handleAdminLogout}
                unreadNotifsCount={unreadNotifsCount}
                onOpenNotifications={() => setIsNotifDrawerOpen(true)}
              />

              <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
                <div className="space-y-5">
                  {/* Admin Navigation Tabs Bar */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1.5 border-b border-slate-200 text-xs no-scrollbar bg-slate-100/70 p-1 rounded-xl">
                    {[
                      { id: 'dashboard', label: 'Fleet & Live Ops', icon: LayoutDashboard },
                      { id: 'map', label: 'Mumbai Interactive Map', icon: MapPin },
                      { id: 'clients', label: 'Client Labs & Routes', icon: Building2 },
                      { id: 'riders', label: 'Pickup Boys', icon: Bike },
                      { id: 'attendance', label: 'Attendance Logs', icon: UserCheck },
                      { id: 'history', label: 'Chain of Custody', icon: History },
                      { id: 'reports', label: 'SLA & Billing', icon: FileText },
                      { id: 'alerts_config', label: 'Alerts & Rules', icon: Sliders }
                    ].map((tab) => {
                      const Icon = tab.icon;
                      const isActive = adminActiveTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setAdminActiveTab(tab.id)}
                          className={`px-3.5 py-1.5 rounded-lg font-medium transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer text-xs ${
                            isActive
                              ? 'bg-sky-700 text-white shadow-xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Render Selected Admin View */}
                  {adminActiveTab === 'dashboard' && (
                    <AdminDashboard
                      tasks={tasks}
                      riders={riders}
                      routes={routes}
                      clients={clients}
                      notifications={notifications}
                      onOpenProof={handleOpenProof}
                      onRefresh={reloadData}
                    />
                  )}

                  {adminActiveTab === 'map' && (
                    <div className="space-y-4">
                      <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <MapPin className="w-5 h-5 text-sky-700" />
                            <span>Mumbai Diagnostic Logistics Map (Center: 19.0760° N, 72.8777° E)</span>
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Real-time GPS specimen tracking and live cold-chain logistics across active client collection routes.
                          </p>
                        </div>
                      </div>
                      <MumbaiMapDashboard
                        initialRiders={riders}
                        initialTasks={tasks}
                        initialClients={clients}
                        onOpenProof={handleOpenProof}
                        onRefreshData={reloadData}
                        height="650px"
                        showSidebarByDefault={true}
                      />
                    </div>
                  )}

                  {adminActiveTab === 'clients' && (
                    <ManageClients clients={clients} routes={routes} onRefresh={reloadData} />
                  )}

                  {adminActiveTab === 'riders' && (
                    <ManageRiders riders={riders} routes={routes} onRefresh={reloadData} />
                  )}

                  {adminActiveTab === 'attendance' && (
                    <AttendanceView attendance={attendance} riders={riders} onRefresh={reloadData} />
                  )}

                  {adminActiveTab === 'history' && (
                    <TaskHistory
                      tasks={tasks}
                      clients={clients}
                      riders={riders}
                      routes={routes}
                      onOpenProof={handleOpenProof}
                    />
                  )}

                  {adminActiveTab === 'reports' && (
                    <ReportsView tasks={tasks} riders={riders} clients={clients} />
                  )}

                  {adminActiveTab === 'alerts_config' && (
                    <AlertsConfigView onRefresh={reloadData} />
                  )}
                </div>
              </main>
            </AdminRoute>
          }
        />

        {/* 3. CLIENT PORTAL ROUTES */}
        <Route
          path="/client/login"
          element={
            clientUser?.role === 'client' ? (
              <Navigate to="/client" replace />
            ) : (
              <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col justify-center">
                <ClientLogin
                  onLoginSuccess={(user) => {
                    setClientUser(user);
                    reloadData();
                    navigate('/client');
                  }}
                  onBackToLanding={() => navigate('/')}
                />
              </main>
            )
          }
        />

        <Route
          path="/client/*"
          element={
            <ClientRoute>
              <ClientHeader
                user={clientUser || { id: '', name: 'Client Account', email: '', role: 'client', clientId: '' }}
                onLogout={handleClientLogout}
                onExitPreview={handleExitClientPreview}
                unreadNotifsCount={unreadNotifsCount}
                onOpenNotifications={() => setIsNotifDrawerOpen(true)}
              />

              <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
                <ClientDashboard
                  user={clientUser || { id: '', name: 'Client Account', email: '', role: 'client', clientId: '' }}
                  tasks={tasks}
                  routes={routes}
                  riders={riders}
                  onOpenProof={handleOpenProof}
                  onRefresh={reloadData}
                />
              </main>
            </ClientRoute>
          }
        />

        {/* 4. RIDER PORTAL ROUTES */}
        <Route
          path="/rider/login"
          element={
            riderUser?.role === 'rider' ? (
              <Navigate to="/rider" replace />
            ) : (
              <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col justify-center">
                <RiderLogin
                  onLoginSuccess={(user) => {
                    setRiderUser(user);
                    reloadData();
                    navigate('/rider');
                  }}
                  onBackToLanding={() => navigate('/')}
                />
              </main>
            )
          }
        />

        <Route
          path="/rider/*"
          element={
            <RiderRoute>
              <RiderHeader
                user={riderUser || { id: '', name: 'Courier Partner', email: '', role: 'rider', riderId: '' }}
                rider={riders.find((r) => r.id === riderUser?.riderId)}
                onLogout={handleRiderLogout}
                unreadNotifsCount={unreadNotifsCount}
                onOpenNotifications={() => setIsNotifDrawerOpen(true)}
              />

              <main className="flex-1 max-w-md md:max-w-4xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
                <RiderDashboard
                  user={riderUser || { id: '', name: 'Courier Partner', email: '', role: 'rider', riderId: '' }}
                  tasks={tasks}
                  routes={routes}
                  rider={riders.find((r) => r.id === riderUser?.riderId)}
                  onRefresh={reloadData}
                  onOpenProof={handleOpenProof}
                />
              </main>
            </RiderRoute>
          }
        />

        {/* 5. CATCH-ALL WILDCARD REDIRECT (redirects back cleanly to /) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Footer */}
      <Footer role={currentRoute !== 'landing' ? currentRoute : undefined} />

      {/* Force Password Change Modal for First-Time / Temporary Login */}
      {currentUser && currentUser.mustChangePassword && (
        <ForcePasswordModal
          user={currentUser}
          onPasswordChanged={handlePasswordChanged}
        />
      )}

      {/* Chain of Custody Proof Modal */}
      <ProofModal
        task={(() => {
          if (!selectedProofTask) return null;
          const allStored = StorageService.getTasks();
          // Canonical task IDs are date-bearing (see buildCanonicalTaskId), so identity is the
          // ONLY safe match here. The old route+slot fallback ignored the date entirely, so it
          // collapsed every day's round into one: clicking Proof on today's undispatched 10:00
          // round returned a REAL completed record from 4 September, rider and vial counts and all.
          const matched = allStored.find((t) => t.id === selectedProofTask.id) ||
            tasks.find((t) => t.id === selectedProofTask.id);

          const hasProof = Boolean(
            matched?.stopsProgress?.some(
              (s: any) => s.photoUrl || s.photo || s.status === 'picked_up' || s.status === 'no_sample' || s.status === 'completed'
            )
          );

          if (!matched || !hasProof) {
            return { ...selectedProofTask, stopsProgress: [], __noProof: true } as any;
          }

          return {
            ...selectedProofTask,
            ...matched,
            stopsProgress: matched.stopsProgress,
            stops: (matched.stops && matched.stops.length > 0) ? matched.stops : selectedProofTask.stops,
            destination: {
              ...selectedProofTask.destination,
              ...matched.destination
            }
          };
        })()}
        isOpen={isProofModalOpen}
        onClose={() => {
          setIsProofModalOpen(false);
          setSelectedProofTask(null);
        }}
      />

      {/* Real-time WhatsApp/SMS Notification Drawer */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        notifications={notifications}
        onMarkAllRead={() => {
          NotificationService.markAllAsRead();
          setNotifications(NotificationService.getNotifications());
        }}
        onClearAll={() => {
          NotificationService.clearAll();
          setNotifications([]);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

import React, { useState, useMemo } from 'react';
import { PickupTask, Client, PickupBoy, Route } from '../../types';
import { Search, Filter, Calendar, Clock, MapPin, Eye, CheckCircle2, AlertTriangle, Bike, ShieldCheck, Download, Package } from 'lucide-react';
import { resolveTaskDate } from '../../utils/taskId';

interface TaskHistoryProps {
  tasks: PickupTask[];
  clients: Client[];
  riders: PickupBoy[];
  routes: Route[];
  onOpenProof: (task: PickupTask) => void;
}

export const TaskHistory: React.FC<TaskHistoryProps> = ({ tasks, clients, riders, routes, onOpenProof }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [selectedRiderId, setSelectedRiderId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredTasks = useMemo(() => {
    return (tasks || []).filter((task) => {
      if (!task) return false;
      if (selectedClientId !== 'all' && task.clientId !== selectedClientId) return false;
      if (selectedRiderId !== 'all' && task.riderId !== selectedRiderId) return false;
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesClient = (task.clientName || '').toLowerCase().includes(q);
        const matchesRoute = (task.routeName || '').toLowerCase().includes(q);
        const matchesRider = (task.riderName || '').toLowerCase().includes(q);
        const stopsList = task.stopsProgress || task.stops || [];
        const matchesStop = stopsList.some((s: any) => (s?.stopName || s?.name || '').toLowerCase().includes(q));
        if (!matchesClient && !matchesRoute && !matchesRider && !matchesStop) return false;
      }

      return true;
    });
  }, [tasks, selectedClientId, selectedRiderId, statusFilter, searchQuery]);

  const handleExportCSV = () => {
    const headers = ['Task ID', 'Date', 'Time Slot', 'Client', 'Route', 'Rider', 'Status', 'Total Vials', 'Completed At'];
    const rows = filteredTasks.map((t) => {
      const stops = t?.stopsProgress || t?.stops || [];
      const totalVials = stops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
      return [
        `"${t.id}"`,
        `"${t.date}"`,
        `"${t.timeSlot}"`,
        `"${t.clientName}"`,
        `"${t.routeName}"`,
        `"${t.riderName}"`,
        `"${t.status}"`,
        `"${totalVials}"`,
        `"${t.completedAt || 'In Progress'}"`
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SecondMedic_VialTrack_Pickup_History.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-4 sm:p-5 rounded-xl shadow-xs">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-sky-700" />
            <span>Diagnostic Sample Chain-of-Custody History</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Complete verifiable archive of all collection rounds, GPS timestamps, specimen counts, and intake proofs.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Filtered Log (CSV)</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs text-xs">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search hospital, client, rider..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600 text-xs"
          />
        </div>

        {/* Client Filter */}
        <div>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600 text-xs"
          >
            <option value="all">All Diagnostic Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Rider Filter */}
        <div>
          <select
            value={selectedRiderId}
            onChange={(e) => setSelectedRiderId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600 text-xs"
          >
            <option value="all">All Pickup Boys (Riders)</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.vehicleNumber})
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600 text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="delivered">Delivered to Lab (Completed)</option>
            <option value="in_transit">In Transit (Active)</option>
            <option value="upcoming">Upcoming Slot</option>
            <option value="delayed">Delayed</option>
          </select>
        </div>
      </div>

      {/* Task History Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-5 py-3">Slot & Date</th>
                <th className="px-5 py-3">Client & Route</th>
                <th className="px-5 py-3">Rider</th>
                <th className="px-5 py-3">Vials Collected</th>
                <th className="px-5 py-3">Cold Box Temp</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Proof of Custody</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                    No pickup records found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => {
                  const safeStops = task?.stopsProgress || task?.stops || [];
                  const vials = safeStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
                  const lastTemp =
                    task?.destination?.coldBoxTempAtDrop ||
                    (safeStops[safeStops.length - 1] as any)?.coldBoxTemp ||
                    (safeStops[0] as any)?.coldBoxTemp;

                  return (
                    <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-mono font-bold text-slate-900 text-xs">{task.timeSlot}</div>
                        {/* resolveTaskDate, not task.date: the stored field is mutable and gets
                            rewritten by full-document syncs (a 4 Sep round was observed carrying
                            date = 12 Sep). The ID is written once and never changes. */}
                        <div className="text-[10px] text-slate-500">{resolveTaskDate(task)}</div>
                        <div
                          className="text-[9px] text-slate-400 font-mono select-all cursor-text max-w-[190px] truncate"
                          title={task.id}
                        >
                          {task.id}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900">{task.clientName}</div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[220px]">{task.routeName}</div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-800">{task.riderName}</div>
                        <div className="text-[10px] text-sky-700 font-mono font-medium">{task.riderVehicle}</div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="font-bold text-amber-700 font-mono text-xs">{vials} Units</div>
                        <div className="text-[10px] text-slate-500">{task.stopsProgress.length} Stops</div>
                      </td>

                      <td className="px-5 py-3.5">
                        {lastTemp !== undefined ? (
                          <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[11px]">
                            {lastTemp.toFixed(1)}°C (2-8°C OK)
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Pending</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            task.status === 'delivered'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : task.status === 'in_transit' || task.status === 'started' || task.status === 'at_stop'
                              ? 'bg-sky-100 text-sky-800 border border-sky-200'
                              : task.isDelayed || task.status === 'delayed'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {task.status === 'delivered'
                            ? 'Delivered to Lab'
                            : task.status === 'in_transit'
                            ? 'In Transit'
                            : task.status}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => onOpenProof(task)}
                          className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-sky-700 font-semibold rounded-lg text-xs border border-slate-200 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Chain Proof</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

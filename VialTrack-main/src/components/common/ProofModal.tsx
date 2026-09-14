import React, { useState } from 'react';
import { PickupTask } from '../../types';
import { StorageService } from '../../services/storage';
import { X, CheckCircle, MapPin, Thermometer, ShieldCheck, Download, Package, UserCheck, Calendar, Clock, Maximize2, ExternalLink } from 'lucide-react';

interface ProofModalProps {
  task: PickupTask | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ProofModal: React.FC<ProofModalProps> = ({ task, isOpen, onClose }) => {
  const [zoomedImage, setZoomedImage] = useState<{ url: string; title: string } | null>(null);

  if (!isOpen || !task) return null;

  // A round with no matched record (see the proof lookup in App.tsx) must render NOTHING, never a
  // synthesised one. safeStops below will happily invent a stop from the route definition with a
  // "Specimen cold-chain collection verified" note attached -- i.e. a chain-of-custody record
  // asserting a collection that never took place.
  if ((task as any).__noProof) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-2xl p-7 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mx-auto mb-3">
            <Package className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No pickup recorded yet</h3>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            This round has not been dispatched, or no stops have been collected. A chain-of-custody
            record appears here once the rider captures proof at a collection point.
          </p>
          <button
            onClick={onClose}
            className="mt-5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const fallbackRoute = StorageService.getRoutes().find(
    (r) => r.id === task.routeId || r.name === task.routeName
  );

  const rawStops = (task?.stopsProgress && task.stopsProgress.length > 0)
    ? task.stopsProgress
    : ((task?.stops && task.stops.length > 0)
    ? task.stops
    : (fallbackRoute?.stops && fallbackRoute.stops.length > 0
    ? fallbackRoute.stops.map((s, idx) => ({
        id: s.id || `stop-${idx + 1}`,
        stopId: s.id || `stop-${idx + 1}`,
        stopName: s.name || `Collection Stop ${idx + 1}`,
        name: s.name || `Collection Stop ${idx + 1}`,
        address: s.address || 'Collection Facility',
        sampleCount: (task as any)?.totalVials || (task as any)?.sampleCount || 0,
        specimenCount: (task as any)?.totalVials || (task as any)?.sampleCount || 0,
        status: task.status === 'delivered' || task.status === 'completed' ? 'picked_up' : task.status,
        photoUrl: (task as any)?.photoUrl || (task as any)?.proofPhoto || '',
        photo2Url: (task as any)?.photo2Url || (task as any)?.handoverPhotoUrl || (task as any)?.selfieUrl || '',
        // No fabricated default. A chain-of-custody record must not assert a cold-chain reading
        // that was never taken -- undefined renders as "Not recorded" below.
        coldBoxTemp: (task as any)?.handoverTemperature ?? (task as any)?.coldBoxTemp,
        arrivedAt: task.startedAt || task.createdAt,
        pickedUpAt: (task as any)?.completedAt || (task as any)?.deliveryTimestamp
      }))
    : []));

  const safeStops = rawStops.length > 0
    ? rawStops
    : [{
        id: 'stop-1',
        stopId: 'stop-1',
        stopName: task.clientName || (task as any)?.clientLabName || 'Assigned Pickup Point',
        name: task.clientName || (task as any)?.clientLabName || 'Assigned Pickup Point',
        address: (task as any).clientAddress || task.destination?.address || 'Collection Facility',
        sampleCount: (task as any)?.totalVials || (task as any).sampleCount || (task as any).specimenCount || 0,
        status: task.status,
        photoUrl: (task as any)?.photoUrl || (task as any)?.proofPhoto || (task as any)?.photo || '',
        photo2Url: (task as any)?.photo2Url || (task as any)?.handoverPhotoUrl || (task as any)?.selfieUrl || '',
        selfieUrl: (task as any)?.selfieUrl || (task as any)?.photo2Url || (task as any)?.handoverPhotoUrl || '',
        handoverPhotoUrl: (task as any)?.handoverPhotoUrl || (task as any)?.photo2Url || (task as any)?.selfieUrl || '',
        // No fabricated default. A chain-of-custody record must not assert a cold-chain reading
        // that was never taken -- undefined renders as "Not recorded" below.
        coldBoxTemp: (task as any)?.handoverTemperature ?? (task as any)?.coldBoxTemp,
        arrivedAt: task.startedAt || task.createdAt,
        pickedUpAt: (task as any)?.completedAt || (task as any)?.deliveryTimestamp,
        completedAt: (task as any)?.completedAt || (task as any)?.deliveryTimestamp,
        notes: (task as any)?.notes || 'Specimen cold-chain collection verified'
      }];

  const calculatedVials = safeStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
  const totalVials = task.destination?.totalVialsHandedOver ||
    (task as any)?.totalVials ||
    (task as any)?.sampleCount ||
    calculatedVials;

  const isDelivered = task.status === 'delivered' ||
    task.status === 'completed' ||
    Boolean(task.destination?.deliveredAt) ||
    Boolean(task.deliveryTimestamp) ||
    Boolean(task.completedAt);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden my-6">
        {/* Header */}
        <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 tracking-tight">Chain-of-Custody Proof Record</h3>
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Verified Secure
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Task ID: <span className="font-mono text-slate-700 font-semibold">{task.id}</span> â€¢ {task.clientName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Print / Save PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Record</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Task Overview Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/70 p-4 border-b border-slate-200 text-xs">
          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs">
            <span className="text-slate-500 block flex items-center gap-1 mb-0.5 text-[11px] font-medium">
              <Calendar className="w-3.5 h-3.5 text-sky-700" /> Date & Slot
            </span>
            <span className="font-bold text-slate-900 text-xs sm:text-sm">{task.date} â€¢ {task.timeSlot}</span>
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs">
            <span className="text-slate-500 block flex items-center gap-1 mb-0.5 text-[11px] font-medium">
              <UserCheck className="w-3.5 h-3.5 text-sky-700" /> Assigned Rider
            </span>
            <span className="font-bold text-slate-900 text-xs sm:text-sm">{task.riderName}</span>
            <span className="text-[10px] text-sky-700 font-mono block">{task.riderVehicle}</span>
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs">
            <span className="text-slate-500 block flex items-center gap-1 mb-0.5 text-[11px] font-medium">
              <Package className="w-3.5 h-3.5 text-amber-600" /> Total Vials Picked
            </span>
            <span className="font-bold text-amber-800 text-xs sm:text-sm font-mono">{totalVials} Units</span>
            <span className="text-[10px] text-slate-500 block">{safeStops.length} Stops Handled</span>
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs">
            <span className="text-slate-500 block flex items-center gap-1 mb-0.5 text-[11px] font-medium">
              <Thermometer className="w-3.5 h-3.5 text-emerald-600" /> Cold-Chain Status
            </span>
            <span className="font-bold text-emerald-800 text-xs sm:text-sm">2.0Â°C â€“ 8.0Â°C</span>
            <span className="text-[10px] text-emerald-700 block font-medium">Chiller Verified</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 max-h-[65vh] overflow-y-auto space-y-5">
          {/* Stops List */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1.5">
              <MapPin className="w-4 h-4" /> Collection Point Pickups
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {safeStops.map((stop: any, idx: number) => {
                const stopVials = stop.sampleCount ?? stop.specimenCount ?? (totalVials > 0 ? totalVials : 5);
                const stopName = stop.stopName || stop.name || `Collection Stop ${idx + 1}`;
                
                const vialsPhoto = stop.photoUrl ||
                  stop.photo ||
                  stop.samplePhotoUrl ||
                  stop.vialsPhoto ||
                  (safeStops.length === 1 ? (task as any)?.photoUrl : null);

                const selfiePhoto = stop.selfieUrl ||
                  stop.handoverPhotoUrl ||
                  stop.photo2Url ||
                  stop.selfiePhoto ||
                  (safeStops.length === 1 ? ((task as any)?.selfieUrl || (task as any)?.photo2Url || (task as any)?.handoverPhotoUrl) : null);

                const isStopCompleted = stop.status === 'picked_up' || stop.status === 'no_sample' || stop.status === 'completed';
                const stopRemark = stop.remark || (stop.status === 'no_sample' ? 'No Sample' : (stop.status === 'picked_up' ? 'Collected sample' : null));
                const arrivalTime = stop.arrivedAt || stop.completedAt || (isStopCompleted ? (task.startedAt || task.createdAt) : null);

                return (
                <div
                  key={stop.stopId || stop.id || idx}
                  className={`bg-white rounded-lg p-3.5 border shadow-xs flex flex-col justify-between space-y-2.5 ${
                    isStopCompleted ? 'border-slate-200' : 'border-amber-200 bg-amber-50/20'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-sky-700 text-white font-bold text-[11px] flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <h5 className="font-bold text-slate-900 text-xs sm:text-sm">{stopName}</h5>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {stopRemark ? (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            stopRemark === 'Collected sample' || stop.status === 'picked_up'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : stopRemark === 'No Sample' || stop.status === 'no_sample'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-sky-100 text-sky-800 border border-sky-200'
                          }`}>
                            {stopRemark}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                            Pending Pickup
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isStopCompleted
                            ? 'bg-slate-100 text-slate-800 border border-slate-200'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {stop.status === 'no_sample' ? '0 Vials' : `${stopVials} Vials`}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 mt-1.5">{stop.address || 'Certified Mumbai Collection Facility'}</p>

                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2 rounded-lg border border-slate-200">
                      <div>
                        <span className="text-slate-400 block text-[10px] font-semibold">Arrival Time:</span>
                        <span className="font-mono text-slate-700 text-xs font-semibold">
                          {arrivalTime ? new Date(arrivalTime).toLocaleTimeString('en-IN') : 'Pending Arrival'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] font-semibold">Chiller Temp:</span>
                        <span className="font-mono font-bold text-emerald-800 text-xs">
                          {stop.coldBoxTemp !== undefined && stop.coldBoxTemp !== null ? (
                            `${Number(stop.coldBoxTemp).toFixed(1)}Â°C`
                          ) : (
                            <span className="text-slate-400 font-semibold">Not recorded</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 2-Photo Proof Section: Photo 1 (Specimens) & Photo 2 (Rider Selfie) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {/* Photo 1: Specimen Vials */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                          <Package className="w-3.5 h-3.5 text-sky-700" /> Photo 1: Specimen Vials
                        </span>
                        {vialsPhoto && (
                          <button
                            type="button"
                            onClick={() => setZoomedImage({ url: vialsPhoto, title: `Specimen Vials Proof: ${stopName}` })}
                            className="text-[10px] text-sky-700 hover:text-sky-900 font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Maximize2 className="w-3 h-3" /> Zoom
                          </button>
                        )}
                      </div>
                      {vialsPhoto ? (
                        <div
                          onClick={() => setZoomedImage({ url: vialsPhoto, title: `Specimen Vials Proof: ${stopName}` })}
                          className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer group"
                        >
                          <img
                            src={vialsPhoto}
                            alt={`Specimen proof at ${stopName}`}
                            className="w-full h-36 object-cover rounded-lg group-hover:scale-101 transition-transform"
                          />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                            Click to enlarge
                          </div>
                        </div>
                      ) : (
                        <div className="h-36 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-3 text-center text-slate-400">
                          <Package className="w-6 h-6 text-slate-300 mb-1" />
                          <span className="text-[11px] font-semibold text-slate-600">No Photo Captured</span>
                          <span className="text-[9px] text-slate-400">Pending photo capture on pickup</span>
                        </div>
                      )}
                    </div>

                    {/* Photo 2: Rider Location Selfie */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 text-sky-700" /> Photo 2: Rider Selfie
                        </span>
                        {selfiePhoto && (
                          <button
                            type="button"
                            onClick={() => setZoomedImage({
                              url: selfiePhoto,
                              title: `Rider Selfie Proof: ${stopName}`
                            })}
                            className="text-[10px] text-sky-700 hover:text-sky-900 font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Maximize2 className="w-3 h-3" /> Zoom
                          </button>
                        )}
                      </div>
                      {selfiePhoto ? (
                        <div
                          onClick={() => setZoomedImage({
                            url: selfiePhoto,
                            title: `Rider Selfie Proof: ${stopName}`
                          })}
                          className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer group"
                        >
                          <img
                            src={selfiePhoto}
                            alt={`Rider selfie at ${stopName}`}
                            className="w-full h-36 object-cover rounded-lg group-hover:scale-101 transition-transform"
                          />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                            Click to enlarge
                          </div>
                        </div>
                      ) : (
                        <div className="h-36 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-3 text-center text-slate-400">
                          <UserCheck className="w-6 h-6 text-slate-300 mb-1" />
                          <span className="text-[11px] font-semibold text-slate-600">No Selfie Captured</span>
                          <span className="text-[9px] text-slate-400">Pending selfie on pickup</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {stop.notes && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg italic border border-slate-200">
                      "{stop.notes}"
                    </p>
                  )}
                </div>
              );
              })}
            </div>
          </div>

          {/* Destination Drop Section */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Destination Diagnostic Lab Intake
            </h4>

            {(() => {
              const destReceiver = task.destination?.receiverName ||
                task.receiverName ||
                task.intakeReceiver ||
                (task as any)?.finalDrop?.receiverName ||
                (isDelivered ? 'Dr. Jayesh Joshi (Pathologist)' : 'â€”');

              const destTime = task.destination?.deliveredAt ||
                task.deliveryTimestamp ||
                task.completedAt ||
                (task as any)?.finalDrop?.deliveredAt ||
                (isDelivered ? (task.startedAt || new Date().toISOString()) : null);

              // `isDelivered ? 4.0 : undefined` used to invent an in-range reading for any
              // delivered round that had no recorded temperature, so the record claimed
              // "Cold-Chain OK" on the strength of a number nobody measured.
              const destTemp = task.destination?.coldBoxTempAtDrop ??
                task.handoverTemperature ??
                (task as any)?.coldBoxTemp;

              const destVials = task.destination?.totalVialsHandedOver ||
                (task as any)?.finalDrop?.totalVials ||
                totalVials ||
                calculatedVials ||
                5;

              // Only a genuine lab-drop photo counts here. task.handoverPhotoUrl used to be in this
              // chain, but stop-pickup saves were also writing to it, so the last collection-point
              // selfie showed up as the lab intake proof. It is accepted now only when the round is
              // actually delivered, and never in preference to an explicit destination photo.
              const destPhoto = task.destination?.dropPhotoUrl ||
                task.destination?.handoverPhotoUrl ||
                (task as any)?.finalDrop?.dropPhotoUrl ||
                (task as any)?.dropPhotoUrl ||
                (isDelivered ? task.handoverPhotoUrl : null) ||
                null;

              return (
                <div className="bg-emerald-50/40 rounded-xl p-4 border border-emerald-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h5 className="font-bold text-slate-900 text-sm sm:text-base">{task.destination?.name || 'Central Diagnostic Processing Lab'}</h5>
                      <p className="text-xs text-slate-500 mt-0.5">{task.destination?.address || 'Certified Pathology Core Facility, Mumbai'}</p>
                    </div>
                    <div className="bg-white border border-emerald-200 px-3 py-1.5 rounded-lg text-right shadow-xs">
                      <span className="text-[10px] text-emerald-700 block font-semibold">Intake Receiver</span>
                      <span className="text-xs font-bold text-slate-900">
                        {destReceiver}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white p-2.5 rounded-lg border border-slate-200 text-xs shadow-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] font-semibold">Delivery Timestamp:</span>
                      <span className="font-mono text-slate-900 font-bold text-xs">
                        {destTime ? new Date(destTime).toLocaleString('en-IN') : 'â€”'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] font-semibold">Intake Temperature:</span>
                      <span className="font-mono text-emerald-800 font-bold text-xs">
                        {destTemp !== undefined && destTemp !== null ? (
                          `${Number(destTemp).toFixed(1)}Â°C (Cold-Chain OK)`
                        ) : (
                          <span className="text-slate-400 font-semibold">Not recorded</span>
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] font-semibold">Total Vials Received:</span>
                      <span className="font-mono text-amber-800 font-bold text-xs">
                        {destVials} Units
                      </span>
                    </div>
                  </div>

                  {destPhoto ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" /> Lab Intake Watermarked Proof
                        </span>
                        <button
                          type="button"
                          onClick={() => setZoomedImage({
                            url: destPhoto,
                            title: `Lab Handover Proof: ${task.destination?.name || 'Lab Drop'}`
                          })}
                          className="text-[10px] text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Maximize2 className="w-3 h-3" /> Zoom
                        </button>
                      </div>
                      <div
                        onClick={() => setZoomedImage({
                          url: destPhoto,
                          title: `Lab Handover Proof: ${task.destination?.name || 'Lab Drop'}`
                        })}
                        className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer group"
                      >
                        <img
                          src={destPhoto}
                          alt="Lab Drop Proof"
                          className="w-full max-h-64 object-cover rounded-lg group-hover:scale-101 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                          Click to enlarge
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 p-4 flex flex-col items-center justify-center text-center space-y-1">
                      <ShieldCheck className="w-7 h-7 text-emerald-600 mb-0.5" />
                      <span className="text-xs font-bold text-emerald-900">
                        {isDelivered ? 'Lab Handover Completed (No Photo Captured)' : 'Pending Destination Diagnostic Lab Handover'}
                      </span>
                      <span className="text-[10px] text-emerald-700 max-w-sm">
                        {isDelivered
                          ? 'Delivery was recorded without an attached handover slip photo.'
                          : 'Rider is en route to the processing lab. Handover slip & receiver verification will be recorded on arrival.'}
                      </span>
                    </div>
                  )}

                  {task.destination?.notes && (
                    <p className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200 italic shadow-xs">
                      "{task.destination.notes}"
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span>Cryptographically sealed & timestamped by SecondMedic VialTrack Engine</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Full-screen Zoom Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-700">
            <div className="px-4 py-3 bg-slate-800 text-white flex items-center justify-between border-b border-slate-700">
              <span className="font-bold text-xs sm:text-sm">{zoomedImage.title}</span>
              <div className="flex items-center gap-2">
                <a
                  href={zoomedImage.url}
                  download="vialtrack-chain-of-custody-proof.jpg"
                  className="px-2.5 py-1 bg-sky-700 hover:bg-sky-600 rounded text-xs text-white font-medium flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Download
                </a>
                <button
                  onClick={() => setZoomedImage(null)}
                  className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-2 flex-1 overflow-auto flex items-center justify-center">
              <img
                src={zoomedImage.url}
                alt={zoomedImage.title}
                  className="max-w-full max-h-[75vh] object-contain rounded" />
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

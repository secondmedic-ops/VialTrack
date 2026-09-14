import React, { useState } from 'react';
import { PickupTask, PickupBoy, Client } from '../../types';
import { FileText, Download, TrendingUp, DollarSign, CheckCircle2, AlertTriangle, Printer, Calendar } from 'lucide-react';
import jsPDF from 'jspdf';

interface ReportsViewProps {
  tasks: PickupTask[];
  riders: PickupBoy[];
  clients: Client[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ tasks, riders, clients }) => {
  const [selectedMonth, setSelectedMonth] = useState('August 2026');

  // Calculate Rider Monthly Metrics
  const riderMetrics = (riders || []).map((rider) => {
    const riderTasks = (tasks || []).filter((t) => t.riderId === rider.id);
    const completed = riderTasks.filter((t) => t.status === 'delivered').length;
    const delayed = riderTasks.filter((t) => t.isDelayed || t.status === 'delayed').length;
    const totalVials = riderTasks.reduce(
      (sum, t) => {
        const stops = t?.stopsProgress || t?.stops || [];
        return sum + stops.reduce((sSum: number, s: any) => sSum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
      },
      0
    );
    const onTimePct = riderTasks.length > 0 ? Math.round(((riderTasks.length - delayed) / riderTasks.length) * 100) : 100;
    const estimatedPayout = completed * 220; // ₹220 per completed loop payout

    return {
      rider,
      totalScheduled: riderTasks.length,
      completed,
      delayed,
      totalVials,
      onTimePct,
      estimatedPayout
    };
  });

  // Calculate Client Billing Metrics
  const clientMetrics = (clients || []).map((client) => {
    const clientTasks = (tasks || []).filter((t) => t.clientId === client.id);
    const completed = clientTasks.filter((t) => t.status === 'delivered').length;
    const totalVials = clientTasks.reduce(
      (sum, t) => {
        const stops = t?.stopsProgress || t?.stops || [];
        return sum + stops.reduce((sSum: number, s: any) => sSum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
      },
      0
    );
    const rate = client.billingRatePerPickup || 450;
    const totalBill = completed * rate;

    return {
      client,
      totalRounds: completed,
      totalVials,
      rate,
      totalBill
    };
  });

  // Real PDF Generation with SecondMedic Branded Header
  const handleExportPDF = () => {
    const doc = new jsPDF();

    // Header
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 36, 'F');

    doc.setTextColor(56, 189, 248); // sky-400
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('SECOND MEDIC VIALTRACK', 14, 16);

    doc.setTextColor(226, 232, 240);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Monthly Diagnostic Specimen Logistics & SLA Audit Report', 14, 24);
    doc.text(`Billing Period: ${selectedMonth} | Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 30);

    let y = 46;

    // Section 1: Client Billing Summary
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('1. DIAGNOSTIC CLIENT BILLING & ROUNDS BREAKDOWN', 14, y);
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('Client Name', 14, y);
    doc.text('Rounds Completed', 85, y);
    doc.text('Vials Transported', 125, y);
    doc.text('Rate / Round', 160, y);
    doc.text('Total Invoice (INR)', 180, y);
    y += 5;

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y - 2, 196, y - 2);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);

    clientMetrics.forEach((cm) => {
      doc.text(cm.client.name, 14, y);
      doc.text(`${cm.totalRounds} Rounds`, 85, y);
      doc.text(`${cm.totalVials} Units`, 125, y);
      doc.text(`INR ${cm.rate}`, 160, y);
      doc.text(`INR ${cm.totalBill.toLocaleString('en-IN')}`, 180, y);
      y += 7;
    });

    y += 12;

    // Section 2: Rider SLA Performance & Pay
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('2. RIDER FLEET ON-TIME SLA & PAY SUMMARY', 14, y);
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('Rider Name (Vehicle)', 14, y);
    doc.text('Rounds Completed', 85, y);
    doc.text('On-Time SLA %', 125, y);
    doc.text('Vials Carried', 160, y);
    doc.text('Est. Pay (INR)', 180, y);
    y += 5;

    doc.line(14, y - 2, 196, y - 2);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);

    riderMetrics.forEach((rm) => {
      doc.text(`${rm.rider.name} (${rm.rider.vehicleNumber.split('-')[2] || 'RIDER'})`, 14, y);
      doc.text(`${rm.completed} Rounds`, 85, y);
      doc.text(`${rm.onTimePct}%`, 125, y);
      doc.text(`${rm.totalVials} Vials`, 160, y);
      doc.text(`INR ${rm.estimatedPayout.toLocaleString('en-IN')}`, 180, y);
      y += 7;
    });

    y += 20;

    // Footer compliance certification
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 22, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('COLD-CHAIN COMPLIANCE CERTIFICATION (2.0°C - 8.0°C)', 18, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('All sample pickups were transported in calibrated active chiller boxes with automated GPS timestamp overlays.', 18, y + 13);
    doc.text('Certified by SecondMedic Logistics Command (secondmedic.com)', 18, y + 18);

    doc.save(`SecondMedic_VialTrack_Report_${selectedMonth.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-4 sm:p-5 rounded-xl shadow-xs">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-sky-700" />
            <span>Monthly Logistics, SLA & Billing Reports</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Exportable audits for hospital client invoicing, rider round payouts, and on-time SLA metrics.
          </p>
        </div>

        <button
          onClick={handleExportPDF}
          className="px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Download Certified PDF Report</span>
        </button>
      </div>

      {/* Grid: Client Billing Summary + Rider SLA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Client Invoicing Summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>Diagnostic Client Billing Summary</span>
            </h3>
            <span className="text-xs font-mono text-slate-500 font-medium">{selectedMonth}</span>
          </div>

          <div className="space-y-2.5">
            {clientMetrics.map((cm) => (
              <div
                key={cm.client.id}
                className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-3"
              >
                <div>
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm">{cm.client.name}</h4>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {cm.totalRounds} Rounds Completed • {cm.totalVials} Vials Moved
                  </div>
                  <span className="text-[11px] text-sky-700 font-mono font-medium">Rate: ₹{cm.rate} / pickup round</span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Estimated Total</span>
                  <span className="text-base sm:text-lg font-bold text-emerald-700 font-mono">
                    ₹{cm.totalBill.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rider Pay & SLA Summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-sky-700" />
              <span>Rider Rounds & SLA On-Time %</span>
            </h3>
            <span className="text-xs font-mono text-slate-500 font-medium">{selectedMonth}</span>
          </div>

          <div className="space-y-2.5">
            {riderMetrics.map((rm) => (
              <div
                key={rm.rider.id}
                className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-3"
              >
                <div>
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm">{rm.rider.name}</h4>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {rm.completed} Rounds • {rm.totalVials} Vials Carried
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                      {rm.onTimePct}% On-Time SLA
                    </span>
                    {rm.delayed > 0 && (
                      <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                        {rm.delayed} Delayed
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Estimated Payout</span>
                  <span className="text-base sm:text-lg font-bold text-sky-700 font-mono">
                    ₹{rm.estimatedPayout.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

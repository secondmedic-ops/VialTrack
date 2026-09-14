import { NotificationLog, AlertType, PickupTask, IssueFlag } from '../types';
import { StorageService } from './storage';

export interface WhatsAppMessagePayload {
  toPhone: string;
  recipientName: string;
  templateName: string;
  body: string;
  timestamp: string;
}

class NotificationDispatcherService {
  private listeners: Array<(notif: NotificationLog) => void> = [];

  public subscribe(callback: (notif: NotificationLog) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private emit(notif: NotificationLog) {
    this.listeners.forEach((fn) => fn(notif));
  }

  public getNotifications(): NotificationLog[] {
    return StorageService.getNotifications();
  }

  public markAllAsRead(): void {
    StorageService.markAllNotificationsRead();
  }

  public clearAll(): void {
    StorageService.saveNotifications([]);
  }

  public sendNotification(
    type: AlertType,
    title: string,
    message: string,
    recipientRole: 'admin' | 'client' | 'rider' | 'all' = 'all',
    recipientId?: string,
    relatedTaskId?: string,
    channel: 'whatsapp' | 'sms' | 'push' | 'system' = 'whatsapp'
  ): NotificationLog {
    const notif: NotificationLog = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      recipientRole,
      recipientId,
      relatedTaskId,
      read: false,
      channel
    };

    StorageService.addNotification(notif);
    this.emit(notif);
    return notif;
  }

  public sendAlert(params: {
    type: string;
    title: string;
    message: string;
    recipientRole?: 'admin' | 'client' | 'rider' | 'both' | 'all';
    recipientId?: string;
    relatedTaskId?: string;
    channel?: 'whatsapp' | 'sms' | 'push' | 'both' | 'system';
  }): NotificationLog {
    const mappedRole = params.recipientRole === 'both' ? 'all' : (params.recipientRole || 'all');
    const mappedChannel = params.channel === 'both' ? 'whatsapp' : (params.channel || 'whatsapp');
    return this.sendNotification(
      (params.type as AlertType) || 'issue_reported',
      params.title,
      params.message,
      mappedRole as any,
      params.recipientId,
      params.relatedTaskId,
      mappedChannel as any
    );
  }

  // Convenience triggers
  public notifyTaskStarted(task: PickupTask) {
    this.sendNotification(
      'task_started',
      `Round Started: ${task.routeName} (${task.timeSlot} Slot)`,
      `Rider ${task.riderName} (${task.riderVehicle}) is en route to ${task.stopsProgress[0]?.stopName || 'first stop'}.`,
      'all',
      task.clientId,
      task.id,
      'whatsapp'
    );
  }

  public notifyPickupCompleted(task: PickupTask, stopName: string, vials: number, temp?: number) {
    const tempText = temp !== undefined ? ` • Temp: ${temp.toFixed(1)}°C` : '';
    this.sendNotification(
      'pickup_done',
      `Pickup Done: ${stopName} (${vials} Vials)`,
      `${vials} blood-vial samples collected by ${task.riderName}${tempText}. GPS proof locked.`,
      'all',
      task.clientId,
      task.id,
      'whatsapp'
    );
  }

  public notifyDropCompleted(task: PickupTask, receiver: string, temp?: number) {
    const safeStops = task?.stopsProgress || task?.stops || [];
    const totalVials = safeStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
    const destinationName = task?.destination?.name || 'Destination Lab';
    const tempText = temp !== undefined ? ` • Temp: ${temp.toFixed(1)}°C` : '';
    this.sendNotification(
      'drop_done',
      `Delivered to ${destinationName}`,
      `Total ${totalVials} vials handed over to ${receiver}${tempText}. Chain of custody verified.`,
      'all',
      task?.clientId,
      task?.id,
      'whatsapp'
    );
  }

  public notifyIssueReported(task: PickupTask, issue: IssueFlag) {
    this.sendNotification(
      'issue_reported',
      `ALERT: Issue at ${task.routeName}`,
      `Rider ${issue.reportedByRiderName} reported: "${issue.description}" (${issue.type.toUpperCase()}). Ops team notified immediately.`,
      'admin',
      undefined,
      task.id,
      'sms'
    );
  }

  public notifyDelayedSlot(task: PickupTask, delayMins: number) {
    this.sendNotification(
      'delay',
      `DELAY WARNING: Slot ${task.timeSlot} (${delayMins} min late)`,
      `Task for ${task.clientName} (${task.routeName}) is running ${delayMins} minutes behind schedule.`,
      'all',
      task.clientId,
      task.id,
      'whatsapp'
    );
  }
}

export const NotificationService = new NotificationDispatcherService();

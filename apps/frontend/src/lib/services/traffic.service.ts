import httpClient from '@/lib/utils/httpClient';
import type {
  AuditEntry,
  AutoZoneStatus,
  Camera,
  CameraFrame,
  CameraNetwork,
  CameraSource,
  CaseDetail,
  Fine,
  Overview,
  Page,
  PassedVehicle,
  PassedVehicleCamera,
  PassedVehicleRun,
  Payment,
  PlateTrack,
  Review,
  SimilarVehicles,
  SlotName,
  SurveillanceRunRow,
  SurveillanceStatus,
  TrafficCase,
  Vehicle,
  VehicleSearchParams,
  VehicleSearchResult,
  VehicleTrack,
  VideoFile,
  Violation,
  ViolationDetail,
  VlmExplanation,
} from '@/lib/types/traffic.types';

export type ListParams = { page?: number; limit?: number; status?: string; search?: string };
export type ViolationParams = ListParams & { code?: string; cameraId?: string; from?: string; to?: string };
export type PassedVehicleParams = { cameraId: string; runId?: string; search?: string; page?: number; limit?: number };

export interface PayRequest {
  method: 'card' | 'bkash' | 'nagad' | 'rocket';
  cardNumber?: string;
  cardExpiry?: string;
  cardCvc?: string;
  cardName?: string;
  walletNumber?: string;
  walletPin?: string;
  payerName?: string;
}

export interface PayResult {
  status: 'succeeded' | 'failed';
  reason?: string;
  transactionId: string;
  invoiceNumber?: string;
  paymentId?: string;
  emailedTo?: string | null;
}

/** Saves a file the API returns (PDF, CSV) as a download. */
async function downloadFile(url: string, fallbackName: string, params?: Record<string, unknown>) {
  const res = await httpClient.get<Blob>(url, { responseType: 'blob', params });
  const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

class TrafficService {
  // ─── violations (officer) ───
  async violations(params: ViolationParams) {
    return (await httpClient.get<Page<Violation>>('/violations', { params })).data;
  }
  async violationSummary() {
    return (
      await httpClient.get<{
        new: number;
        ticketed: number;
        dismissed: number;
        last24h: number;
        newByCode: Record<string, number>;
        latestAt?: string;
      }>('/violations/summary')
    ).data;
  }
  async violation(id: ID) {
    return (await httpClient.get<ViolationDetail>(`/violations/${id}`)).data;
  }
  async explain(id: ID, force = false) {
    return (await httpClient.post<VlmExplanation>(`/violations/${id}/explain`, null, { params: { force } })).data;
  }
  async setPlate(id: ID, registration: string) {
    return (await httpClient.post<ViolationDetail>(`/violations/${id}/plate`, { registration })).data;
  }
  async dismiss(id: ID, reason: string) {
    return (await httpClient.post<ViolationDetail>(`/violations/${id}/dismiss`, { reason })).data;
  }
  async reopen(id: ID) {
    return (await httpClient.post<ViolationDetail>(`/violations/${id}/reopen`)).data;
  }
  async sendTicket(id: ID, body: { registration?: string; ownerEmail?: string; ownerName?: string; note?: string }) {
    return (await httpClient.post<TrafficCase>(`/violations/${id}/ticket`, body)).data;
  }

  // ─── cases, reviews, payments (staff) ───
  async cases(params: ListParams) {
    return (await httpClient.get<Page<TrafficCase>>('/cases', { params })).data;
  }
  async caseDetail(id: ID) {
    return (await httpClient.get<CaseDetail>(`/cases/${id}`)).data;
  }
  async resendTicket(id: ID) {
    return (await httpClient.post<TrafficCase>(`/cases/${id}/resend`)).data;
  }
  async reviews(params: ListParams) {
    return (await httpClient.get<Page<Review>>('/reviews', { params })).data;
  }
  async decideReview(id: ID, decision: 'accepted' | 'rejected', note: string) {
    return (await httpClient.post<Review>(`/reviews/${id}/decide`, { decision, note })).data;
  }
  async payments(params: ListParams) {
    return (await httpClient.get<Page<Payment>>('/payments', { params })).data;
  }
  staffInvoice(paymentId: ID) {
    return downloadFile(`/payments/${paymentId}/invoice`, 'invoice.pdf');
  }

  // ─── vehicle owner ───
  async myCases() {
    return (await httpClient.get<TrafficCase[]>('/citizen/cases')).data;
  }
  async myCase(id: ID) {
    return (await httpClient.get<CaseDetail>(`/citizen/cases/${id}`)).data;
  }
  async myVehicles() {
    return (await httpClient.get<Vehicle[]>('/citizen/vehicles')).data;
  }
  async requestReview(id: ID, reason: string, details: string) {
    return (await httpClient.post<Review>(`/citizen/cases/${id}/review`, { reason, details })).data;
  }
  /** The online gateway the payment pop-up offers (SSLCommerz; sandbox unless the backend says live). */
  async paymentGateway() {
    return (await httpClient.get<{ online: boolean; provider: string; sandbox: boolean }>('/citizen/payment-gateway')).data;
  }
  /** Opens an SSLCommerz checkout for the case: send the browser to `url`; it comes back to /my-cases?payment=... */
  async payOnline(id: ID) {
    return (await httpClient.post<{ url: string; transactionId: string }>(`/citizen/cases/${id}/pay/online`)).data;
  }
  async pay(id: ID, body: PayRequest) {
    return (await httpClient.post<PayResult>(`/citizen/cases/${id}/pay`, body)).data;
  }
  myInvoice(paymentId: ID) {
    return downloadFile(`/citizen/payments/${paymentId}/invoice`, 'invoice.pdf');
  }

  // ─── cameras, registry, fines ───
  async cameras() {
    return (await httpClient.get<Camera[]>('/cameras')).data;
  }
  async saveCamera(body: Omit<Camera, 'id'>, id?: ID) {
    return id
      ? (await httpClient.patch<Camera>(`/cameras/${id}`, body)).data
      : (await httpClient.post<Camera>('/cameras', body)).data;
  }
  async saveZones(id: ID, zones: Camera['zones']) {
    return (await httpClient.patch<Camera>(`/cameras/${id}/zones`, { zones })).data;
  }
  /** Multi-camera tracking: the camera's gates and its links to the next cameras. */
  async saveNetwork(id: ID, network: CameraNetwork) {
    return (await httpClient.put<Camera>(`/cameras/${id}/network`, { network })).data;
  }
  async deleteCamera(id: ID) {
    return (await httpClient.delete<{ deleted?: boolean; deactivated?: boolean }>(`/cameras/${id}`)).data;
  }
  /** Automatic zones: start learning from traffic, poll, cancel (the result is a draft for the zone editor). */
  async startAutoZones(id: ID, source?: CameraSource) {
    return (await httpClient.post<AutoZoneStatus>(`/cameras/${id}/auto-zones`, { source })).data;
  }
  async autoZones(id: ID) {
    return (await httpClient.get<AutoZoneStatus>(`/cameras/${id}/auto-zones`)).data;
  }
  async cancelAutoZones(id: ID) {
    return (await httpClient.delete<AutoZoneStatus>(`/cameras/${id}/auto-zones`)).data;
  }
  async frame(source: CameraSource, atSec = 0) {
    return (await httpClient.post<CameraFrame>('/cameras/frame', { source, atSec })).data;
  }
  async vehicles(params: ListParams) {
    return (await httpClient.get<Page<Vehicle>>('/vehicles', { params })).data;
  }
  async lookupVehicle(registration: string) {
    return (await httpClient.get<{ exact: Vehicle | null; similar: Vehicle[] }>('/vehicles/lookup', { params: { registration } }))
      .data;
  }
  async saveVehicle(body: Omit<Vehicle, 'id'>, id?: ID) {
    return id
      ? (await httpClient.patch<Vehicle>(`/vehicles/${id}`, body)).data
      : (await httpClient.post<Vehicle>('/vehicles', body)).data;
  }
  async deleteVehicle(id: ID) {
    await httpClient.delete(`/vehicles/${id}`);
  }
  async fines() {
    return (await httpClient.get<Fine[]>('/fines')).data;
  }
  async saveFine(code: string, body: Omit<Fine, 'id' | 'code'>) {
    return (await httpClient.put<Fine>(`/fines/${code}`, body)).data;
  }

  // ─── surveillance ───
  async slots() {
    return (await httpClient.get<SurveillanceStatus>('/surveillance/slots')).data;
  }
  async startSlot(slot: SlotName, body: { cameraId?: string; source?: CameraSource; options?: Record<string, unknown> }) {
    return (await httpClient.post(`/surveillance/slots/${slot}/start`, body)).data;
  }
  async stopSlot(slot: SlotName) {
    return (await httpClient.post(`/surveillance/slots/${slot}/stop`)).data;
  }
  async videos() {
    return (await httpClient.get<{ videos: VideoFile[]; folders: string[] }>('/surveillance/videos')).data;
  }
  async uploadUrl() {
    return (await httpClient.post<{ url: string }>('/surveillance/upload-url')).data;
  }
  async runs(params: ListParams) {
    return (await httpClient.get<Page<SurveillanceRunRow>>('/surveillance/runs', { params })).data;
  }

  /** Streams the file straight to the vision service (signed URL), reporting progress 0..1. */
  uploadVideo(url: string, file: File, onProgress: (p: number) => void) {
    return new Promise<{ kind: 'upload'; value: string; sizeMb: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${url}&name=${encodeURIComponent(file.name)}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText || '{}').detail ?? `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed: the vision service is not reachable'));
      xhr.send(file);
    });
  }

  // ─── passed vehicles (every vehicle the other-violations box saw pass) ───
  async passedVehicleCameras() {
    return (await httpClient.get<PassedVehicleCamera[]>('/passed-vehicles/cameras')).data;
  }
  async passedVehicleRuns(cameraId: string) {
    return (await httpClient.get<PassedVehicleRun[]>('/passed-vehicles/runs', { params: { cameraId } })).data;
  }
  async passedVehicles(params: PassedVehicleParams) {
    return (await httpClient.get<Page<PassedVehicle>>('/passed-vehicles', { params })).data;
  }
  /** fileName: used when the browser cannot read the server's (it does not expose Content-Disposition). */
  passedVehiclesCsv(params: Omit<PassedVehicleParams, 'page' | 'limit'>, fileName = 'passed_vehicles.csv') {
    return downloadFile('/passed-vehicles/csv', fileName, params);
  }

  // ─── tracking ───
  /** Vehicles in the whole camera network by Vehicle ID, plate or appearance; last camera first. */
  async searchVehicles(params: VehicleSearchParams) {
    return (await httpClient.get<VehicleSearchResult>('/track/vehicles', { params })).data;
  }
  async vehicleTrack(vid: string) {
    return (await httpClient.get<VehicleTrack>(`/track/vehicles/${encodeURIComponent(vid)}`)).data;
  }
  /** Vehicles anywhere that look like this one: first seen after it was last seen, or at any time. */
  async similarVehicles(vid: string, when: 'after' | 'any') {
    return (await httpClient.get<SimilarVehicles>(`/track/vehicles/${encodeURIComponent(vid)}/similar`, { params: { when } })).data;
  }
  async trackPlate(q: string) {
    return (await httpClient.get<PlateTrack>('/track/plate', { params: { q } })).data;
  }

  // ─── reports ───
  async overview(days: number) {
    return (await httpClient.get<Overview>('/reports/overview', { params: { days } })).data;
  }
  async audit(params: ListParams) {
    return (await httpClient.get<Page<AuditEntry>>('/reports/audit', { params })).data;
  }
}

const trafficService = new TrafficService();
export default trafficService;

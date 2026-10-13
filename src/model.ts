export interface Resident {
  id: string;
  chartNumber: string;
  room: string;
  name: string;
  insurer: string;
  careLevel: string;
  creationMonth: string;
  planStartMonth: string;
  planEndMonth: string;
  certificationExpiryMonth: string;
  admissionDate: string;
  admissionNote: string;
  physicalIndependence: string;
  cognitiveIndependence: string;
  restraint: boolean;
  careManager: string;
  notes: string;
  status: "active" | "discharged";
  revision: number;
  updatedAt: string;
}
export interface CarePlan {
  id: string;
  residentId: string;
  targetMonth: string;
  creator: string;
  creationDate: string;
  printDate: string;
  meetingDate: string;
  careManager: string;
  effectivePeriodText: string;
  consentStatus: "未送付" | "送付済" | "回収済";
  periodStartDate: string;
  periodEndDate: string;
  restraint: boolean;
  meetingRound: 1 | 2;
  notes: string;
  revision: number;
  updatedAt: string;
}
export interface Settings {
  revision: number;
  facilityName: string;
  floor: string;
  targetMonth: string;
  authors: string[];
  careManagers: string[];
  periodMode: "certification" | "threeMonths";
  meeting1Date: string;
  meeting2Date: string;
  meeting1Time: string;
  meeting2Time: string;
  meetingLocation: string;
  contactName: string;
  contactPhone: string;
  consentBody: string;
  restraintBody: string;
}
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "staff";
  disabled?: boolean;
}
export interface Audit {
  id?: string;
  actor?: string;
  actorName?: string;
  action: string;
  createdAt?: string;
  timestamp?: string;
  details?: unknown;
  entityType?: string;
  entityId?: string;
}
export interface State {
  user: User;
  residents: Resident[];
  plans: CarePlan[];
  settings: Settings;
  users: User[];
  audit: Audit[];
}
export interface Preview {
  previewId: string;
  summary: {
    residentCount: number;
    planCount: number;
    restraintCount: number;
    warningCount: number;
  };
  warnings: string[];
  residents?: Resident[];
  plans?: CarePlan[];
}
export interface RestorePreview {
  previewId: string;
  summary: { residentCount: number; planCount: number };
  warnings: string[];
}
export interface DesktopInfo {
  mode: "unconfigured" | "host" | "client";
  serverUrl: string;
  dataDir?: string;
  version: string;
  addresses: string[];
  share?: boolean;
  port?: number;
}
declare global {
  interface Window {
    careDesktop?: {
      info: () => Promise<DesktopInfo>;
      configure: (options: {
        mode: "host" | "client";
        serverUrl?: string;
        share?: boolean;
        port?: number;
      }) => Promise<DesktopInfo>;
      request: (options: {
        path: string;
        method?: string;
        body?: unknown;
        token?: string;
      }) => Promise<unknown>;
      requestBytes: (options: {
        path: string;
        base64: string;
        token: string;
        filename?: string;
      }) => Promise<unknown>;
      print: () => Promise<unknown>;
      pdf: (options: { filename: string }) => Promise<unknown>;
      saveBackup: (options: {
        json: string;
        filename?: string;
      }) => Promise<unknown>;
    };
  }
}

/**
 * Credentials a Conduit customer enters for the MSP360 connector: a
 * Managed Backup Service provider-portal username/password. Exchanged for a
 * short-lived bearer token at request time (POST /api/Provider/Login) — see
 * client.ts.
 */
export interface Msp360Credentials {
  username: string;
  password: string;
}

/** Response body of POST /api/Provider/Login. */
export interface LoginResponse {
  access_token?: string;
}

/** GET /api/Companies list item / GET /api/Companies/{id} response. */
export interface CompanyModel {
  Id?: string;
  Name?: string;
  StorageLimit?: number;
  LicenseSettings?: number;
  Destinations?: unknown[];
  DefaultLicense?: number;
  AllowedLicenses?: number[];
}

/** GET /api/Monitoring and GET /api/Monitoring/{userId} list item. */
export interface MonitoringModel {
  PlanName?: string;
  CompanyName?: string;
  UserName?: string;
  UserID?: string;
  ComputerName?: string;
  ComputerHid?: string;
  BuildVersion?: string;
  StorageType?: string;
  LastStart?: string;
  NextStart?: string;
  Status?: number;
  ErrorMessage?: string;
  FilesCopied?: number;
  FilesFailed?: number;
  DataCopied?: number;
  Duration?: string;
  DataToBackup?: number;
  TotalData?: number;
  FilesScanned?: number;
  FilesToBackup?: number;
  PlanId?: string;
  PlanType?: number;
  DetailedReportLink?: string;
}

/** GET /api/Licenses list item / GET /api/Licenses/{id} response. */
export interface LicenseModel {
  ID?: string;
  Number?: number;
  ComputerName?: string;
  OperatingSystem?: string;
  IsTrial?: boolean;
  IsTaken?: boolean;
  LicenseType?: string;
  DateExpired?: string;
  Transaction?: string;
  User?: string;
  UserID?: string;
}

/**
 * NOTE: /api/Computers/{offset}/{count}, /api/Computers/{hid} and the
 * Plans/{...} family (list/get/info/history/start/stop) all document their
 * response as a bare `object` in MSP360's own swagger spec (v2,
 * api.mspbackups.com/help/v2/swagger) — the vendor's API does not publish a
 * typed response shape for these. Tool handlers pass the raw JSON straight
 * through rather than fabricating a schema the vendor itself doesn't
 * document.
 */
export type UntypedVendorResponse = Record<string, unknown>;

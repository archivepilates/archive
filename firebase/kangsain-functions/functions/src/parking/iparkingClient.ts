import crypto from "crypto";
import { defineSecret } from "firebase-functions/params";

export const iparkingLoginId = defineSecret("IPARKING_LOGIN_ID");
export const iparkingLoginPassword = defineSecret("IPARKING_LOGIN_PASSWORD");
export const iparkingSubLoginId = defineSecret("IPARKING_SUB_LOGIN_ID");
export const iparkingSubLoginPassword = defineSecret("IPARKING_SUB_LOGIN_PASSWORD");

const OAUTH_BASE_URL = "http://oauth.parkingcloud.co.kr";
const DEFAULT_MEMBERS_API_BASE_URL = "http://members.iparking.co.kr/api/members";
const AES_KEY = "DlaCkdAnr!Qwer%@)*FronT$#~KinG!!";
const AES_IV = Buffer.alloc(16, 0);

export type IparkingAuthData = {
  access_token: string;
  client_id?: string;
  memb_name?: string;
  stor_name?: string;
  operation_company?: Array<{ domain?: string }>;
};

export type IparkingCarInfo = {
  inot_seq: number;
  car_number: string;
  enter_datetime: string;
  inot_duration?: number;
  discount_duration?: number;
  park_seq?: number;
  park_name?: string;
  product_cd?: number;
  product_car_members_use_yn?: string;
  [key: string]: unknown;
};

export type IparkingDiscountProduct = {
  discount_key: string;
  disc_name: string;
  disc_count?: number;
  remain_amount?: number;
  fdk_today_count?: number;
  fdk_max_count?: number;
  max_usable_count?: number;
  stor_seq?: number;
  park_seq?: number;
  inot_seq?: number;
  apply_type?: string;
  sdhm_memo?: string;
  [key: string]: unknown;
};

export type IparkingAppliedDiscount = {
  disc_name?: string;
  discount_key?: string;
  sum_count?: number;
  aply_yn?: string;
  [key: string]: unknown;
};

type IparkingApiResponse<T> = {
  result?: string;
  code?: string;
  resultMessage?: string;
  message?: string;
  totalCnt?: number;
  resultData?: T;
  auth_data?: T;
};

type PostOptions = {
  token?: string;
};

export type IparkingAccountConfig = {
  label: "primary" | "sub";
  loginId: string;
  loginPassword: string;
};

export class IparkingApiError extends Error {
  constructor(
    message: string,
    public readonly resultCode?: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

function encryptPayload(payload: string): string {
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(AES_KEY, "utf8"), AES_IV);
  const encryptedBase64 = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]).toString("base64");
  return Buffer.from(encryptedBase64, "utf8").toString("base64");
}

function compactParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ) as Partial<T>;
}

function ensureSuccess<T>(response: IparkingApiResponse<T>, path: string): T {
  const code = response.result || response.code;
  if (code !== "0000") {
    const message = response.resultMessage || response.message || `iParking API failed: ${path}`;
    throw new IparkingApiError(message, code, ["2031", "2041", "1009"].includes(String(code)));
  }
  return (response.auth_data || response.resultData) as T;
}

async function postIparking<T>(url: string, params: Record<string, unknown>, options: PostOptions = {}): Promise<T> {
  const body = encryptPayload(JSON.stringify(compactParams(params)));
  const headers: Record<string, string> = {
    "content-type": "application/json;charset=UTF-8",
    version: "2.0.0",
  };
  if (options.token) headers.authorization = options.token;

  const response = await fetch(url, { method: "POST", headers, body });
  const text = await response.text();
  if (!response.ok) {
    throw new IparkingApiError(`iParking HTTP ${response.status}: ${url}`, undefined, response.status >= 500);
  }
  let json: IparkingApiResponse<T>;
  try {
    json = JSON.parse(text) as IparkingApiResponse<T>;
  } catch {
    throw new IparkingApiError(`iParking response parse failed: ${url}`, undefined, true);
  }
  return ensureSuccess(json, url);
}

export class IparkingClient {
  private authData: IparkingAuthData | null = null;
  private apiBaseUrl = DEFAULT_MEMBERS_API_BASE_URL;

  constructor(private readonly account?: IparkingAccountConfig) {}

  async login(): Promise<IparkingAuthData> {
    if (this.authData?.access_token) return this.authData;
    const loginId = this.account?.loginId || iparkingLoginId.value();
    const loginPassword = this.account?.loginPassword || iparkingLoginPassword.value();
    if (!loginId || !loginPassword) {
      throw new IparkingApiError("iParking 로그인 Secret이 설정되지 않았습니다", undefined, false);
    }
    const authData = await postIparking<IparkingAuthData>(`${OAUTH_BASE_URL}/api/oauth/store/authorize`, {
      client_id: loginId,
      client_pwd: loginPassword,
      client_os_type: "PC",
    });
    if (!authData.access_token) throw new IparkingApiError("iParking access token이 없습니다");
    const companyDomain = authData.operation_company?.[0]?.domain;
    if (companyDomain) this.apiBaseUrl = `${companyDomain.replace(/\/$/, "")}/api/members`;
    this.authData = authData;
    return authData;
  }

  async searchCars(params: {
    carNumberLast4: string;
    parkSeq?: number;
    storSeq?: number;
    parkName?: string;
    currentPage?: number;
    pageSize?: number;
  }): Promise<IparkingCarInfo[]> {
    await this.login();
    return await postIparking<IparkingCarInfo[]>(
      `${this.apiBaseUrl}/discount/carlist`,
      {
        car_number: params.carNumberLast4,
        park_seq: params.parkSeq,
        stor_seq: params.storSeq,
        park_name: params.parkName,
        current_page: params.currentPage || 1,
        page_size: params.pageSize || 10,
      },
      { token: this.authData?.access_token },
    );
  }

  async listAppliedDiscounts(params: {
    storSeq: number;
    parkSeq: number;
    inotSeq: number;
    searchOption?: 1 | 2;
  }): Promise<IparkingAppliedDiscount[]> {
    await this.login();
    return await postIparking<IparkingAppliedDiscount[]>(
      `${this.apiBaseUrl}/discount/apply/list`,
      {
        stor_seq: params.storSeq,
        park_seq: params.parkSeq,
        inot_seq: params.inotSeq,
        search_option: params.searchOption || 1,
      },
      { token: this.authData?.access_token },
    );
  }

  async listProducts(params: {
    storSeq: number;
    parkSeq: number;
    inotSeq: number;
  }): Promise<IparkingDiscountProduct[]> {
    await this.login();
    return await postIparking<IparkingDiscountProduct[]>(
      `${this.apiBaseUrl}/discount/product/list`,
      {
        stor_seq: params.storSeq,
        park_seq: params.parkSeq,
        inot_seq: params.inotSeq,
        call_step: 1,
      },
      { token: this.authData?.access_token },
    );
  }

  async applyDiscount(params: {
    storSeq: number;
    parkSeq: number;
    inotSeq: number;
    carNumber: string;
    product: IparkingDiscountProduct;
    memo?: string;
  }): Promise<void> {
    await this.login();
    await postIparking<null>(
      `${this.apiBaseUrl}/discount/apply`,
      {
        stor_seq: params.storSeq,
        inot_seq: params.inotSeq,
        car_number: params.carNumber,
        park_seq: params.parkSeq,
        disc_count: 1,
        discount_key: params.product.discount_key,
        sdhm_memo: params.memo || params.product.sdhm_memo || "",
        apply_type: params.product.apply_type || "A",
      },
      { token: this.authData?.access_token },
    );
  }
}

export function getIparkingAccountConfigs(): IparkingAccountConfig[] {
  const accounts: IparkingAccountConfig[] = [];
  const primaryId = iparkingLoginId.value();
  const primaryPassword = iparkingLoginPassword.value();
  if (primaryId && primaryPassword) {
    accounts.push({ label: "primary", loginId: primaryId, loginPassword: primaryPassword });
  }
  const subId = iparkingSubLoginId.value();
  const subPassword = iparkingSubLoginPassword.value();
  if (subId && subPassword) {
    accounts.push({ label: "sub", loginId: subId, loginPassword: subPassword });
  }
  return accounts;
}

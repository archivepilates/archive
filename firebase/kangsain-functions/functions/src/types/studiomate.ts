export interface StudioMateToken {
  accessToken: string;
  expiresAt: number;
}

export interface ManagerToken {
  accountToken: string;
  expiresAt: number;
}

export interface ManagerStudio {
  id: number | string;
  name: string;
  subdomain?: string;
  staff_id?: number | string;
  staff?: { id?: number | string; name?: string };
}

export interface NormalizedLectureInput {
  raw: any;
  studioId: string;
}

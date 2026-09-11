/**
 * Minimal client for the SignUpGenius key-based API (Pro plan).
 * Verified live against https://developer.signupgenius.com/developer/keybaseddocs
 * Base path is `/v2/k/` — NOT the `/v2/2.0/` a naive reading of the docs suggests.
 */

const BASE_URL = "https://api.signupgenius.com/v2/k";

export class SugApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "SugApiError";
  }
}

export interface SugCreatedSignup {
  signupid: number;
  title: string;
  group: string;
  groupid: number;
  signupurl: string;
  contactname: string;
  startdate: number; // unix seconds
  enddate: number;
  startdatestring: string;
  enddatestring: string;
  starttime: number;
  endtime: number;
  thumbnail: string;
  mainimage: string;
}

/**
 * One row = one (date, item) slot instance, not one participant.
 * An unfilled slot instance has empty firstname/lastname/itemmemberid and
 * `myqty` is that slot's remaining capacity. A filled row's `myqty` is the
 * quantity that participant took.
 */
export interface SugReportRow {
  itemmemberid: number | "";
  item: string;
  signupid: string;
  slotitemid: number | "";
  startdate: number; // unix seconds
  startdatestring: string;
  myqty: number;
  firstname: string;
  lastname: string;
  email: string;
  status: string;
  waitlist: number;
}

interface SugEnvelope<T> {
  data: T;
  message: string[];
  success: boolean;
}

export class SignUpGeniusClient {
  constructor(
    private readonly userKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("user_key", this.userKey);

    const res = await this.fetchImpl(url, {
      headers: { Accept: "application/json" },
    });

    let body: SugEnvelope<T> | undefined;
    try {
      body = (await res.json()) as SugEnvelope<T>;
    } catch {
      // fall through — body stays undefined, handled below
    }

    if (!res.ok || !body || body.success === false) {
      const detail = body?.message?.join("; ") || `HTTP ${res.status}`;
      throw new SugApiError(`SignUpGenius ${path} failed: ${detail}`, res.status);
    }

    return body.data;
  }

  createdActive(): Promise<SugCreatedSignup[]> {
    return this.get<SugCreatedSignup[]>("/signups/created/active/");
  }

  reportAll(signupId: number): Promise<SugReportRow[]> {
    return this.get<{ signup: SugReportRow[] }>(`/signups/report/all/${signupId}/`).then(
      (data) => data.signup,
    );
  }
}

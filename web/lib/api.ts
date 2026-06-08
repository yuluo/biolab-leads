// Client-side API wrapper. All calls send the user's email + Apollo key headers.

import { loadCreds } from "./credentials";

const BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://v5ob6hhpgc.execute-api.us-east-1.amazonaws.com";

export type Employer = {
  ein: string;
  sponsor_name: string;
  funding_type: string;
  participants: number | null;
  welfare_plan_count: number | null;
  business_code: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  has_stop_loss: boolean;
  has_health_insurance: boolean;
  carriers: string | null;
  latest_plan_year: number | null;
};

export type Contact = {
  ein: string;
  contact_name: string;
  contact_title: string;
  contact_email: string;
  contact_linkedin: string;
  org_domain: string;
  match_confidence: number;
  enriched_at: string;
};

export type EmployersResponse = {
  total: number;
  count: number;
  offset: number;
  results: Employer[];
};

export type EnrichResponse = { ein: string; contacts: Contact[]; reason?: string };

export type EmployerFilters = {
  state?: string;
  funding_type?: string;
  min_participants?: string;
  max_participants?: string;
  industry?: string;
  q?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function headers(): HeadersInit {
  const creds = loadCreds();
  if (!creds) throw new ApiError(401, "Add your email and Apollo key to start.");
  return {
    "Content-Type": "application/json",
    "X-User-Email": creds.email,
    "X-Apollo-Key": creds.apolloKey,
  };
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      res.status === 403
        ? "This email is not authorized to use the API."
        : res.status === 401
          ? "Missing or invalid credentials."
          : (body as { error?: string }).error || `Request failed (${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

export async function getEmployers(filters: EmployerFilters): Promise<EmployersResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && String(v).length > 0) params.set(k, String(v));
  }
  const res = await fetch(`${BASE}/employers?${params.toString()}`, { headers: headers() });
  return parse<EmployersResponse>(res);
}

export async function getContacts(ein: string): Promise<Contact[]> {
  const res = await fetch(`${BASE}/contacts?ein=${encodeURIComponent(ein)}`, { headers: headers() });
  const data = await parse<{ ein: string; contacts: Contact[] }>(res);
  return data.contacts || [];
}

export async function enrichContacts(ein: string): Promise<EnrichResponse> {
  const res = await fetch(`${BASE}/contacts/enrich`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ein }),
  });
  return parse<EnrichResponse>(res);
}

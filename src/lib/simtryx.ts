export interface SimtryxUserScore {
  user: string;
  success: number; // 0 to 1
}

export interface SimtryxDebriefingQuestion {
  title: string;
  options: string[];
  correctOption: number;
  userAnswers?: {
    user: string;
    selectedOption: number;
  }[];
}

export interface SimtryxChecklistAction {
  title: string;
  success: number;
}

export interface SimtryxChecklistCategory {
  categoryTitle: string;
  required?: SimtryxChecklistAction[];
  optional?: SimtryxChecklistAction[];
  unnecessary?: SimtryxChecklistAction[];
}

export interface SimtryxSimulation {
  id: string;
  sceneryID: string;
  startTime: string;
  endTime: string;
  startUser: string;
  results: {
    users?: SimtryxUserScore[];
    debriefing?: {
      questions?: SimtryxDebriefingQuestion[];
    };
    checklist?: {
      success: number;
      actionsData?: SimtryxChecklistCategory[];
    }[];
  };
}

export const SCENARIO_NAMES_MAP: Record<string, string> = {
  'advance-anaphylacticshock-p0': 'Shock Anafiláctico Avanzado',
  'advance-acute_ischemic_stroke-p0': 'Ataque Cerebrovascular (ACV) Isquémico',
  'advance-congestiveheart-p1': 'Insuficiencia Cardíaca Congestiva Avanzada',
  'advance-internaltrauma-p0': 'Trauma Abdominal / Interno Severo (Fase 1)',
  'advance-internaltrauma-p1': 'Trauma Abdominal / Interno Severo (Fase 2)',
  'abdominal_sepsis-p0': 'Sepsis de Foco Abdominal',
  'basic-cirrhosis-p0': 'Cirrosis Hepática y Complicaciones (Caso A)',
  'basic-cirrhosis-p1': 'Cirrosis Hepática y Hemorragia Digestiva (Caso B)',
  'basic-cirrhosis-p2': 'Cirrosis Descompensada (Caso C)',
  'procedure-burnwoundcare': 'Curación y Manejo de Quemaduras Extensas',
  's060-advanced-asthma': 'Crisis Asmática Severa / Estado Asmático',
};

export function getScenarioFriendlyName(id: string): string {
  if (SCENARIO_NAMES_MAP[id]) return SCENARIO_NAMES_MAP[id];
  // Formatear automáticamente si no está en el mapa
  return id
    .replace(/^s\d+-/, '')
    .replace(/-p\d+$/, '')
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export class SimtryxClient {
  private baseUrl: string;
  private cookies: Map<string, string> = new Map();

  constructor(baseUrl = process.env.SIMTRYX_BASE_URL || 'https://platform.simtryx.com') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private updateCookies(setCookieHeaders: string[] | null) {
    if (!setCookieHeaders) return;
    for (const header of setCookieHeaders) {
      const parts = header.split(';')[0].split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        this.cookies.set(name, value);
      }
    }
  }

  private getCookieString(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  public hasSession(): boolean {
    return Array.from(this.cookies.keys()).some(
      (k) => k.includes('session-token') || k.includes('session')
    );
  }

  /**
   * Obtiene el token CSRF y la cookie inicial de Auth.js
   */
  async getCsrf(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/csrf`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    this.updateCookies(rawCookies);

    if (!res.ok) {
      throw new Error(`Error obteniendo CSRF de Simtryx: HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.csrfToken;
  }

  /**
   * Inicia sesión con credenciales
   */
  async login(email?: string, password?: string): Promise<{ success: boolean; error?: string }> {
    const userEmail = email || process.env.SIMTRYX_EMAIL;
    const userPass = password || process.env.SIMTRYX_PASSWORD;

    if (!userEmail || !userPass) {
      return { success: false, error: 'Credenciales no configuradas en .env.local' };
    }

    try {
      const csrfToken = await this.getCsrf();

      const formParams = new URLSearchParams();
      formParams.append('csrfToken', csrfToken);
      formParams.append('email', userEmail);
      formParams.append('password', userPass);
      formParams.append('redirect', 'false');
      formParams.append('callbackUrl', `${this.baseUrl}/`);
      formParams.append('json', 'true');

      const res = await fetch(`${this.baseUrl}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.getCookieString(),
          'Accept': 'application/json',
        },
        body: formParams.toString(),
        redirect: 'manual',
        cache: 'no-store',
      });

      const postCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      this.updateCookies(postCookies);

      const hasSessionCookie = this.hasSession();
      if (!hasSessionCookie && res.status >= 400) {
        return { success: false, error: `Credenciales inválidas o error de inicio de sesión (${res.status})` };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Obtiene la lista completa de todas las simulaciones con resultados y evaluaciones
   */
  async getAllSimulations(): Promise<SimtryxSimulation[]> {
    if (!this.hasSession()) {
      const loginRes = await this.login();
      if (!loginRes.success) {
        throw new Error(`Error de autenticación con Simtryx: ${loginRes.error}`);
      }
    }

    const res = await fetch(`${this.baseUrl}/all-simulations`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Next-Action': '408ef67208ac1da449a64910bbcf71b030537dc28a',
        'Content-Type': 'text/plain;charset=UTF-8',
        'Accept': 'text/x-component',
        'Cookie': this.getCookieString(),
      },
      body: '[]',
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`Error obteniendo simulaciones de Simtryx: HTTP ${res.status}`);
    }

    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('1:')) {
        const rawJson = line.substring(2);
        return JSON.parse(rawJson) as SimtryxSimulation[];
      }
    }

    return [];
  }
}

export const simtryxClient = new SimtryxClient();

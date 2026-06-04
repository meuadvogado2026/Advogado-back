import type { AppEnv } from "../../config/env.js";

export type CepAddress = {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type Coordinates = {
  lat: number;
  lng: number;
  provider: "stub" | "nominatim";
  precision: "cep_centroid" | "street" | "manual";
  confidence: "high" | "medium" | "low";
};

export interface GeocodingProvider {
  lookupCep(cep: string): Promise<CepAddress>;
  geocodeAddress(address: CepAddress): Promise<Coordinates>;
}

/**
 * Motivos de falha de geocoding. Mapeados pela rota para respostas seguras:
 * - invalid_cep / cep_not_found  -> 422 (nao salva coordenada falsa)
 * - provider_unavailable         -> 503 (estado recuperavel)
 * - address_not_geocoded         -> 200 com coordenada nula (estado recuperavel)
 */
export type GeocodingErrorReason =
  | "invalid_cep"
  | "cep_not_found"
  | "provider_unavailable"
  | "address_not_geocoded";

export class GeocodingError extends Error {
  constructor(public readonly reason: GeocodingErrorReason, message: string) {
    super(message);
    this.name = "GeocodingError";
  }
}

// --- Cache com TTL (compartilhado por instancia) ---------------------------

type CacheEntry<T> = { value: T; expiresAt: number };

class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

// --- Rate limit: intervalo minimo serializado (politica Nominatim) ----------

class MinIntervalLimiter {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = this.intervalMs - (Date.now() - this.last);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.last = Date.now();
      return task();
    };

    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}

// --- Stub para testes/smoke (offline, coordenada fixa) ---------------------

const stubCepCache = new Map<string, CepAddress>();
const stubCoordinateCache = new Map<string, Coordinates>();

export class StubGeocodingProvider implements GeocodingProvider {
  async lookupCep(cep: string): Promise<CepAddress> {
    const normalized = cep.replace(/\D/g, "");
    if (!/^\d{8}$/.test(normalized)) {
      throw new GeocodingError("invalid_cep", "CEP deve conter 8 digitos.");
    }

    const cached = stubCepCache.get(normalized);
    if (cached) return cached;

    const address: CepAddress = {
      cep: normalized,
      street: "Rua de Smoke",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP"
    };
    stubCepCache.set(normalized, address);
    return address;
  }

  async geocodeAddress(address: CepAddress): Promise<Coordinates> {
    const cacheKey = `${address.cep}:${address.city}:${address.state}`;
    const cached = stubCoordinateCache.get(cacheKey);
    if (cached) return cached;

    const coordinates: Coordinates = {
      lat: -23.55052,
      lng: -46.633308,
      provider: "stub",
      precision: "cep_centroid",
      confidence: "low"
    };
    stubCoordinateCache.set(cacheKey, coordinates);
    return coordinates;
  }
}

// --- Provider real: BrasilAPI (CEP) + Nominatim (coordenada) ----------------

type NominatimProviderOptions = {
  brasilApiBaseUrl: string;
  nominatimBaseUrl: string;
  userAgent?: string;
  timeoutMs?: number;
  cepTtlMs?: number;
  coordTtlMs?: number;
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
};

type BrasilApiCep = {
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  type?: string;
  addresstype?: string;
};

function confidenceFromNominatim(result: NominatimResult): Coordinates["confidence"] {
  const category = result.addresstype ?? result.type ?? "";
  if (["road", "house_number", "building", "residential"].includes(category)) {
    return "high";
  }
  if (["suburb", "neighbourhood", "city_district", "postcode", "quarter"].includes(category)) {
    return "medium";
  }
  return "low";
}

export class NominatimGeocodingProvider implements GeocodingProvider {
  private readonly brasilApiBaseUrl: string;
  private readonly nominatimBaseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cepCache: TtlCache<CepAddress>;
  private readonly coordCache: TtlCache<Coordinates>;
  // Nominatim exige no maximo 1 req/s; BrasilAPI e mais tolerante mas o cache cobre.
  private readonly limiter: MinIntervalLimiter;

  constructor(options: NominatimProviderOptions) {
    this.brasilApiBaseUrl = options.brasilApiBaseUrl.replace(/\/$/, "");
    this.nominatimBaseUrl = options.nominatimBaseUrl.replace(/\/$/, "");
    this.userAgent = options.userAgent ?? "MeuAdvogado20/1.0 (contato: suporte@ent.app.br)";
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cepCache = new TtlCache<CepAddress>(options.cepTtlMs ?? 24 * 60 * 60 * 1000);
    this.coordCache = new TtlCache<Coordinates>(options.coordTtlMs ?? 24 * 60 * 60 * 1000);
    this.limiter = new MinIntervalLimiter(options.minIntervalMs ?? 1100);
  }

  async lookupCep(cep: string): Promise<CepAddress> {
    const normalized = cep.replace(/\D/g, "");
    if (!/^\d{8}$/.test(normalized)) {
      throw new GeocodingError("invalid_cep", "CEP deve conter 8 digitos.");
    }

    const cached = this.cepCache.get(normalized);
    if (cached) return cached;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.brasilApiBaseUrl}/cep/v1/${normalized}`, {
        headers: { accept: "application/json", "user-agent": this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new GeocodingError("provider_unavailable", "Servico de CEP indisponivel.");
    }

    if (response.status === 404) {
      throw new GeocodingError("cep_not_found", "CEP nao encontrado.");
    }
    if (!response.ok) {
      throw new GeocodingError("provider_unavailable", "Servico de CEP indisponivel.");
    }

    const data = (await response.json()) as BrasilApiCep;
    const address: CepAddress = {
      cep: normalized,
      street: data.street ?? "",
      neighborhood: data.neighborhood ?? "",
      city: data.city ?? "",
      state: data.state ?? ""
    };

    if (!address.city || !address.state) {
      throw new GeocodingError("cep_not_found", "CEP sem endereco normalizado.");
    }

    this.cepCache.set(normalized, address);
    return address;
  }

  async geocodeAddress(address: CepAddress): Promise<Coordinates> {
    const cacheKey = `${address.cep}:${address.street}:${address.city}:${address.state}`;
    const cached = this.coordCache.get(cacheKey);
    if (cached) return cached;

    const queries: Array<{ query: string; precision: Coordinates["precision"] }> = [];
    const streetQuery = [address.street, address.neighborhood, address.city, address.state, "Brasil"]
      .filter((part) => part.length > 0)
      .join(", ");
    const cityQuery = [address.city, address.state, "Brasil"].filter((part) => part.length > 0).join(", ");
    if (address.street || address.neighborhood) {
      queries.push({ query: streetQuery, precision: "street" });
    }
    if (cityQuery && cityQuery !== streetQuery) {
      queries.push({ query: cityQuery, precision: "cep_centroid" });
    }

    for (const { query, precision } of queries) {
      const url = `${this.nominatimBaseUrl}/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;

      let response: Response;
      try {
        response = await this.limiter.schedule(() =>
          this.fetchImpl(url, {
            headers: { accept: "application/json", "user-agent": this.userAgent },
            signal: AbortSignal.timeout(this.timeoutMs)
          })
        );
      } catch {
        throw new GeocodingError("provider_unavailable", "Servico de geocoding indisponivel.");
      }

      if (!response.ok) {
        throw new GeocodingError("provider_unavailable", "Servico de geocoding indisponivel.");
      }

      const results = (await response.json()) as NominatimResult[];
      const top = Array.isArray(results) ? results[0] : undefined;
      if (!top) continue;

      const lat = Number(top.lat);
      const lng = Number(top.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const coordinates: Coordinates = {
        lat,
        lng,
        provider: "nominatim",
        precision,
        confidence: confidenceFromNominatim(top)
      };
      this.coordCache.set(cacheKey, coordinates);
      return coordinates;
    }

    throw new GeocodingError("address_not_geocoded", "Endereco nao geocodificado.");
  }
}

/**
 * Seleciona o provider. Em testes ou com GEOCODING_PROVIDER=stub usa o stub
 * offline; caso contrario usa BrasilAPI + Nominatim reais.
 */
export function createGeocodingProvider(env: AppEnv): GeocodingProvider {
  if (env.NODE_ENV === "test" || env.GEOCODING_PROVIDER === "stub") {
    return new StubGeocodingProvider();
  }

  return new NominatimGeocodingProvider({
    brasilApiBaseUrl: env.BRASILAPI_BASE_URL,
    nominatimBaseUrl: env.NOMINATIM_BASE_URL
  });
}

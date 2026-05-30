import { describe, expect, it, vi } from "vitest";
import {
  GeocodingError,
  NominatimGeocodingProvider,
  type CepAddress
} from "../src/modules/geocoding/geocodingService.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function buildProvider(fetchImpl: typeof fetch) {
  return new NominatimGeocodingProvider({
    brasilApiBaseUrl: "https://brasilapi.test/api",
    nominatimBaseUrl: "https://nominatim.test",
    fetchImpl,
    minIntervalMs: 0
  });
}

const validCepBody = {
  cep: "01001000",
  state: "SP",
  city: "Sao Paulo",
  neighborhood: "Se",
  street: "Praca da Se"
};

describe("NominatimGeocodingProvider.lookupCep", () => {
  it("rejects malformed CEP without calling the provider", async () => {
    const fetchImpl = vi.fn();
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    await expect(provider.lookupCep("123")).rejects.toMatchObject({
      reason: "invalid_cep"
    } satisfies Partial<GeocodingError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 404 to cep_not_found", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "not found" }, 404));
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    await expect(provider.lookupCep("99999-999")).rejects.toMatchObject({ reason: "cep_not_found" });
  });

  it("maps network failure to provider_unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    await expect(provider.lookupCep("01001-000")).rejects.toMatchObject({ reason: "provider_unavailable" });
  });

  it("returns normalized address and caches the result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validCepBody));
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    const first = await provider.lookupCep("01001-000");
    const second = await provider.lookupCep("01001-000");

    expect(first).toMatchObject({ cep: "01001000", city: "Sao Paulo", state: "SP", street: "Praca da Se" });
    expect(second).toEqual(first);
    // Cache evita segunda chamada de rede para o mesmo CEP.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("NominatimGeocodingProvider.geocodeAddress", () => {
  const address: CepAddress = {
    cep: "01001000",
    street: "Praca da Se",
    neighborhood: "Se",
    city: "Sao Paulo",
    state: "SP"
  };

  it("returns coordinates from the nominatim provider and caches them", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ lat: "-23.55052", lon: "-46.633308", addresstype: "road" }]));
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    const first = await provider.geocodeAddress(address);
    const second = await provider.geocodeAddress(address);

    expect(first).toMatchObject({
      lat: -23.55052,
      lng: -46.633308,
      provider: "nominatim",
      precision: "street",
      confidence: "high"
    });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns address_not_geocoded when nominatim has no results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    await expect(provider.geocodeAddress(address)).rejects.toMatchObject({ reason: "address_not_geocoded" });
  });

  it("maps a non-ok response to provider_unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    const provider = buildProvider(fetchImpl as unknown as typeof fetch);

    await expect(provider.geocodeAddress(address)).rejects.toMatchObject({ reason: "provider_unavailable" });
  });
});

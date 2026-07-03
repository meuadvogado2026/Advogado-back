// Smoke roda em modo test para usar repositorios em memoria + tokens de teste,
// validando o novo contrato de match (auth + matched/empty) sem Supabase real.
process.env.NODE_ENV = "test";

import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";

const CLIENT = { authorization: "Bearer test-client-token" };
const SERVICE_STATE_ID = "10000000-0000-4000-8000-000000000001";

const repositories = createMemoryRepositories();
const catalogCity = await repositories.geographies.createCity({
  stateId: SERVICE_STATE_ID,
  name: `Cidade Catalogo Trabalhista ${Date.now()}`,
  active: true
});
await repositories.lawyers.create(
  {
    name: "Dra. Catalogo Trabalhista",
    email: `catalogo-trabalhista-${Date.now()}@example.test`,
    whatsapp: "61999990000",
    oabNumber: "123456",
    oabState: "DF",
    mainAreaId: "trabalhista",
    secondaryAreaIds: [],
    officeCep: "70000000",
    officeNumber: "1",
    status: "approved",
    serviceCityId: catalogCity.id,
    availableForMatches: true
  },
  {
    address: { city: "Brasilia", state: "DF" },
    coordinates: { lat: -15.8, lng: -47.9 },
    geocode: { provider: "manual", precision: "manual", confidence: "high" }
  }
);

const app = await buildApp(repositories);

const health = await app.inject({ method: "GET", url: "/health" });
const areas = await app.inject({ method: "GET", url: "/v1/areas" });
const clientSignup = await app.inject({
  method: "POST",
  url: "/v1/auth/signup-client",
  payload: {
    name: "Cliente Smoke",
    email: `cliente-smoke-${Date.now()}@example.test`,
    password: "senha-segura-123"
  }
});
const catalogStates = await app.inject({ method: "GET", url: "/v1/states?areaIds=civil" });
const catalogCities = await app.inject({ method: "GET", url: `/v1/states/${SERVICE_STATE_ID}/cities?areaIds=civil` });
const matchNoToken = await app.inject({
  method: "POST",
  url: "/v1/match",
  payload: { lat: -23.55052, lng: -46.633308, accuracyM: 25, areaIds: ["civil"] }
});
const matchMatched = await app.inject({
  method: "POST",
  url: "/v1/match",
  headers: CLIENT,
  payload: { lat: -23.55052, lng: -46.633308, accuracyM: 25, areaIds: ["civil"] }
});
const matchEmpty = await app.inject({
  method: "POST",
  url: "/v1/match",
  headers: CLIENT,
  payload: { lat: -23.55052, lng: -46.633308, accuracyM: 25, areaIds: ["criminal"] }
});
const lawyerProfileNoToken = await app.inject({ method: "GET", url: "/v1/lawyers/fixture-lawyer-sp" });
const lawyerProfileLawyer = await app.inject({
  method: "GET",
  url: "/v1/lawyers/fixture-lawyer-sp",
  headers: { authorization: "Bearer test-lawyer-token" }
});
const lawyerProfileUnavailable = await app.inject({
  method: "GET",
  url: "/v1/lawyers/fixture-lawyer-pending",
  headers: CLIENT
});
const lawyerProfileApproved = await app.inject({
  method: "GET",
  url: "/v1/lawyers/fixture-lawyer-sp",
  headers: CLIENT
});
const adminWithoutToken = await app.inject({ method: "GET", url: "/v1/admin/lawyers" });

await app.close();

const matchedOk = matchMatched.statusCode === 200 && matchMatched.json().status === "matched";
const matchedVisualsOk =
  matchMatched.json().lawyer?.avatarUrl === "https://example.test/ana-avatar.jpg" &&
  matchMatched.json().lawyer?.coverUrl === "https://example.test/ana-cover.jpg";
const emptyOk = matchEmpty.statusCode === 200 && matchEmpty.json().status === "empty";
const lawyerProfileOk =
  lawyerProfileApproved.statusCode === 200 &&
  lawyerProfileApproved.json().lawyer?.verified === true &&
  lawyerProfileApproved.json().lawyer?.officeCep === undefined;
const catalogOk =
  catalogStates.statusCode === 200 &&
  catalogCities.statusCode === 200 &&
  catalogStates.json().states.some((state: { id: string }) => state.id === SERVICE_STATE_ID) &&
  catalogCities.json().cities.some((city: { id: string }) => city.id === catalogCity.id);

if (
  health.statusCode !== 200 ||
  areas.statusCode !== 200 ||
  clientSignup.statusCode !== 201 ||
  clientSignup.json().user?.role !== "client" ||
  clientSignup.json().user?.token !== undefined ||
  !catalogOk ||
  matchNoToken.statusCode !== 401 ||
  !matchedOk ||
  !matchedVisualsOk ||
  !emptyOk ||
  lawyerProfileNoToken.statusCode !== 401 ||
  lawyerProfileLawyer.statusCode !== 200 ||
  lawyerProfileUnavailable.statusCode !== 404 ||
  !lawyerProfileOk ||
  adminWithoutToken.statusCode !== 401
) {
  throw new Error(
    `Smoke falhou: health=${health.statusCode}, areas=${areas.statusCode}, ` +
      `signup=${clientSignup.statusCode}, matchNoToken=${matchNoToken.statusCode}, matched=${matchMatched.statusCode}/${matchMatched.json().status}, ` +
      `catalog=${catalogStates.statusCode}/${catalogCities.statusCode}/${catalogOk}, ` +
      `matchVisuals=${matchedVisualsOk}, ` +
      `empty=${matchEmpty.statusCode}/${matchEmpty.json().status}, ` +
      `lawyerProfile=${lawyerProfileNoToken.statusCode}/${lawyerProfileLawyer.statusCode}/${lawyerProfileUnavailable.statusCode}/${lawyerProfileApproved.statusCode}, ` +
      `admin401=${adminWithoutToken.statusCode}`
  );
}

console.log(
  `Smoke backend OK: /health, /v1/areas, match sem token=401, ` +
    `signup cliente publico sem token/senha na resposta, ` +
    `catalogo de estados/cidades ignora area selecionada, ` +
    `matched (${matchMatched.json().distanceKm}km) com foto/capa e empty validados, ` +
    `perfil advogado 401/200/404/200, admin sem token=401.`
);

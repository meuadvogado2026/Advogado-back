// Smoke roda em modo test para usar repositorios em memoria + tokens de teste,
// validando o novo contrato de match (auth + matched/empty) sem Supabase real.
process.env.NODE_ENV = "test";

import { buildApp } from "../src/app.js";

const CLIENT = { authorization: "Bearer test-client-token" };

const app = await buildApp();

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
const lawyerProfileForbidden = await app.inject({
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

if (
  health.statusCode !== 200 ||
  areas.statusCode !== 200 ||
  clientSignup.statusCode !== 201 ||
  clientSignup.json().user?.role !== "client" ||
  clientSignup.json().user?.token !== undefined ||
  matchNoToken.statusCode !== 401 ||
  !matchedOk ||
  !matchedVisualsOk ||
  !emptyOk ||
  lawyerProfileNoToken.statusCode !== 401 ||
  lawyerProfileForbidden.statusCode !== 403 ||
  lawyerProfileUnavailable.statusCode !== 404 ||
  !lawyerProfileOk ||
  adminWithoutToken.statusCode !== 401
) {
  throw new Error(
    `Smoke falhou: health=${health.statusCode}, areas=${areas.statusCode}, ` +
      `signup=${clientSignup.statusCode}, matchNoToken=${matchNoToken.statusCode}, matched=${matchMatched.statusCode}/${matchMatched.json().status}, ` +
      `matchVisuals=${matchedVisualsOk}, ` +
      `empty=${matchEmpty.statusCode}/${matchEmpty.json().status}, ` +
      `lawyerProfile=${lawyerProfileNoToken.statusCode}/${lawyerProfileForbidden.statusCode}/${lawyerProfileUnavailable.statusCode}/${lawyerProfileApproved.statusCode}, ` +
      `admin401=${adminWithoutToken.statusCode}`
  );
}

console.log(
  `Smoke backend OK: /health, /v1/areas, match sem token=401, ` +
    `signup cliente publico sem token/senha na resposta, ` +
    `matched (${matchMatched.json().distanceKm}km) com foto/capa e empty validados, ` +
    `perfil advogado 401/403/404/200, admin sem token=401.`
);

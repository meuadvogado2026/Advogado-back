// Smoke roda em modo test para usar repositorios em memoria + tokens de teste,
// validando o novo contrato de match (auth + matched/empty) sem Supabase real.
process.env.NODE_ENV = "test";

import { buildApp } from "../src/app.js";

const CLIENT = { authorization: "Bearer test-client-token" };

const app = await buildApp();

const health = await app.inject({ method: "GET", url: "/health" });
const areas = await app.inject({ method: "GET", url: "/v1/areas" });
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
const adminWithoutToken = await app.inject({ method: "GET", url: "/v1/admin/lawyers" });

await app.close();

const matchedOk = matchMatched.statusCode === 200 && matchMatched.json().status === "matched";
const emptyOk = matchEmpty.statusCode === 200 && matchEmpty.json().status === "empty";

if (
  health.statusCode !== 200 ||
  areas.statusCode !== 200 ||
  matchNoToken.statusCode !== 401 ||
  !matchedOk ||
  !emptyOk ||
  adminWithoutToken.statusCode !== 401
) {
  throw new Error(
    `Smoke falhou: health=${health.statusCode}, areas=${areas.statusCode}, ` +
      `matchNoToken=${matchNoToken.statusCode}, matched=${matchMatched.statusCode}/${matchMatched.json().status}, ` +
      `empty=${matchEmpty.statusCode}/${matchEmpty.json().status}, admin401=${adminWithoutToken.statusCode}`
  );
}

console.log(
  `Smoke backend OK: /health, /v1/areas, match sem token=401, ` +
    `matched (${matchMatched.json().distanceKm}km) e empty validados, admin sem token=401.`
);

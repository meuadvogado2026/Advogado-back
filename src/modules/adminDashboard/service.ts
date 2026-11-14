import type { AdminDashboardSnapshot } from "../../repositories/types.js";
export type DashboardSnapshot = AdminDashboardSnapshot;
const regionStates: Record<string, string[]> = {
  "Norte": ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  "Nordeste": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MT", "MS"],
  "Sudeste": ["ES", "MG", "RJ", "SP"],
  "Sul": ["PR", "RS", "SC"],
  "Não informado": []
};
const percentage = (count: number, total: number) => total ? Math.round(count / total * 1000) / 10 : 0;

export function buildAdminDashboard(snapshot: DashboardSnapshot, now = new Date()) {
  const { profiles, lawyers, cities, states } = snapshot;
  const appUsers = profiles.filter(p => p.role === "client" || p.role === "lawyer");
  const profileById = new Map(profiles.map(p => [p.id, p]));
  const cityById = new Map(cities.map(c => [c.id, c]));
  const stateById = new Map(states.map(s => [s.id, s]));
  const totals = { draft: 0, pending_review: 0, approved: 0, rejected: 0, suspended: 0 };
  const regionCounts = new Map(Object.keys(regionStates).map(name => [name, 0]));
  const stateCounts = new Map<string, { code: string; name: string; count: number; available: number }>();
  for (const state of states) if (state.active) stateCounts.set(state.code, { code: state.code, name: state.name, count: 0, available: 0 });
  const servedCities = new Set<string>(), servedStates = new Set<string>();
  let available = 0;
  for (const lawyer of lawyers) {
    totals[lawyer.status]++;
    const city = lawyer.serviceCityId ? cityById.get(lawyer.serviceCityId) : undefined;
    const state = city ? stateById.get(city.stateId) : undefined;
    const region = state ? Object.keys(regionStates).find(name => regionStates[name]!.includes(state.code)) : undefined;
    const regionName = region ?? "Não informado";
    regionCounts.set(regionName, regionCounts.get(regionName)! + 1);
    const code = region ? state!.code : "--";
    const row = stateCounts.get(code) ?? { code, name: region ? state!.name : "Não informado", count: 0, available: 0 };
    row.count++;
    const profile = profileById.get(lawyer.profileId);
    const eligible = lawyer.status === "approved" && Boolean(profile) && !profile?.blockedAt && lawyer.availableForMatches && lawyer.hasOfficeLocation && lawyer.confidence === "high" && ["street", "manual"].includes(lawyer.precision ?? "") && Boolean(city?.active && state?.active);
    if (eligible) { available++; row.available++; servedCities.add(city!.id); servedStates.add(state!.id); }
    stateCounts.set(code, row);
  }
  const activeCities = cities.filter(c => c.active && stateById.get(c.stateId)?.active).length;
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return {
    generatedAt: now.toISOString(),
    operations: {
      prayers: { total: snapshot.operations.prayers.pending + snapshot.operations.prayers.read, ...snapshot.operations.prayers, readPercentage: percentage(snapshot.operations.prayers.read, snapshot.operations.prayers.pending + snapshot.operations.prayers.read) },
      partners: summarizeActivity(snapshot.operations.partners),
      benefits: summarizeActivity(snapshot.operations.benefits)
    },
    users: { total: appUsers.length, clients: appUsers.filter(p => p.role === "client").length, lawyerAccounts: appUsers.filter(p => p.role === "lawyer").length, blocked: appUsers.filter(p => p.blockedAt).length, newLast30Days: appUsers.filter(p => { const t = p.createdAt ? Date.parse(p.createdAt) : NaN; return t >= since && t <= now.getTime(); }).length },
    lawyers: { total: lawyers.length, available, approvedUnavailable: totals.approved - available, statuses: totals },
    coverage: { activeCities, servedCities: servedCities.size, unservedCities: activeCities - servedCities.size, percentage: percentage(servedCities.size, activeCities), servedStates: servedStates.size },
    regions: Array.from(regionCounts, ([name, count]) => ({ name, count, percentage: percentage(count, lawyers.length) })),
    states: Array.from(stateCounts.values()).map(row => ({ ...row, percentage: percentage(row.count, lawyers.length) })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  };
}

function summarizeActivity(counts: { active: number; inactive: number }) {
  const total = counts.active + counts.inactive;
  return { total, ...counts, activePercentage: percentage(counts.active, total) };
}

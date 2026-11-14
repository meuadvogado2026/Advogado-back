import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
import { buildAdminDashboard, type DashboardSnapshot } from "../src/modules/adminDashboard/service.js";
const now = new Date("2026-11-14T12:00:00Z");
const profile = (id:string, role:"client"|"lawyer"|"admin"="lawyer", createdAt="2026-11-01T12:00:00Z") => ({id,role,createdAt,blockedAt:null});
function fixture(): DashboardSnapshot {
 return {
  profiles:[profile("client","client"),profile("admin","admin"),profile("l1"),profile("l2"),{...profile("l3"),blockedAt:"2026-11-10"}],
  states:[{id:"sp",code:"SP",name:"São Paulo",active:true},{id:"df",code:"DF",name:"Distrito Federal",active:true}],
  cities:[{id:"city-sp",stateId:"sp",name:"São Paulo",active:true},{id:"city-df",stateId:"df",name:"Brasília",active:true},{id:"empty",stateId:"sp",name:"Campinas",active:true}],
  lawyers:[{id:"l1",profileId:"l1",status:"approved",serviceCityId:"city-sp",availableForMatches:true,hasOfficeLocation:true,confidence:"high",precision:"street"},
   {id:"l2",profileId:"l2",status:"pending_review",serviceCityId:"city-df",availableForMatches:true,hasOfficeLocation:true,confidence:"high",precision:"manual"},
   {id:"l3",profileId:"l3",status:"approved",serviceCityId:null,availableForMatches:true,hasOfficeLocation:true,confidence:"high",precision:"manual"}]
 };
}
describe("admin dashboard aggregates",()=>{
 it("counts roles and statuses without counting admin as an app user",()=>{
  const d=buildAdminDashboard(fixture(),now);
  expect(d.users).toMatchObject({total:4,clients:1,lawyerAccounts:3,blocked:1,newLast30Days:4});
  expect(d.lawyers).toMatchObject({total:3,available:1,approvedUnavailable:1,statuses:{approved:2,pending_review:1,draft:0}});
 });
 it("uses service city for regions with the full denominator and an unknown bucket",()=>{
  const d=buildAdminDashboard(fixture(),now);
  expect(d.regions.find(r=>r.name==="Sudeste")).toMatchObject({count:1,percentage:33.3});
  expect(d.regions.find(r=>r.name==="Centro-Oeste")).toMatchObject({count:1,percentage:33.3});
  expect(d.regions.find(r=>r.name==="Não informado")).toMatchObject({count:1,percentage:33.3});
  expect(d.coverage).toMatchObject({activeCities:3,servedCities:1,unservedCities:2,percentage:33.3,servedStates:1});
 });
 it("returns zero metrics without NaN for an empty database",()=>{
  const d=buildAdminDashboard({profiles:[],lawyers:[],cities:[],states:[]},now);
  expect(d.users.total).toBe(0);expect(d.coverage.percentage).toBe(0);expect(d.regions.every(r=>r.percentage===0)).toBe(true);
 });
 it.each(["blocked","unavailable","cityInactive","stateInactive","lowPrecision","missingProfile"])("does not count %s as coverage",condition=>{
  const f=fixture();
  if(condition==="blocked")f.profiles[2]!.blockedAt="2026-11-01";
  if(condition==="unavailable")f.lawyers[0]!.availableForMatches=false;
  if(condition==="cityInactive")f.cities[0]!.active=false;
  if(condition==="stateInactive")f.states[0]!.active=false;
  if(condition==="lowPrecision")f.lawyers[0]!.precision="cep_centroid";
  if(condition==="missingProfile")f.profiles=f.profiles.filter(p=>p.id!=="l1");
  expect(buildAdminDashboard(f,now).lawyers.available).toBe(0);
 });
 it("uses a rolling 30-day interval and excludes future/invalid dates",()=>{
  const f=fixture();f.profiles=[profile("boundary","client","2026-10-15T12:00:00Z"),profile("old","client","2026-10-15T11:59:59Z"),profile("future","client","2026-11-15"),profile("bad","client","bad")];
  expect(buildAdminDashboard(f,now).users.newLast30Days).toBe(1);
 });
 it.each([undefined,"test-client-token","test-lawyer-token"])("rejects non-admin %s",async token=>{
  const app=await buildApp();try{const r=await app.inject({method:"GET",url:"/v1/admin/dashboard",headers:token?{authorization:`Bearer ${token}`}:{}});expect(r.statusCode).toBe(token?403:401);}finally{await app.close();}
 });
 it("exposes only aggregate data to the admin and no raw identities",async()=>{
  const repos=createMemoryRepositories();vi.spyOn(repos.adminDashboard,"snapshot").mockResolvedValue(fixture());
  const app=await buildApp(repos);try{const r=await app.inject({method:"GET",url:"/v1/admin/dashboard",headers:{authorization:"Bearer test-admin-token"}});expect(r.statusCode).toBe(200);expect(r.headers["cache-control"]).toContain("no-store");const text=r.body;expect(text).not.toMatch(/profileId|blockedAt|serviceCityId|office_location|email|phone|prayer|coordinates/);expect(r.json().lawyers.total).toBe(3);}finally{await app.close();}
 });
 it("returns a clear failure instead of plausible zero totals on a database error",async()=>{
  const repos=createMemoryRepositories();vi.spyOn(repos.adminDashboard,"snapshot").mockRejectedValue(new Error("database unavailable"));
  const app=await buildApp(repos);try{const r=await app.inject({method:"GET",url:"/v1/admin/dashboard",headers:{authorization:"Bearer test-admin-token"}});expect(r.statusCode).toBe(502);expect(r.json()).not.toHaveProperty("users");}finally{await app.close();}
 });
});

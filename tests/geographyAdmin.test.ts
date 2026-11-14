import { it, expect, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
const ADMIN = {authorization: "Bearer test-admin-token"};

it("admin can explicitly include inactive cities while default and public catalog stay filtered", async () => {
 const repos = createMemoryRepositories();
 const active = {id:"active",stateId:"sp",stateCode:"SP",name:"São Paulo",active:true,center:{lat:0,lng:0},createdAt:"2026-11-14",updatedAt:"2026-11-14"};
 const inactive = {...active,id:"inactive",name:"Campinas",active:false};
 const list = vi.spyOn(repos.geographies,"listCities").mockImplementation(async (_id,activeOnly) => activeOnly ? [active] : [active,inactive]);
 const app = await buildApp(repos);
 try {
  const defaults = await app.inject({method:"GET",url:"/v1/admin/cities",headers:ADMIN});
  expect(defaults.json().cities).toEqual([active]);
  const all = await app.inject({method:"GET",url:"/v1/admin/cities?includeInactive=true&stateId=sp",headers:ADMIN});
  expect(all.json().cities).toEqual([active,inactive]);
  expect(list).toHaveBeenLastCalledWith("sp",false);
 } finally {await app.close();}
});
it.each([undefined,"test-client-token"])("protects inactive records from non-admin (%s)", async token => {
 const app=await buildApp();
 try {
  const r=await app.inject({method:"GET",url:"/v1/admin/cities?includeInactive=true",headers:token?{authorization:`Bearer ${token}`}:{}});
  expect(r.statusCode).toBe(token?403:401);
 } finally {await app.close();}
});
it("reactivates the existing city through PATCH while preserving its identity and coordinates", async () => {
 const repos=createMemoryRepositories();
 const state=await repos.geographies.getState("10000000-0000-4000-8000-000000000001");
 const city=await repos.geographies.createCity({stateId:state!.id,name:`Cidade ${crypto.randomUUID()}`,active:false,center:{lat:-1,lng:-2}});
 const app=await buildApp(repos);
 try {
  const r=await app.inject({method:"PATCH",url:`/v1/admin/cities/${city.id}`,headers:ADMIN,payload:{active:true}});
  expect(r.statusCode).toBe(200);expect(r.json().city).toMatchObject({id:city.id,active:true,center:{lat:-1,lng:-2},name:city.name});
 } finally {await app.close();}
});

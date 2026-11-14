import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countDashboardRows, readOperationCounts } from "../src/repositories/adminDashboardSnapshot.js";

describe("operation counts without sensitive rows",()=>{
 it("requests exact HEAD totals without downloading rows or applying page limits",async()=>{
  const eq=vi.fn().mockResolvedValue({count:2401,error:null,data:null});
  const select=vi.fn(()=>({eq}));const from=vi.fn(()=>({select}));
  expect(await countDashboardRows({from} as unknown as SupabaseClient,"prayer_requests","status","received")).toBe(2401);
  expect(select).toHaveBeenCalledWith("id",{count:"exact",head:true});expect(eq).toHaveBeenCalledWith("status","received");
 });
 it("separates pending/read and active/inactive counts including an empty catalog",async()=>{
  const client={from:(table:string)=>({select:()=>({eq:async(field:string,value:string|boolean)=>({count:table==="prayer_requests"?(value==="received"?3:7):table==="partner_logos"?(value?2:1):0,error:null,data:null})})})} as unknown as SupabaseClient;
  expect(await readOperationCounts(client)).toEqual({prayers:{pending:3,read:7},partners:{active:2,inactive:1},benefits:{active:0,inactive:0}});
 });
 it.each([{count:null,error:null},{count:0,error:{message:"unavailable"}},{count:-1,error:null}])("rejects unreliable counts instead of showing zero",async result=>{
  const c={from:()=>({select:()=>({eq:async()=>result})})} as unknown as SupabaseClient;
  await expect(countDashboardRows(c,"benefits","active",true)).rejects.toThrow();
 });
});

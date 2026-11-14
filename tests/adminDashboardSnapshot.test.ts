import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDashboardRows, createSupabaseDashboardRepository } from "../src/repositories/adminDashboardSnapshot.js";

describe("dashboard complete minimal snapshot",()=>{
 it("reads more than 1000 rows even when the server returns smaller pages",async()=>{
  const rows=Array.from({length:1001},(_,i)=>({id:String(i)})), offsets:number[]=[];
  const query={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn(async(from:number)=>{offsets.push(from);return {data:rows.slice(from,from+200),count:rows.length,error:null};})};
  const client={from:()=>query} as unknown as SupabaseClient;
  const result=await readDashboardRows(client,"profiles","id",z.object({id:z.string()}));
  expect(result).toHaveLength(1001);expect(offsets).toEqual([0,200,400,600,800,1000]);expect(new Set(result.map(r=>r.id)).size).toBe(1001);
 });
 it("fails instead of returning a partial page set",async()=>{
  const query={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValueOnce({data:[{id:"first"}],count:2,error:null}).mockResolvedValueOnce({data:null,count:null,error:{message:"timeout"}})};
  await expect(readDashboardRows({from:()=>query} as unknown as SupabaseClient,"profiles","id",z.object({id:z.string()}))).rejects.toThrow("unavailable");
 });
 it("does not select contact data or return geography/identity payloads in snapshot output",async()=>{
  const selections:string[]=[];
  const client={from:()=>({select:(columns:string)=>{selections.push(columns);return {order:()=>({range:async()=>({data:[],error:null,count:0})})};}})} as unknown as SupabaseClient;
  expect(await createSupabaseDashboardRepository(client).snapshot()).toEqual({profiles:[],lawyers:[],cities:[],states:[]});
  expect(selections.join(",")).not.toMatch(/email|phone|password|whatsapp|office_cep|prayer|message/);
 });
 it("fails on an incomplete response rather than spinning forever",async()=>{
  const q={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValue({data:[],count:2,error:null})};
  await expect(readDashboardRows({from:()=>q} as unknown as SupabaseClient,"profiles","id",z.object({id:z.string()}))).rejects.toThrow("incomplete");
 });
});

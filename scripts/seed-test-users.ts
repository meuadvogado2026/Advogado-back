import { loadEnv } from "../src/config/env.js";
import { createSupabaseAdminClient } from "../src/lib/supabase.js";

const env = loadEnv();
const supabase = createSupabaseAdminClient(env);

if (!supabase) {
  console.error("Seed bloqueado: SUPABASE_SERVICE_ROLE_KEY real nao encontrada no backend.");
  process.exit(1);
}

const testProfiles = [
  {
    id: "5b64c59f-1ecc-4dd7-8b5c-760b8b81b808",
    role: "admin",
    name: "Admin Teste",
    email: "admin@advogado20.com",
    phone: null
  },
  {
    id: "1128d0c0-b952-43cc-91d9-1140d08d8383",
    role: "lawyer",
    name: "Advogado Teste",
    email: "advogado@advogado20.com",
    phone: "11999999999"
  },
  {
    id: "bbcb5ae2-364d-4506-9872-f2ab731a3371",
    role: "client",
    name: "Usuario Teste",
    email: "usuario@advogado20.com",
    phone: "11888888888"
  }
] as const;

const { error: profileError } = await supabase.from("profiles").upsert(testProfiles, { onConflict: "id" });
if (profileError) {
  console.error(`Falha ao upsert profiles de teste: ${profileError.message}`);
  process.exit(1);
}

const { data: civilArea, error: areaError } = await supabase
  .from("legal_specialties")
  .select("id")
  .eq("slug", "civil")
  .maybeSingle();
if (areaError || !civilArea) {
  console.error(`Falha ao localizar area civil: ${areaError?.message ?? "area ausente"}`);
  process.exit(1);
}

const lawyerProfileId = "1128d0c0-b952-43cc-91d9-1140d08d8383";
const { data: existingLawyer, error: existingLawyerError } = await supabase
  .from("lawyer_profiles")
  .select("id")
  .eq("profile_id", lawyerProfileId)
  .maybeSingle();
if (existingLawyerError) {
  console.error(`Falha ao consultar lawyer_profile de teste: ${existingLawyerError.message}`);
  process.exit(1);
}

const lawyerPayload = {
  profile_id: lawyerProfileId,
  status: "approved",
  oab_number: "123456",
  oab_state: "SP",
  whatsapp: "11999999999",
  mini_bio: "Perfil de advogado para testes controlados.",
  office_cep: "01001000",
  office_street: "Praca da Se",
  office_number: "100",
  office_neighborhood: "Se",
  office_city: "Sao Paulo",
  office_state: "SP",
  office_lat: -23.55052,
  office_lng: -46.633308
};

const lawyerWrite = existingLawyer
  ? await supabase.from("lawyer_profiles").update(lawyerPayload).eq("id", existingLawyer.id).select("id").single()
  : await supabase.from("lawyer_profiles").insert(lawyerPayload).select("id").single();

if (lawyerWrite.error || !lawyerWrite.data) {
  console.error(`Falha ao gravar lawyer_profile de teste: ${lawyerWrite.error?.message ?? "sem retorno"}`);
  process.exit(1);
}

const { error: specialtyError } = await supabase.from("lawyer_specialties").upsert(
  {
    lawyer_profile_id: lawyerWrite.data.id,
    specialty_id: civilArea.id,
    is_main: true
  },
  { onConflict: "lawyer_profile_id,specialty_id" }
);
if (specialtyError) {
  console.error(`Falha ao gravar lawyer_specialty de teste: ${specialtyError.message}`);
  process.exit(1);
}

const { data: validation, error: validationError } = await supabase
  .from("profiles")
  .select("id, role, email")
  .in(
    "id",
    testProfiles.map((profile) => profile.id)
  )
  .order("email", { ascending: true });
if (validationError) {
  console.error(`Falha ao validar profiles de teste: ${validationError.message}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      result: "OK",
      profiles: validation?.map((profile) => ({ email: profile.email, role: profile.role })) ?? [],
      lawyerProfile: "OK"
    },
    null,
    2
  )
);

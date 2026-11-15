import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const vars = parse(readFileSync(resolve(process.cwd(), '..', '..', '.env')));
const project = 'https://qpemxkiowiiklztgumqy.supabase.co';
if (vars.SUPABASE_URL && vars.SUPABASE_URL !== project) throw new Error('PROJECT_MISMATCH');
Object.assign(process.env, vars, { NODE_ENV: 'production', EMAIL_PROVEDOR: 'disabled' });
const admin = createClient(project, vars.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const publicKey = vars.SUPABASE_ANON_KEY ?? vars.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const client = () => createClient(project, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = `auth024-${Date.now()}`;
const email = `meuadvogado2026+${tag}@gmail.com`;
const oldPassword = `Aa1!${randomBytes(20).toString('hex')}`;
const newPassword = `Bb2!${randomBytes(20).toString('hex')}`;
let ownedId: string | undefined;
let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>> | undefined;
const result: Record<string, unknown> = { environment: 'local backend inject + real Supabase Auth', fixtureTag: tag, actualEmailSent: false, resendDelivery: 'NOT_TESTED', android: 'NOT_TESTED' };
function ensure(condition: unknown, stage: string): asserts condition { if (!condition) throw new Error(stage); }
try {
 const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
 ensure(!created.error && created.data.user, 'CREATE_TEST_IDENTITY'); ownedId = created.data.user.id;
 const profile = await admin.from('profiles').insert({ id: ownedId, role: 'client', name: 'Teste descartavel Auth024', email, must_change_password: false });
 ensure(!profile.error, 'CREATE_TEST_PROFILE');
 const oldLogin = await client().auth.signInWithPassword({ email, password: oldPassword });
 ensure(!oldLogin.error && oldLogin.data.session, 'OLD_LOGIN_BASELINE');
 const oldSession = oldLogin.data.session;
 const generated = await admin.auth.admin.generateLink({ type: 'recovery', email });
 ensure(!generated.error && generated.data.properties?.hashed_token && generated.data.user.id === ownedId, 'GENERATE_OFFICIAL_PROOF');
 const { buildApp } = await import('../src/app.js'); app = await buildApp(); app.log.level = 'silent';
 const tokenHash = generated.data.properties.hashed_token;
 const payload = { tokenHash, type: 'recovery', newPassword, confirmPassword: newPassword };
 const reset = await app.inject({ method: 'POST', url: '/v1/auth/password-reset', payload });
 ensure(reset.statusCode === 200 && reset.json().status === 'password_updated', `RESET_HTTP_${reset.statusCode}`);
 result.passwordReset = true;
 const replay = await app.inject({ method: 'POST', url: '/v1/auth/password-reset', payload });
 ensure(replay.statusCode === 401, `REPLAY_HTTP_${replay.statusCode}`); result.replayRejected = true;
 const oldRejected = await client().auth.signInWithPassword({ email, password: oldPassword });
 ensure(!!oldRejected.error, 'OLD_PASSWORD_STILL_ACCEPTED'); result.oldPasswordRejected = true;
 const newLogin = await client().auth.signInWithPassword({ email, password: newPassword });
 ensure(!newLogin.error && newLogin.data.user?.id === ownedId, 'NEW_LOGIN_FAILED'); result.newLoginSameId = true;
 const updated = await admin.from('profiles').select('id,role,must_change_password').eq('id', ownedId).single();
 ensure(!updated.error && updated.data.id === ownedId && updated.data.role === 'client' && updated.data.must_change_password === false, 'PROFILE_DRIFT'); result.rolePreserved = true;
 const refresh = await client().auth.refreshSession({ refresh_token: oldSession.refresh_token });
 result.oldRefreshRejected = !!refresh.error;
 ensure(refresh.error, 'OLD_REFRESH_STILL_ACCEPTED');
 const oldJwt = await admin.auth.getUser(oldSession.access_token);
 result.oldJwtStillAccepted = !oldJwt.error;
 result.jwtLimit = 'Issued access JWT may remain valid until expiration; refresh revoked independently';
 result.status = 'PASS';
} catch (error) {
 result.status = 'FAIL'; result.stage = error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 100) : 'UNKNOWN';
 process.exitCode = 1;
} finally {
 await app?.close();
 if (ownedId) {
  const domainDelete = await admin.from('profiles').delete().eq('id', ownedId);
  const authDelete = await admin.auth.admin.deleteUser(ownedId);
  const domainCheck = await admin.from('profiles').select('id').eq('id', ownedId).maybeSingle();
  const authCheck = await admin.auth.admin.getUserById(ownedId);
  result.cleanup = { domainRemoved: !domainDelete.error && !domainCheck.error && !domainCheck.data, authRemoved: !authDelete.error && !!authCheck.error };
  if (!(result.cleanup as { domainRemoved: boolean; authRemoved: boolean }).domainRemoved || !(result.cleanup as { authRemoved: boolean }).authRemoved) { result.status = 'FAIL'; process.exitCode = 1; }
 }
 writeFileSync('harness-results/auth024-provider-smoke.json', JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
}

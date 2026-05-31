import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

type Step = {
  command: string;
  objective: string;
  exitCode: number | null;
  result: string;
};

const cwd = process.cwd();
const stepsToRun = [
  { command: "npm run typecheck", objective: "Validar tipos TypeScript do backend." },
  { command: "npm run test", objective: "Executar testes unitarios/contrato do backend." },
  { command: "npm run build", objective: "Gerar build Node para Railway." },
  { command: "npm run migration:check", objective: "Validar todas as migrations Supabase/PostGIS (0001+) sem aplicacao remota por padrao." },
  { command: "npm run smoke", objective: "Validar healthcheck e rotas base localmente." }
];

const steps: Step[] = stepsToRun.map((step) => {
  const result = spawnSync(step.command, { cwd, shell: true, encoding: "utf8" });
  return {
    ...step,
    exitCode: result.status,
    result: `${result.stdout}\n${result.stderr}`.trim()
  };
});

const exitCode = steps.some((step) => step.exitCode !== 0) ? 1 : 0;
const report = {
  environment: "back",
  cwd,
  objective: "Harness backend: tipos, testes, build, migrations dry-run e smoke API.",
  exitCode,
  result: exitCode === 0 ? "OK" : "FALHOU",
  gaps: [
    "Harness valida a migration estaticamente; aplicacoes manuais no Supabase devem ser registradas na documentacao.",
    "Smoke Supabase real do perfil roda separadamente em npm run match:smoke para usar credencial cliente e limpeza de eventos."
  ],
  steps
};

await mkdir("harness-results", { recursive: true });
await writeFile("harness-results/latest.json", JSON.stringify(report, null, 2));
await writeFile(
  "harness-results/latest.md",
  `# Harness Backend\n\n- cwd: ${cwd}\n- objetivo: ${report.objective}\n- exit code: ${exitCode}\n- resultado: ${report.result}\n- lacunas: ${report.gaps.join("; ")}\n`
);

console.log(JSON.stringify(report, null, 2));
process.exit(exitCode);

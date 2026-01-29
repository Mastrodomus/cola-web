import { mulberry32 } from "./rng.js";
import { normal, poisson, exponential, triangular } from "./distributions.js";

/**
 * Engine compatible con plantilla:
 * {
 *  day:{start,end,lambdaPerDay,seed},
 *  mix:{mode:{...}, triangularVolatility},
 *  serviceTime:{meansMin:{...}, cv, minClamp},
 *  stages:{enabled, shares:{validacion,cambiador,scan,salidaCambio,margen}, stageCv:{...}}
 * }
 *
 * Modelo:
 * - N ~ Poisson(lambdaPerDay)
 * - Llegadas intra-día: proceso de Poisson en [0, horizon]
 * - Mix diario: triangular alrededor del "mode" y normalizado
 * - Total por tipo: Normal truncada (mu, sigma=mu*cv)
 * - Partición del total en etapas por shares (suman 1)
 * - Recursos:
 *    * Mesa Atención: se usa para VALIDACION (entrada) y MARGEN (salida)
 *    * Cambiador: se usa para CAMBIADOR (pre) y SALIDACAMBIO (post)
 *    * Resonador: se usa para SCAN
 *
 * Devuelve rows con start/end por etapa + waits.
 */
export function simulateDay(plantilla) {
  validatePlantilla(plantilla);

  const rng = mulberry32(plantilla.day.seed);

  const horizon = timeWindowMinutes(plantilla.day.start, plantilla.day.end); // 720

  // 1) cantidad de pacientes del día
  const N = poisson(rng, plantilla.day.lambdaPerDay);

  // 2) mix diario (triangular alrededor del mode)
  const dayMix = sampleDayMix(rng, plantilla.mix.mode, plantilla.mix.triangularVolatility ?? 0);

  // 3) llegadas
  const arrivals = generateArrivals(rng, N, horizon);

  // 4) servidores (capacidad fija 1 por ahora; si querés la agregamos al JSON)
  const mesaServers = createServers(1);
  const cambiadorServers = createServers(1);
  const resonadorServers = createServers(1);

  const rows = [];

  for (let i = 1; i <= arrivals.length; i++) {
    const llegada = arrivals[i - 1];

    const tipo = pickFromCategorical(rng, dayMix);

    // total por tipo
    const mu = plantilla.serviceTime.meansMin[tipo];
    const sigma = mu * (plantilla.serviceTime.cv ?? 0);
    const total = clampMin(normal(rng, mu, sigma), plantilla.serviceTime.minClamp ?? 1);

    // tiempos por etapa (reparto por shares + variación por stageCv)
    const stageTimes = buildStageTimes(rng, total, plantilla.stages);

    // Secuencia con recursos:
    // Mesa (validacion) -> Cambiador (cambiador) -> Resonador (scan) -> Cambiador (salidaCambio) -> Mesa (margen)
    const v1 = scheduleOnServers(mesaServers, llegada, stageTimes.validacion);     // Mesa-in
    const c1 = scheduleOnServers(cambiadorServers, v1.end, stageTimes.cambiador); // Cambiador-pre
    const s1 = scheduleOnServers(resonadorServers, c1.end, stageTimes.scan);      // Scan
    const c2 = scheduleOnServers(cambiadorServers, s1.end, stageTimes.salidaCambio); // Cambiador-post
    const v2 = scheduleOnServers(mesaServers, c2.end, stageTimes.margen);         // Mesa-out (cierre)

    const salida = v2.end;
    const tiempoTotalSistema = salida - llegada;

    rows.push({
      id: i,
      tipo,

      // tiempos clave
      llegada,
      salida,
      tiempoTotalSistema,

      // duraciones por etapa (min)
      validacion: stageTimes.validacion,
      cambiador: stageTimes.cambiador,
      scan: stageTimes.scan,
      salidaCambio: stageTimes.salidaCambio,
      margen: stageTimes.margen,

      // start/end por etapa
      startValidacion: v1.start,
      endValidacion: v1.end,

      startCambiador: c1.start,
      endCambiador: c1.end,

      startScan: s1.start,
      endScan: s1.end,

      startSalidaCambio: c2.start,
      endSalidaCambio: c2.end,

      startMargen: v2.start,
      endMargen: v2.end,

      // esperas (útil para KPIs)
      waitValidacion: v1.start - llegada,
      waitCambiador: c1.start - v1.end,
      waitScan: s1.start - c1.end,
      waitSalidaCambio: c2.start - s1.end,
      waitMargen: v2.start - c2.end
    });
  }

  return rows;
}

/* ------------------------ STAGES ------------------------ */

/**
 * Construye tiempos por etapa:
 * - Si stages.enabled = false -> todo cae en scan (o en validacion) según tu preferencia.
 * - Si enabled = true:
 *   * Parte total por shares
 *   * Aplica ruido Normal por etapa con stageCv (multiplicativo)
 *   * Re-normaliza para que la suma se aproxime al total
 */
function buildStageTimes(rng, total, stages) {
  // fallback duro
  const fallback = {
    validacion: 0,
    cambiador: 0,
    scan: total,
    salidaCambio: 0,
    margen: 0
  };

  if (!stages?.enabled) return fallback;

  const shares = stages.shares ?? {};
  const stageCv = stages.stageCv ?? {};

  // base por share
  const base = {
    validacion: total * (shares.validacion ?? 0),
    cambiador: total * (shares.cambiador ?? 0),
    scan: total * (shares.scan ?? 0),
    salidaCambio: total * (shares.salidaCambio ?? 0),
    margen: total * (shares.margen ?? 0)
  };

  // ruido por etapa: t' = max(0, Normal(base, base*cvStage))
  const noisy = {};
  let sum = 0;

  for (const k of Object.keys(base)) {
    const m = base[k];
    const cv = Math.max(0, stageCv[k] ?? 0);
    const sd = m * cv;
    const x = (sd > 0) ? normal(rng, m, sd) : m;
    noisy[k] = Math.max(0, x);
    sum += noisy[k];
  }

  // reescalado para que sum ~= total
  if (sum > 0) {
    const scale = total / sum;
    for (const k of Object.keys(noisy)) noisy[k] *= scale;
  }

  return noisy;
}

/* ------------------------ ARRIVALS & MIX ------------------------ */

function generateArrivals(rng, N, horizon) {
  if (N <= 0) return [];
  const rate = N / horizon; // por minuto
  let t = 0;
  const arr = [];
  for (let i = 0; i < N; i++) {
    t += exponential(rng, rate);
    if (t > horizon) break;
    arr.push(t);
  }
  return arr;
}

function sampleDayMix(rng, modeProbs, volatility) {
  const vol = Math.max(0, Math.min(1, volatility));
  const keys = Object.keys(modeProbs);

  const raw = {};
  let sum = 0;

  for (const k of keys) {
    const mode = modeProbs[k];
    const min = mode * (1 - vol);
    const max = mode * (1 + vol);
    const v = (vol === 0) ? mode : triangular(rng, min, mode, max);
    raw[k] = Math.max(0, v);
    sum += raw[k];
  }

  const norm = {};
  if (sum === 0) {
    const p = 1 / keys.length;
    for (const k of keys) norm[k] = p;
    return norm;
  }
  for (const k of keys) norm[k] = raw[k] / sum;
  return norm;
}

function pickFromCategorical(rng, probs) {
  let r = rng();
  let acc = 0;
  const keys = Object.keys(probs);
  for (const k of keys) {
    acc += probs[k];
    if (r <= acc) return k;
  }
  return keys[keys.length - 1];
}

/* ------------------------ RESOURCES ------------------------ */

function createServers(capacity) {
  const c = Math.max(1, Math.floor(capacity ?? 1));
  return new Array(c).fill(0); // freeAt
}

function scheduleOnServers(servers, readyAt, serviceTime) {
  let bestIdx = 0;
  let bestFree = servers[0];

  for (let i = 1; i < servers.length; i++) {
    if (servers[i] < bestFree) {
      bestFree = servers[i];
      bestIdx = i;
    }
  }

  const start = Math.max(readyAt, bestFree);
  const end = start + serviceTime;

  servers[bestIdx] = end;
  return { start, end, serverIndex: bestIdx };
}

/* ------------------------ TIME UTILS ------------------------ */

function timeWindowMinutes(startHHMM, endHHMM) {
  const s = hhmmToMinutes(startHHMM);
  const e = hhmmToMinutes(endHHMM);
  const diff = e - s;
  if (diff <= 0) throw new Error("Ventana horaria inválida (end <= start).");
  return diff;
}

function hhmmToMinutes(hhmm) {
  // "08:00"
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}

/* ------------------------ VALIDATION ------------------------ */

function validatePlantilla(p) {
  if (!p?.day?.start || !p?.day?.end) throw new Error("Falta day.start/day.end");
  if (typeof p.day.lambdaPerDay !== "number") throw new Error("Falta day.lambdaPerDay");
  if (typeof p.day.seed !== "number") throw new Error("Falta day.seed");

  if (!p?.mix?.mode) throw new Error("Falta mix.mode");
  if (!p?.serviceTime?.meansMin) throw new Error("Falta serviceTime.meansMin");

  const st = p.stages;
  if (st?.enabled) {
    const sh = st.shares || {};
    const sum = (sh.validacion ?? 0) + (sh.cambiador ?? 0) + (sh.scan ?? 0) + (sh.salidaCambio ?? 0) + (sh.margen ?? 0);
    if (Math.abs(sum - 1) > 1e-6) {
      console.warn(`WARNING: stages.shares suman ${sum}. Recomendado = 1.0`);
    }
  }
}

function clampMin(x, min) {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, x);
}

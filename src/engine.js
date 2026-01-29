import { mulberry32 } from "./rng.js";
import { normal, poisson, exponential, triangular } from "./distributions.js";

/**
 * Simula un día completo (08:00 a 20:00 => 720 min)
 * Flujo: Mesa-in -> Cambiador-pre -> Scan (resonador) -> Cambiador-post -> Mesa-out
 * - N por día ~ Poisson(lambdaPerDay)
 * - Llegadas en el día: proceso de Poisson (interarribos exponenciales)
 * - Mix de estudios: probabilidades base con variación triangular (opcional)
 * - Tiempo total por tipo: Normal truncada (mu, sigma = mu*CV)
 * - Reparte el total en etapas via shares
 * - Capacidad por estación (mesa/cambiador/resonador) soporta múltiple servidor
 *
 * Devuelve: array rows con tiempos y métricas por paciente.
 */
export function simulateDay(config) {
  validateConfig(config);

  const rng = mulberry32(config.day.seed);

  // Ventana fija: 08:00-20:00
  const horizon = 720;

  // 1) N diario
  const N = poisson(rng, config.day.lambdaPerDay);

  // 2) Mix diario (triangular opcional)
  const dayMix = sampleDayMix(rng, config.mix.base, config.mix.triangularVolatility);

  // 3) Llegadas: proceso de Poisson dentro de la ventana
  const arrivals = generateArrivals(rng, N, horizon);

  // 4) Capacidad por estación (multi-servidor)
  const mesaServers = createServers(config.capacity.mesa);
  const cambiadorServers = createServers(config.capacity.cambiador);
  const resonadorServers = createServers(config.capacity.resonador);

  const rows = [];

  for (let i = 1; i <= arrivals.length; i++) {
    const llegada = arrivals[i - 1];

    // tipo por mix diario
    const tipo = pickFromCategorical(rng, dayMix);

    // tiempo total por tipo (Normal truncada)
    const mu = config.serviceTotal.meansMin[tipo];
    const sigma = mu * config.serviceTotal.cvTotal;
    const total = clampMin(normal(rng, mu, sigma), config.serviceTotal.minClamp ?? 1);

    // partición por shares
    const shares = config.shares;
    const stage = computeStageTimes(total, shares);

    // Mesa-in
    const mesa1 = scheduleOnServers(mesaServers, llegada, stage.mesaIn);

    // Cambiador-pre
    const camb1 = scheduleOnServers(cambiadorServers, mesa1.end, stage.cambiadorPre);

    // Resonador (scan)
    const scan1 = scheduleOnServers(resonadorServers, camb1.end, stage.scan);

    // Cambiador-post
    const camb2 = scheduleOnServers(cambiadorServers, scan1.end, stage.cambiadorPost);

    // Mesa-out
    const mesa2 = scheduleOnServers(mesaServers, camb2.end, stage.mesaOut);

    const salida = mesa2.end;
    const tiempoTotal = salida - llegada;

    rows.push({
      id: i,
      tipo,

      llegada,
      salida,
      tiempoTotal,

      // tiempos por etapa (duración)
      mesaIn: stage.mesaIn,
      cambiadorPre: stage.cambiadorPre,
      scan: stage.scan,
      cambiadorPost: stage.cambiadorPost,
      mesaOut: stage.mesaOut,

      // start/end por etapa
      startMesaIn: mesa1.start,
      endMesaIn: mesa1.end,

      startCamb: camb1.start,
      endCamb: camb1.end,

      startScan: scan1.start,
      endScan: scan1.end,

      startCamb2: camb2.start,
      endCamb2: camb2.end,

      startMesaOut: mesa2.start,
      endMesaOut: mesa2.end,

      // esperas (útiles para KPIs)
      waitMesaIn: mesa1.start - llegada,
      waitCambPre: camb1.start - mesa1.end,
      waitScan: scan1.start - camb1.end,
      waitCambPost: camb2.start - scan1.end,
      waitMesaOut: mesa2.start - camb2.end
    });
  }

  return rows;
}

/* ------------------------ Helpers ------------------------ */

function validateConfig(config) {
  if (!config?.day || typeof config.day.lambdaPerDay !== "number") {
    throw new Error("Config inválida: falta day.lambdaPerDay");
  }
  if (!config?.mix?.base) throw new Error("Config inválida: falta mix.base");
  if (!config?.serviceTotal?.meansMin) throw new Error("Config inválida: falta serviceTotal.meansMin");
  if (!config?.shares) throw new Error("Config inválida: falta shares");
  if (!config?.capacity) throw new Error("Config inválida: falta capacity");

  // shares deben sumar ~1 (tolerancia)
  const s = Object.values(config.shares).reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) > 1e-6) {
    console.warn(`WARNING: shares suman ${s}. Recomendado = 1.0`);
  }
}

function clampMin(x, min) {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, x);
}

function createServers(capacity) {
  const c = Math.max(1, Math.floor(capacity ?? 1));
  // Cada servidor tiene un "freeAt" inicial en 0
  return new Array(c).fill(0);
}

/**
 * Agenda un servicio en una estación con múltiples servidores.
 * - servers: array de freeAt
 * - readyAt: momento en que el paciente llega a la estación
 * - serviceTime: duración del servicio
 * Devuelve { start, end, serverIndex }
 */
function scheduleOnServers(servers, readyAt, serviceTime) {
  // Buscar servidor que se libera antes
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

function generateArrivals(rng, N, horizon) {
  if (N <= 0) return [];
  // tasa (por minuto) esperada para el día
  const rate = N / horizon;
  let t = 0;
  const arr = [];

  for (let i = 0; i < N; i++) {
    t += exponential(rng, rate);
    if (t > horizon) break;
    arr.push(t);
  }
  return arr;
}

/**
 * Muestra el mix "del día" basado en probabilidades base
 * y una volatilidad triangular alrededor del modo.
 *
 * volatility=0 => fijo (base normalizado)
 */
function sampleDayMix(rng, baseProbs, volatility) {
  const vol = Math.max(0, Math.min(1, volatility ?? 0));
  const keys = Object.keys(baseProbs);

  const raw = {};
  let sum = 0;

  for (const k of keys) {
    const mode = baseProbs[k];
    const min = mode * (1 - vol);
    const max = mode * (1 + vol);
    const v = (vol === 0) ? mode : triangular(rng, min, mode, max);
    raw[k] = Math.max(0, v);
    sum += raw[k];
  }

  // Normalizar
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
  for (const k of Object.keys(probs)) {
    acc += probs[k];
    if (r <= acc) return k;
  }
  // fallback por floating errors
  return Object.keys(probs)[Object.keys(probs).length - 1];
}

function computeStageTimes(total, shares) {
  const mesaIn = total * (shares.mesaIn ?? 0);
  const cambiadorPre = total * (shares.cambiadorPre ?? 0);
  const scan = total * (shares.scan ?? 0);
  const cambiadorPost = total * (shares.cambiadorPost ?? 0);
  const mesaOut = total * (shares.mesaOut ?? 0);

  // Ajuste mínimo por si alguna share falta/da 0 raro:
  return {
    mesaIn: Math.max(0, mesaIn),
    cambiadorPre: Math.max(0, cambiadorPre),
    scan: Math.max(0, scan),
    cambiadorPost: Math.max(0, cambiadorPost),
    mesaOut: Math.max(0, mesaOut)
  };
}

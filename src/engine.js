// src/engine.js
// Simulador de cola Resonador (MVP)
// - N por día: Poisson(lambdaPerDay)
// - Mix de estudios: probabilidades (con pequeño jitter opcional)
// - Tiempos: Normal con CV, clamp mínimo
// - Etapas: validacion, cambiador, scan, salidaCambio, margen

export function makeRng(seed = 12345) {
  // Mulberry32: simple y reproducible
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseTimeHHMM(s) {
  // "08:00" -> 480 (min)
  const [hh, mm] = String(s).split(":").map(Number);
  return hh * 60 + mm;
}

export function fmtClock(minFromStart, dayStartMin) {
  const m = Math.max(0, Math.floor(dayStartMin + minFromStart));
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function poisson(lambda, rng) {
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function normal(mean, sd, rng) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + sd * z;
}

export function clamp(x, min) {
  return x < min ? min : x;
}

export function jitterMix(baseProb, vol, rng) {
  // baseProb: {k: p}, vol: 0..1
  // agrega ruido multiplicativo leve y renormaliza.
  const keys = Object.keys(baseProb);
  const tmp = {};
  let sum = 0;
  for (const k of keys) {
    const p = baseProb[k];
    const mult = 1 + (rng() * 2 - 1) * vol; // [1-vol,1+vol]
    const v = Math.max(0, p * mult);
    tmp[k] = v;
    sum += v;
  }
  if (sum <= 0) return { ...baseProb };
  for (const k of keys) tmp[k] /= sum;
  return tmp;
}

export function sampleCategorical(prob, rng) {
  const keys = Object.keys(prob);
  let r = rng();
  let acc = 0;
  for (const k of keys) {
    acc += prob[k];
    if (r <= acc) return k;
  }
  return keys[keys.length - 1];
}

export function buildSchedule(scenario) {
  const dayStartMin = parseTimeHHMM(scenario.day.start);
  const dayEndMin = parseTimeHHMM(scenario.day.end);
  const horizon = dayEndMin - dayStartMin;

  if (horizon <= 0) throw new Error("Horario inválido: end <= start");

  const rng = makeRng(scenario.day.seed ?? 12345);

  // 1) Cantidad de pacientes del día (Poisson)
  const n = poisson(scenario.day.lambdaPerDay ?? 24, rng);

  // 2) Tiempos de llegada (para el MVP: uniformes en el horario)
  // (si querés Poisson process real: inter-arrivals exponenciales; lo dejamos simple y estable)
  const arrivals = Array.from({ length: n }, () => rng() * horizon).sort((a, b) => a - b);

  // 3) Mix (probabilidades base + volatilidad)
  const mixProb = jitterMix(
    scenario.mix?.mode ?? {},
    scenario.mix?.triangularVolatility ?? 0,
    rng
  );

  // 4) Service times por estudio
  const means = scenario.serviceTime?.meansMin ?? {};
  const cv = Number(scenario.serviceTime?.cv ?? 0.12);
  const minClamp = Number(scenario.serviceTime?.minClamp ?? 1);

  // 5) Stages
  const stagesEnabled = scenario.stages?.enabled !== false;
  const shares = scenario.stages?.shares ?? {
    validacion: 0.10, cambiador: 0.15, scan: 0.65, salidaCambio: 0.05, margen: 0.05
  };
  const stageCv = scenario.stages?.stageCv ?? {
    validacion: 0.25, cambiador: 0.25, scan: 0.10, salidaCambio: 0.30, margen: 0.50
  };

  // 6) Simulación 1 servidor (resonador) con cola FIFO.
  let serverFreeAt = 0;

  const rows = [];

  for (let i = 0; i < n; i++) {
    const id = i + 1;

    const tipo = sampleCategorical(mixProb, rng);
    const meanTotal = Number(means[tipo] ?? 18);
    const sdTotal = Math.max(0.0001, meanTotal * cv);
    const totalService = clamp(normal(meanTotal, sdTotal, rng), minClamp);

    // dividir por etapas
    const validShare = shares.validacion ?? 0.10;
    const cambShare = shares.cambiador ?? 0.15;
    const scanShare = shares.scan ?? 0.65;
    const outShare = shares.salidaCambio ?? 0.05;
    const marShare = shares.margen ?? 0.05;

    function stageTime(name, base) {
      const c = Number(stageCv[name] ?? 0.2);
      const sd = Math.max(0.0001, base * c);
      return clamp(normal(base, sd, rng), 0.2);
    }

    const validacion = stagesEnabled ? stageTime("validacion", totalService * validShare) : 0;
    const cambiador = stagesEnabled ? stageTime("cambiador", totalService * cambShare) : 0;
    const scan = stagesEnabled ? stageTime("scan", totalService * scanShare) : totalService;
    const salidaCambio = stagesEnabled ? stageTime("salidaCambio", totalService * outShare) : 0;
    const margen = stagesEnabled ? stageTime("margen", totalService * marShare) : 0;

    const llegada = arrivals[i];

    // FIFO single server: start = max(llegada, serverFreeAt)
    const startValidacion = Math.max(llegada, serverFreeAt);
    const endValidacion = startValidacion + validacion;

    const startCambiador = endValidacion;
    const endCambiador = startCambiador + cambiador;

    const startScan = endCambiador;
    const endScan = startScan + scan;

    const startSalidaCambio = endScan;
    const endSalidaCambio = startSalidaCambio + salidaCambio;

    const startMargen = endSalidaCambio;
    const endMargen = startMargen + margen;

    serverFreeAt = endMargen;

    const turnoAsignado = startValidacion; // “slot” real asignado al iniciar flujo

    rows.push({
      id,
      tipo,
      llegada,
      turnoAsignado,

      validacion,
      cambiador,
      scan,
      salidaCambio,
      margen,

      startValidacion,
      endValidacion,
      startCambiador,
      endCambiador,
      startScan,
      endScan,
      startSalidaCambio,
      endSalidaCambio,
      startMargen,
      endMargen,

      tiempoTotalServicio: (validacion + cambiador + scan + salidaCambio + margen),
      horaLlegada: fmtClock(llegada, dayStartMin),
      horaInicio: fmtClock(startValidacion, dayStartMin),
      horaSalida: fmtClock(endMargen, dayStartMin),
      espera: Math.max(0, startValidacion - llegada),
    });
  }

  return { rows, dayStartMin, horizon, n };
}

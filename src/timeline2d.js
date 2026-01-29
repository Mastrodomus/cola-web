export function renderTimeline2D(canvas, rows, opts) {
  const {
    startMin = 0,
    endMin = 720,
    pxPerMin = 2,
    maxRows = 60
  } = opts;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const paddingLeft = 80;
  const paddingTop = 30;
  const rowH = 18;
  const gap = 6;

  const shown = rows.slice(0, maxRows);

  // Tamaño dinámico según escala y cantidad de filas
  const w = Math.max(900, paddingLeft + (endMin - startMin) * pxPerMin + 40);
  const h = Math.max(300, paddingTop + shown.length * (rowH + gap) + 40);
  canvas.width = w;
  canvas.height = h;

  // limpiar
  ctx.clearRect(0, 0, w, h);

  // fondo
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  // grilla vertical cada 30 min
  ctx.font = "12px system-ui, Arial";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111";

  for (let m = startMin; m <= endMin; m += 30) {
    const x = paddingLeft + (m - startMin) * pxPerMin;
    ctx.strokeStyle = (m % 60 === 0) ? "#ddd" : "#eee";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, paddingTop - 10);
    ctx.lineTo(x, h - 20);
    ctx.stroke();

    if (m % 60 === 0) {
      ctx.fillStyle = "#666";
      ctx.fillText(`${(8 + m / 60).toFixed(0)}:00`, x - 14, paddingTop - 18);
    }
  }

  // encabezados
  ctx.fillStyle = "#111";
  ctx.fillText("Paciente", 10, paddingTop - 10);
  ctx.fillStyle = "#666";
  ctx.fillText("Tiempo (08:00–20:00)", paddingLeft, paddingTop - 10);

  // función utilidad: dibujar barra
  function bar(x1, x2, y, fill) {
    const width = Math.max(1, x2 - x1);
    ctx.fillStyle = fill;
    ctx.fillRect(x1, y, width, rowH);
  }

  // Colores (no hace falta que sean lindos; tienen que ser distinguibles)
  const colors = {
    validacion: "#e3f2fd",
    cambiador: "#e8f5e9",
    scan: "#ffebee",
    salidaCambio: "#fff8e1",
    margen: "#f3e5f5"
  };

  // Dibujar filas
  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    const y = paddingTop + i * (rowH + gap);

    // etiqueta fila
    ctx.fillStyle = "#111";
    ctx.fillText(String(r.id).padStart(2, " "), 18, y + rowH / 2);

    // barras por etapa (usamos start/end reales del engine)
    const segments = [
      ["validacion", r.startValidacion, r.endValidacion],
      ["cambiador", r.startCambiador, r.endCambiador],
      ["scan", r.startScan, r.endScan],
      ["salidaCambio", r.startSalidaCambio, r.endSalidaCambio],
      ["margen", r.startMargen, r.endMargen]
    ];

    for (const [k, a, b] of segments) {
      const x1 = paddingLeft + (a - startMin) * pxPerMin;
      const x2 = paddingLeft + (b - startMin) * pxPerMin;
      bar(x1, x2, y, colors[k] || "#ddd");
      // borde
      ctx.strokeStyle = "#bbb";
      ctx.strokeRect(x1, y, Math.max(1, x2 - x1), rowH);
    }

    // separador fila sutil
    ctx.strokeStyle = "#f3f3f3";
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y + rowH + gap / 2);
    ctx.lineTo(w - 10, y + rowH + gap / 2);
    ctx.stroke();
  }

  // leyenda
  const legendY = h - 18;
  let lx = 10;
  ctx.font = "12px system-ui, Arial";
  for (const [k, col] of Object.entries(colors)) {
    ctx.fillStyle = col;
    ctx.fillRect(lx, legendY - 8, 16, 12);
    ctx.strokeStyle = "#bbb";
    ctx.strokeRect(lx, legendY - 8, 16, 12);
    ctx.fillStyle = "#333";
    ctx.fillText(k, lx + 22, legendY - 2);
    lx += 120;
  }
}

import ExcelJS from 'exceljs';
import { SimtryxSimulation, getScenarioFriendlyName } from './simtryx';

// Helper seguro para generar y descargar imagen de gráfico en alta resolución
async function fetchChartBuffer(chartConfig: Record<string, unknown>, width = 650, height = 320): Promise<Buffer | null> {
  try {
    const qcUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=${width}&h=${height}&bkg=white&devicePixelRatio=2`;
    const res = await fetch(qcUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.warn('Advertencia: no se pudo descargar gráfico para Excel, continuando sin gráfico:', err);
    return null;
  }
}

export async function generateSimtryxExcelReport(simulations: SimtryxSimulation[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'UCSUR - Clínica de Simulación';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Paleta corporativa UCSUR
  const COLOR_HEADER_BG = '0C4A6E'; // Azul profundo
  const COLOR_ACCENT = '0284C7';    // Azul cian
  const COLOR_ZEBRA = 'F8FAFC';     // Gris muy claro
  const COLOR_BORDER = 'E2E8F0';

  // --- CÁLCULO DE MÉTRICAS Y AGREGACIONES ---
  const totalSims = simulations.length;
  let totalDurationSec = 0;
  let fullSessionsCount = 0;
  let shortSessionsCount = 0;

  const userMap: Record<string, {
    sessions: number;
    durationSec: number;
    scores: number[];
    scenarios: Set<string>;
    fullSessions: number;
    shortSessions: number;
  }> = {};

  const scenarioMap: Record<string, {
    count: number;
    durationSec: number;
    scores: number[];
    fullSessions: number;
  }> = {};

  const checklistOmissionsMap: Record<string, { total: number; completed: number; omitted: number }> = {};
  const debriefingMap: Record<string, { total: number; correct: number; incorrect: number }> = {};

  simulations.forEach(s => {
    const scName = getScenarioFriendlyName(s.sceneryID);
    if (!scenarioMap[scName]) {
      scenarioMap[scName] = { count: 0, durationSec: 0, scores: [], fullSessions: 0 };
    }
    scenarioMap[scName].count++;

    let durSec = 0;
    if (s.startTime && s.endTime) {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        durSec = Math.floor((end - start) / 1000);
        totalDurationSec += durSec;
        scenarioMap[scName].durationSec += durSec;
      }
    }

    if (durSec >= 120) {
      fullSessionsCount++;
      scenarioMap[scName].fullSessions++;
    } else {
      shortSessionsCount++;
    }

    const users = s.results?.users || [];
    users.forEach(u => {
      const uEmail = u.user || 'Sin identificar';
      if (!userMap[uEmail]) {
        userMap[uEmail] = {
          sessions: 0,
          durationSec: 0,
          scores: [],
          scenarios: new Set<string>(),
          fullSessions: 0,
          shortSessions: 0
        };
      }
      userMap[uEmail].sessions++;
      userMap[uEmail].durationSec += durSec;
      userMap[uEmail].scenarios.add(scName);

      if (durSec >= 120) userMap[uEmail].fullSessions++;
      else userMap[uEmail].shortSessions++;

      if (typeof u.success === 'number') {
        const scorePct = u.success * 100;
        userMap[uEmail].scores.push(scorePct);
        scenarioMap[scName].scores.push(scorePct);
      }
    });

    (s.results?.checklist || []).forEach(chk => {
      (chk.actionsData || []).forEach(cat => {
        (cat.required || []).forEach(req => {
          const actionKey = `${cat.categoryTitle} — ${req.title}`;
          if (!checklistOmissionsMap[actionKey]) {
            checklistOmissionsMap[actionKey] = { total: 0, completed: 0, omitted: 0 };
          }
          checklistOmissionsMap[actionKey].total++;
          if (req.success === 1) checklistOmissionsMap[actionKey].completed++;
          else checklistOmissionsMap[actionKey].omitted++;
        });
      });
    });

    (s.results?.debriefing?.questions || []).forEach(q => {
      const qKey = q.title;
      if (!debriefingMap[qKey]) {
        debriefingMap[qKey] = { total: 0, correct: 0, incorrect: 0 };
      }
      (q.userAnswers || []).forEach(ua => {
        debriefingMap[qKey].total++;
        if (ua.selectedOption === q.correctOption && ua.selectedOption !== -1) {
          debriefingMap[qKey].correct++;
        } else {
          debriefingMap[qKey].incorrect++;
        }
      });
    });
  });

  const totalHours = totalDurationSec / 3600;
  const avgMinSession = totalSims > 0 ? (totalDurationSec / totalSims) / 60 : 0;
  const allScores = Object.values(userMap).flatMap(u => u.scores);
  const globalAvgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  // ==========================================
  // PREPARAR GRÁFICOS VISUALES EN PARALELO
  // ==========================================
  // 1. Gráfico de Dona: Efectividad de Prácticas
  const chartDonutConfig = {
    type: 'doughnut',
    data: {
      labels: ['Sesiones Efectivas (≥2 min)', 'Sesiones Breves / Abortadas (<2 min)'],
      datasets: [{
        data: [fullSessionsCount, shortSessionsCount],
        backgroundColor: ['#059669', '#F59E0B'],
        borderWidth: 2,
        borderColor: '#ffffff',
      }]
    },
    options: {
      title: {
        display: true,
        text: 'Efectividad y Continuidad de Sesiones',
        fontColor: '#0F172A',
        fontSize: 14,
        fontStyle: 'bold'
      },
      legend: { position: 'bottom' },
      plugins: {
        datalabels: { display: true, color: '#ffffff', font: { weight: 'bold' } }
      }
    }
  };

  // 2. Gráfico de Barras: Top Casos por Horas
  const topScenariosForChart = Object.entries(scenarioMap)
    .sort((a, b) => b[1].durationSec - a[1].durationSec)
    .slice(0, 7);

  const chartScenariosConfig = {
    type: 'horizontalBar',
    data: {
      labels: topScenariosForChart.map(([name]) => name.length > 25 ? name.substring(0, 22) + '...' : name),
      datasets: [{
        label: 'Horas Acumuladas',
        data: topScenariosForChart.map(([, d]) => Number((d.durationSec / 3600).toFixed(1))),
        backgroundColor: '#0284C7',
        borderRadius: 4,
      }]
    },
    options: {
      title: {
        display: true,
        text: 'Horas de Práctica por Caso Clínico',
        fontColor: '#0F172A',
        fontSize: 14,
        fontStyle: 'bold'
      },
      legend: { display: false },
      scales: {
        xAxes: [{ ticks: { beginAtZero: true } }]
      }
    }
  };

  // 3. Gráfico de Barras: Top 8 Usuarios por Horas
  const sortedUsersList = Object.entries(userMap).sort((a, b) => b[1].durationSec - a[1].durationSec);
  const topUsersForChart = sortedUsersList.slice(0, 8);

  const chartUsersConfig = {
    type: 'bar',
    data: {
      labels: topUsersForChart.map(([u]) => u.split('@')[0]),
      datasets: [{
        label: 'Horas de Conexión',
        data: topUsersForChart.map(([, d]) => Number((d.durationSec / 3600).toFixed(1))),
        backgroundColor: '#4F46E5',
        borderRadius: 6,
      }]
    },
    options: {
      title: {
        display: true,
        text: 'Top Colaboradores con Mayor Tiempo en Simulación (Horas)',
        fontColor: '#0F172A',
        fontSize: 14,
        fontStyle: 'bold'
      },
      legend: { display: false },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }]
      }
    }
  };

  // 4. Gráfico de Errores de Omisión en Checklist
  const topOmissionsForChart = Object.entries(checklistOmissionsMap)
    .sort((a, b) => b[1].omitted - a[1].omitted)
    .slice(0, 6);

  const chartErrorsConfig = {
    type: 'horizontalBar',
    data: {
      labels: topOmissionsForChart.map(([name]) => {
        const shortName = name.split('—')[1]?.trim() || name;
        return shortName.length > 28 ? shortName.substring(0, 25) + '...' : shortName;
      }),
      datasets: [{
        label: '% de Omisión / Fallo',
        data: topOmissionsForChart.map(([, d]) => Number(((d.omitted / d.total) * 100).toFixed(1))),
        backgroundColor: '#DC2626',
        borderRadius: 4,
      }]
    },
    options: {
      title: {
        display: true,
        text: 'Top Errores de Omisión Clínica (% Acciones No Realizadas)',
        fontColor: '#0F172A',
        fontSize: 14,
        fontStyle: 'bold'
      },
      legend: { display: false },
      scales: {
        xAxes: [{ ticks: { min: 0, max: 100 } }]
      }
    }
  };

  // Descargar imágenes de gráficos en paralelo
  const [imgDonut, imgScenarios, imgUsers, imgErrors] = await Promise.all([
    fetchChartBuffer(chartDonutConfig, 420, 260),
    fetchChartBuffer(chartScenariosConfig, 580, 260),
    fetchChartBuffer(chartUsersConfig, 650, 300),
    fetchChartBuffer(chartErrorsConfig, 650, 280),
  ]);

  // ==========================================
  // HOJA 1: RESUMEN EJECUTIVO & DASHBOARD
  // ==========================================
  const wsDash = workbook.addWorksheet('Resumen Ejecutivo', {
    views: [{ showGridLines: true }],
  });

  wsDash.mergeCells('B2:H2');
  const titleCell = wsDash.getCell('B2');
  titleCell.value = 'UNIVERSIDAD CIENTÍFICA DEL SUR — CLÍNICA DE SIMULACIÓN';
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsDash.getRow(2).height = 36;

  wsDash.mergeCells('B3:H3');
  const subCell = wsDash.getCell('B3');
  subCell.value = `Auditoría General de Uso, Horas y Desempeño Clínico (Simtryx) | Generado: ${new Date().toLocaleDateString('es-PE')} ${new Date().toLocaleTimeString('es-PE')}`;
  subCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF64748B' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsDash.getRow(3).height = 22;

  // Tarjetas KPI (Fila 5 a 7)
  const kpiData = [
    { start: 'B', end: 'B', title: 'HORAS TOTALES', val: `${totalHours.toFixed(1)} hrs`, note: `Promedio: ${avgMinSession.toFixed(1)} min/caso`, color: '0284C7' },
    { start: 'C', end: 'C', title: 'TOTAL SESIONES', val: totalSims, note: `${fullSessionsCount} finalizadas / ${shortSessionsCount} breves`, color: '059669' },
    { start: 'D', end: 'E', title: 'USUARIOS / ALUMNOS', val: Object.keys(userMap).length, note: 'Participantes registrados', color: '6366F1' },
    { start: 'F', end: 'G', title: 'EFECTIVIDAD DE PRÁCTICA', val: `${((fullSessionsCount / totalSims) * 100).toFixed(1)}%`, note: 'Completaron caso (≥ 2 min)', color: '059669' },
    { start: 'H', end: 'H', title: 'PROMEDIO GLOBAL', val: `${globalAvgScore.toFixed(1)}%`, note: globalAvgScore >= 70 ? 'Meta cumplida' : 'Requiere refuerzo', color: globalAvgScore >= 70 ? '059669' : 'D97706' },
  ];

  kpiData.forEach(kpi => {
    wsDash.mergeCells(`${kpi.start}5:${kpi.end}5`);
    const h = wsDash.getCell(`${kpi.start}5`);
    h.value = kpi.title;
    h.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.color } };
    h.alignment = { horizontal: 'center', vertical: 'middle' };

    wsDash.mergeCells(`${kpi.start}6:${kpi.end}6`);
    const v = wsDash.getCell(`${kpi.start}6`);
    v.value = kpi.val;
    v.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FF0F172A' } };
    v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    v.alignment = { horizontal: 'center', vertical: 'middle' };

    wsDash.mergeCells(`${kpi.start}7:${kpi.end}7`);
    const n = wsDash.getCell(`${kpi.start}7`);
    n.value = kpi.note;
    n.font = { name: 'Segoe UI', size: 8, italic: true, color: { argb: 'FF64748B' } };
    n.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    n.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  wsDash.getRow(5).height = 20;
  wsDash.getRow(6).height = 30;
  wsDash.getRow(7).height = 18;

  // Insertar Gráficos en Hoja 1 (Fila 9)
  let dashTableStartRow = 9;
  if (imgDonut || imgScenarios) {
    if (imgScenarios) {
      const imgId1 = workbook.addImage({ base64: imgScenarios.toString('base64'), extension: 'png' });
      wsDash.addImage(imgId1, {
        tl: { col: 1, row: 8 }, // B9
        ext: { width: 520, height: 250 }
      });
    }
    if (imgDonut) {
      const imgId2 = workbook.addImage({ base64: imgDonut.toString('base64'), extension: 'png' });
      wsDash.addImage(imgId2, {
        tl: { col: 5, row: 8 }, // F9
        ext: { width: 380, height: 250 }
      });
    }
    dashTableStartRow = 23; // Dejar espacio para los gráficos
  }

  // TABLA DE ESCENARIOS
  wsDash.mergeCells(`B${dashTableStartRow}:H${dashTableStartRow}`);
  const tHeader = wsDash.getCell(`B${dashTableStartRow}`);
  tHeader.value = 'DESGLOSE DETALLADO DE USO Y RENDIMIENTO POR ESCENARIO CLÍNICO';
  tHeader.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF0F172A' } };
  wsDash.getRow(dashTableStartRow).height = 25;

  const headerRow = dashTableStartRow + 1;
  const scHeaders = ['Escenario Clínico', 'Sesiones', 'Horas Totales', 'Dur. Promedio', 'Nota Media', 'Finalizadas', 'Estado'];
  const scCols = ['B', 'C', 'D', 'E', 'F', 'G', 'H'];

  scHeaders.forEach((h, i) => {
    const c = wsDash.getCell(`${scCols[i]}${headerRow}`);
    c.value = h;
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
    c.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle' };
  });
  wsDash.getRow(headerRow).height = 24;

  let rIdx = headerRow + 1;
  Object.entries(scenarioMap)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([name, data], idx) => {
      const avgScore = data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0;
      const hrs = data.durationSec / 3600;
      const avgMin = data.count > 0 ? (data.durationSec / data.count) / 60 : 0;

      const row = wsDash.getRow(rIdx);
      row.values = [
        null,
        name,
        data.count,
        `${hrs.toFixed(2)} hrs`,
        `${avgMin.toFixed(1)} min`,
        `${avgScore.toFixed(1)}%`,
        `${data.fullSessions} (${((data.fullSessions / data.count) * 100).toFixed(0)}%)`,
        avgScore >= 70 ? '🟢 Aprobado' : avgScore >= 40 ? '🟡 Regular' : '🔴 Refuerzo'
      ];

      const isZebra = idx % 2 === 1;
      scCols.forEach((col, cI) => {
        const cell = wsDash.getCell(`${col}${rIdx}`);
        cell.font = { name: 'Segoe UI', size: 9 };
        cell.alignment = { horizontal: cI === 0 ? 'left' : 'center', vertical: 'middle' };
        if (isZebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: COLOR_BORDER } },
          right: { style: 'thin', color: { argb: COLOR_BORDER } },
          left: { style: 'thin', color: { argb: COLOR_BORDER } },
        };
      });
      row.height = 20;
      rIdx++;
    });

  wsDash.getColumn('A').width = 3;
  wsDash.getColumn('B').width = 42;
  wsDash.getColumn('C').width = 13;
  wsDash.getColumn('D').width = 15;
  wsDash.getColumn('E').width = 16;
  wsDash.getColumn('F').width = 14;
  wsDash.getColumn('G').width = 18;
  wsDash.getColumn('H').width = 16;

  // ==========================================
  // HOJA 2: DETALLE COMPLETO DE SIMULACIONES
  // ==========================================
  const wsDetail = workbook.addWorksheet('Detalle de Simulaciones', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: true }],
  });

  wsDetail.mergeCells('A1:J1');
  const dTitle = wsDetail.getCell('A1');
  dTitle.value = 'REGISTRO AUDITABLE COMPLETO DE SESIONES DE SIMULACIÓN (SIMTRYX)';
  dTitle.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  dTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
  dTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  wsDetail.getRow(1).height = 30;

  const detailHeaders = [
    'N°',
    'Fecha / Hora Inicio',
    'Fecha / Hora Fin',
    'Duración (Min)',
    'Tipo de Sesión',
    'Escenario Clínico',
    'Docente / Instructor',
    'Estudiantes Evaluados',
    'Nota Media (%)',
    'Resultado'
  ];

  detailHeaders.forEach((h, idx) => {
    const colNum = idx + 1;
    const cell = wsDetail.getCell(3, colNum);
    cell.value = h;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ACCENT } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  wsDetail.getRow(3).height = 25;

  simulations.forEach((sim, idx) => {
    const rowNum = idx + 4;
    const row = wsDetail.getRow(rowNum);

    let durMin = 0;
    if (sim.startTime && sim.endTime) {
      const start = new Date(sim.startTime).getTime();
      const end = new Date(sim.endTime).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        durMin = parseFloat(((end - start) / (1000 * 60)).toFixed(1));
      }
    }

    const isFull = durMin >= 2;
    const usersList = (sim.results?.users || []).map(u => u.user).join(', ');
    const scores = (sim.results?.users || []).map(u => (u.success || 0) * 100);
    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    row.values = [
      idx + 1,
      sim.startTime || '-',
      sim.endTime || '-',
      durMin,
      isFull ? 'Completa (Efectiva)' : 'Breve / Abortada',
      getScenarioFriendlyName(sim.sceneryID),
      sim.startUser || '-',
      usersList || 'Sin usuarios',
      avgScore !== null ? Number(avgScore.toFixed(1)) : '-',
      avgScore !== null ? (avgScore >= 70 ? 'APROBADO' : 'REFUERZO') : '-'
    ];

    const isZebra = idx % 2 === 1;
    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: c === 6 || c === 8 ? 'left' : 'center' };
      if (isZebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: COLOR_BORDER } },
        right: { style: 'thin', color: { argb: COLOR_BORDER } },
        left: { style: 'thin', color: { argb: COLOR_BORDER } },
      };

      if (c === 9 && typeof cell.value === 'number') {
        cell.numFmt = '0.0"%"';
        if (cell.value >= 70) {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF059669' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFDC2626' } };
        }
      }
    }
    row.height = 20;
  });

  wsDetail.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: simulations.length + 3, column: 10 }
  };

  wsDetail.getColumn(1).width = 7;
  wsDetail.getColumn(2).width = 20;
  wsDetail.getColumn(3).width = 20;
  wsDetail.getColumn(4).width = 15;
  wsDetail.getColumn(5).width = 18;
  wsDetail.getColumn(6).width = 36;
  wsDetail.getColumn(7).width = 26;
  wsDetail.getColumn(8).width = 38;
  wsDetail.getColumn(9).width = 16;
  wsDetail.getColumn(10).width = 16;

  // ==========================================
  // HOJA 3: HORAS Y KARDEX POR COLABORADOR
  // ==========================================
  const wsUsers = workbook.addWorksheet('Horas por Colaborador', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: true }],
  });

  wsUsers.mergeCells('A1:I1');
  const uTitle = wsUsers.getCell('A1');
  uTitle.value = 'KARDEX INDIVIDUAL DE HORAS Y PARTICIPACIÓN POR COLABORADOR / ESTUDIANTE';
  uTitle.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  uTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
  uTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  wsUsers.getRow(1).height = 30;

  // Insertar gráfico de usuarios si existe (a la derecha de la tabla)
  if (imgUsers) {
    const imgIdU = workbook.addImage({ base64: imgUsers.toString('base64'), extension: 'png' });
    wsUsers.addImage(imgIdU, {
      tl: { col: 10, row: 3 }, // K4
      ext: { width: 620, height: 290 }
    });
  }

  const userHeaders = [
    'N°',
    'Usuario / Correo Institucional',
    'Total Sesiones',
    'Horas Conectadas',
    'Sesiones Efectivas (≥2m)',
    'Sesiones Breves (<2m)',
    'Casos Distintos',
    'Nota Promedio',
    'Aprobadas (≥70%)'
  ];

  userHeaders.forEach((h, idx) => {
    const c = wsUsers.getCell(3, idx + 1);
    c.value = h;
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ACCENT } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  wsUsers.getRow(3).height = 24;

  sortedUsersList.forEach(([email, d], idx) => {
    const rowNum = idx + 4;
    const row = wsUsers.getRow(rowNum);
    const hrs = d.durationSec / 3600;
    const avgScore = d.scores.length > 0 ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0;
    const passedCount = d.scores.filter(s => s >= 70).length;

    row.values = [
      idx + 1,
      email,
      d.sessions,
      `${hrs.toFixed(2)} hrs`,
      d.fullSessions,
      d.shortSessions,
      d.scenarios.size,
      `${avgScore.toFixed(1)}%`,
      `${passedCount} / ${d.sessions}`
    ];

    const isZebra = idx % 2 === 1;
    for (let c = 1; c <= 9; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: c === 2 ? 'left' : 'center' };
      if (isZebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: COLOR_BORDER } },
        right: { style: 'thin', color: { argb: COLOR_BORDER } },
        left: { style: 'thin', color: { argb: COLOR_BORDER } },
      };
    }
    row.height = 20;
  });

  wsUsers.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: sortedUsersList.length + 3, column: 9 }
  };

  wsUsers.getColumn(1).width = 7;
  wsUsers.getColumn(2).width = 38;
  wsUsers.getColumn(3).width = 15;
  wsUsers.getColumn(4).width = 18;
  wsUsers.getColumn(5).width = 22;
  wsUsers.getColumn(6).width = 20;
  wsUsers.getColumn(7).width = 16;
  wsUsers.getColumn(8).width = 16;
  wsUsers.getColumn(9).width = 18;

  // ==========================================
  // HOJA 4: AUDITORÍA DE SEGURIDAD & ERRORES
  // ==========================================
  const wsErrors = workbook.addWorksheet('Seguridad y Errores Clínicos', {
    views: [{ showGridLines: true }],
  });

  wsErrors.mergeCells('B2:G2');
  const errTitle = wsErrors.getCell('B2');
  errTitle.value = 'MATRIZ DE SEGURIDAD DEL PACIENTE: ACCIONES OBLIGATORIAS Y ERRORES DE OMISIÓN';
  errTitle.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  errTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
  errTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  wsErrors.getRow(2).height = 30;

  // Gráfico de errores (Fila 4 a 17)
  let errTableStartRow = 4;
  if (imgErrors) {
    const imgIdE = workbook.addImage({ base64: imgErrors.toString('base64'), extension: 'png' });
    wsErrors.addImage(imgIdE, {
      tl: { col: 1, row: 3 }, // B4
      ext: { width: 620, height: 260 }
    });
    errTableStartRow = 18; // Espacio para el gráfico
  }

  const errHeaders = ['Categoría y Procedimiento Obligatorio', 'Veces Exigido', 'Acciones Cumplidas', 'Omisiones (Errores)', '% de Error', 'Nivel de Riesgo'];
  const errCols = ['B', 'C', 'D', 'E', 'F', 'G'];

  errHeaders.forEach((h, idx) => {
    const c = wsErrors.getCell(`${errCols[idx]}${errTableStartRow}`);
    c.value = h;
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ACCENT } };
    c.alignment = { horizontal: idx === 0 ? 'left' : 'center', vertical: 'middle' };
  });
  wsErrors.getRow(errTableStartRow).height = 24;

  let eRow = errTableStartRow + 1;
  Object.entries(checklistOmissionsMap)
    .sort((a, b) => b[1].omitted - a[1].omitted)
    .forEach(([procName, data], idx) => {
      const omitPct = (data.omitted / data.total) * 100;
      const row = wsErrors.getRow(eRow);
      row.values = [
        null,
        procName,
        data.total,
        data.completed,
        data.omitted,
        `${omitPct.toFixed(1)}%`,
        omitPct >= 80 ? '🔴 Crítico' : omitPct >= 50 ? '🟡 Alto' : '🟢 Moderado'
      ];

      const isZebra = idx % 2 === 1;
      errCols.forEach((col, cI) => {
        const cell = wsErrors.getCell(`${col}${eRow}`);
        cell.font = { name: 'Segoe UI', size: 9 };
        cell.alignment = { horizontal: cI === 0 ? 'left' : 'center', vertical: 'middle' };
        if (isZebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: COLOR_BORDER } },
          right: { style: 'thin', color: { argb: COLOR_BORDER } },
          left: { style: 'thin', color: { argb: COLOR_BORDER } },
        };
      });
      row.height = 20;
      eRow++;
    });

  wsErrors.getColumn('A').width = 3;
  wsErrors.getColumn('B').width = 46;
  wsErrors.getColumn('C').width = 15;
  wsErrors.getColumn('D').width = 18;
  wsErrors.getColumn('E').width = 18;
  wsErrors.getColumn('F').width = 14;
  wsErrors.getColumn('G').width = 16;

  // Generar Buffer final con tablas y gráficos
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

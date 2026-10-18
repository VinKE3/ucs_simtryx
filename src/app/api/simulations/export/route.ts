import { NextResponse } from 'next/server';
import { simtryxClient } from '@/lib/simtryx';
import { generateSimtryxExcelReport } from '@/lib/excel-generator';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month'); // e.g. 2026-10
    const scenario = searchParams.get('scenario');
    const effectiveOnly = searchParams.get('effectiveOnly') === 'true';
    const status = searchParams.get('status'); // APPROVED, REVIEW

    let simulations = await simtryxClient.getAllSimulations();

    if (!simulations || simulations.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No se encontraron simulaciones para exportar' },
        { status: 404 }
      );
    }

    // Aplicar filtros si se especificaron
    if (month && month !== 'ALL') {
      simulations = simulations.filter(s => s.startTime && s.startTime.startsWith(month));
    }
    if (scenario && scenario !== 'ALL') {
      simulations = simulations.filter(s => s.sceneryID === scenario);
    }
    if (effectiveOnly) {
      simulations = simulations.filter(s => {
        if (!s.startTime || !s.endTime) return false;
        const diff = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 1000;
        return diff >= 120;
      });
    }
    if (status && status !== 'ALL') {
      simulations = simulations.filter(s => {
        const scores = (s.results?.users || []).map(u => (u.success || 0) * 100);
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        if (status === 'APPROVED') return avg >= 70;
        if (status === 'REVIEW') return avg < 70;
        return true;
      });
    }

    if (simulations.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No hay simulaciones para los filtros seleccionados' },
        { status: 404 }
      );
    }

    const excelBuffer = await generateSimtryxExcelReport(simulations);
    const dateStr = new Date().toISOString().split('T')[0];
    const filterSuffix = month && month !== 'ALL' ? `_${month}` : '_Historico';
    const filename = `Reporte_Simulaciones_UCSUR${filterSuffix}_${dateStr}.xlsx`;

    return new NextResponse(excelBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}

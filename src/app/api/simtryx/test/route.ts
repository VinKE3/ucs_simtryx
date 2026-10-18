import { NextResponse } from 'next/server';
import { SimtryxClient } from '@/lib/simtryx';

export async function GET() {
  const email = process.env.SIMTRYX_EMAIL;
  const password = process.env.SIMTRYX_PASSWORD;

  if (!email || !password) {
    return NextResponse.json({
      configured: false,
      message: 'Faltan configurar SIMTRYX_EMAIL y SIMTRYX_PASSWORD en .env.local',
    }, { status: 400 });
  }

  const client = new SimtryxClient();

  try {
    const loginResult = await client.login(email, password);
    if (!loginResult.success) {
      return NextResponse.json({
        configured: true,
        success: false,
        error: loginResult.error,
      }, { status: 401 });
    }

    const simulations = await client.getAllSimulations();

    return NextResponse.json({
      configured: true,
      success: true,
      message: '¡Conexión y autenticación con Simtryx exitosas!',
      simulationsCount: simulations.length,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      configured: true,
      success: false,
      error: errorMsg,
    }, { status: 500 });
  }
}

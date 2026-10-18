import { NextResponse } from 'next/server';
import { simtryxClient } from '@/lib/simtryx';

export async function GET() {
  try {
    const simulations = await simtryxClient.getAllSimulations();
    return NextResponse.json({
      success: true,
      count: simulations.length,
      simulations,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}

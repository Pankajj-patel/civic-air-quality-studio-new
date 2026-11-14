import { and, eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { db } from '../../../db/index.ts';
import {
  briefings,
  datasets,
  hotspots,
  organizations,
  recommendations,
  statisticalRuns,
} from '../../../db/schema.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import { assertBriefingWithinAssignedLocations } from '../../utils/locationScope.ts';
import { recordAuditLog } from '../auditService.ts';
import { PollutantSummaryStat } from '../analytics/statsEngine.ts';
import { StructuredFindingRecord } from '../../../client/types/briefings.ts';

export async function generateBriefingPdfBuffer(params: {
  organizationId: number;
  userId: number;
  briefingId: number;
  assignedLocations?: string[];
}): Promise<{ filename: string; buffer: Buffer }> {
  const { organizationId, userId, briefingId, assignedLocations = [] } = params;

  const [briefing] = await db
    .select()
    .from(briefings)
    .where(and(eq(briefings.id, briefingId), eq(briefings.organizationId, organizationId)))
    .limit(1);

  if (!briefing) {
    throw new AppError(404, 'BRIEFING_NOT_FOUND', 'Briefing not found.');
  }

  await assertBriefingWithinAssignedLocations({
    briefingId: briefing.id,
    statisticalRunId: briefing.statisticalRunId,
    structuredFindingsJson: briefing.structuredFindingsJson,
    assignedLocations,
  });

  const [org, dataset, run, rawHotspotList, recList] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).then((r) => r[0]),
    db.select().from(datasets).where(eq(datasets.id, briefing.datasetId)).limit(1).then((r) => r[0]),
    db.select().from(statisticalRuns).where(eq(statisticalRuns.id, briefing.statisticalRunId)).limit(1).then((r) => r[0]),
    db.select().from(hotspots).where(eq(hotspots.statisticalRunId, briefing.statisticalRunId)),
    db.select().from(recommendations).where(eq(recommendations.briefingId, briefing.id)),
  ]);

  const hotspotList =
    assignedLocations.length > 0
      ? rawHotspotList.filter((h) => assignedLocations.includes(h.locationName))
      : rawHotspotList;

  const findings = JSON.parse(briefing.structuredFindingsJson) as StructuredFindingRecord[];
  const qualityNotes = JSON.parse(briefing.dataQualityNotesJson) as string[];
  const risks = JSON.parse(briefing.risksAndUncertaintiesJson) as string[];
  const globalSummary = run
    ? (JSON.parse(run.summaryMetricsJson).global as Record<string, PollutantSummaryStat>)
    : {};

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(10).fillColor('#475569').text(org?.name || 'Civic Organization');
    doc.moveDown(0.3);
    doc.fontSize(18).fillColor('#0F172A').text(briefing.title);
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#64748B')
      .text(
        `Stakeholder: ${briefing.stakeholderType.replace(/_/g, ' ')}  |  Status: ${briefing.status.toUpperCase()}  |  Standard: ${run?.aqiStandard || 'CPCB_NAQI'}  |  Dataset: ${dataset?.title || briefing.datasetId}`,
      );
    doc.moveDown(0.8);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#CBD5E1').stroke();
    doc.moveDown(0.8);

    // Executive Summary
    doc.fontSize(12).fillColor('#0F172A').text('1. Executive Summary');
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#1E293B').text(briefing.executiveSummary, { lineGap: 3 });
    doc.moveDown(0.8);

    // Pollutant Summary
    doc.fontSize(12).fillColor('#0F172A').text('2. Verified Pollutant Statistics');
    doc.moveDown(0.3);
    for (const stat of Object.values(globalSummary)) {
      doc
        .fontSize(9.5)
        .fillColor('#1E293B')
        .text(
          `• ${stat.pollutant} (${stat.unit}): Mean ${stat.mean ?? 'N/A'}, P95 ${stat.p95 ?? 'N/A'}, Max ${stat.max ?? 'N/A'} | Limit ${stat.guidelineLimit} | Exceedances ${stat.exceedancePct}% | Valid ${stat.validCount}/${stat.totalCount} | Trend: ${stat.trend}`,
        );
    }
    doc.moveDown(0.8);

    // Hotspots
    doc.fontSize(12).fillColor('#0F172A').text('3. Elevated Concentration Zones (Hotspots)');
    doc.moveDown(0.3);
    if (hotspotList.length === 0) {
      doc.fontSize(9.5).fillColor('#475569').text('No hotspots scored for this statistical run.');
    } else {
      for (const h of hotspotList) {
        doc
          .fontSize(9.5)
          .fillColor('#1E293B')
          .text(
            `• ${h.locationName} [${h.severity.toUpperCase()} — Score ${h.compositeScore}]: Dominant ${h.dominantPollutant}, Mean ${h.meanValue}, Peak ${h.peakValue}, Exceedance ${h.exceedanceFrequencyPct}%`,
          );
      }
    }
    doc.moveDown(0.8);

    // Findings
    doc.fontSize(12).fillColor('#0F172A').text('4. Structured Findings & Traceability');
    doc.moveDown(0.3);
    for (const f of findings) {
      doc.fontSize(10).fillColor('#0F172A').text(`${f.title} [${f.category}]`);
      doc.fontSize(9.5).fillColor('#334155').text(f.narrative, { lineGap: 2 });
      const refsText = f.evidenceRefs
        .map((r) => `${r.locationName}${r.observedValue != null ? ` (${r.observedValue} ${r.unit || ''})` : ''}`)
        .join('; ');
      doc.fontSize(8.5).fillColor('#64748B').text(`Evidence: Dataset #${briefing.datasetId} — ${refsText}`);
      doc.moveDown(0.4);
    }
    doc.moveDown(0.5);

    // Recommendations
    doc.fontSize(12).fillColor('#0F172A').text('5. Prioritized Stakeholder Action Plan');
    doc.moveDown(0.3);
    for (const rec of recList) {
      doc
        .fontSize(10)
        .fillColor('#0F172A')
        .text(`• ${rec.title} [Impact ${rec.impactScore}/5 · ${rec.urgency} · ${rec.status}]`);
      doc.fontSize(9.5).fillColor('#334155').text(rec.rationale, { lineGap: 2 });
      doc
        .fontSize(8.5)
        .fillColor('#64748B')
        .text(`Owner: ${rec.responsibleUnit} | Timeline: ${rec.suggestedTimeline}`);
      doc.moveDown(0.4);
    }
    doc.moveDown(0.5);

    // Data Quality & Uncertainties
    doc.fontSize(12).fillColor('#0F172A').text('6. Data Quality, Risks & Uncertainties');
    doc.moveDown(0.3);
    for (const q of qualityNotes) {
      doc.fontSize(9.5).fillColor('#334155').text(`• Quality: ${q}`);
    }
    for (const r of risks) {
      doc.fontSize(9.5).fillColor('#334155').text(`• Uncertainty: ${r}`);
    }

    doc.end();
  });

  await recordAuditLog({
    organizationId,
    actorUserId: userId,
    action: 'PDF_EXPORTED',
    resourceType: 'briefing',
    resourceId: briefingId,
    metadata: { bytes: buffer.length },
  });

  const safeSlug = briefing.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return {
    filename: `${safeSlug || `briefing-${briefingId}`}.pdf`,
    buffer,
  };
}

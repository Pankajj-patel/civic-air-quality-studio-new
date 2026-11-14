import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutShell } from '../../src/client/components/LayoutShell.tsx';
import { AdvisoryAndComparisonView } from '../../src/client/features/AdvisoryAndComparisonView.tsx';
import { DashboardView } from '../../src/client/features/DashboardView.tsx';
import { OrgSettingsView } from '../../src/client/features/OrgSettingsView.tsx';
import { RecommendationsAndBriefingsView } from '../../src/client/features/RecommendationsAndBriefingsView.tsx';
import { UploadAndMappingView } from '../../src/client/features/UploadAndMappingView.tsx';
import { BriefingSummaryItem, FullBriefingRecord } from '../../src/client/types/briefings.ts';
import { AuthUserSummary, OrganizationMembershipSummary } from '../../src/shared/types.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseMembership: OrganizationMembershipSummary = {
  organizationId: 1,
  organizationName: 'Ward 14 Civic Cell',
  slug: 'ward-14-civic-cell',
  orgType: 'municipality',
  role: 'org_admin',
  defaultAqiStandard: 'CPCB_NAQI',
  defaultLanguage: 'en',
  assignedLocations: [],
};

const baseUser: AuthUserSummary = {
  id: 1,
  email: 'officer@ward14.gov',
  fullName: 'Priya Sharma',
  memberships: [baseMembership],
};

const sampleBriefingSummary: BriefingSummaryItem = {
  id: 11,
  datasetId: 4,
  stakeholderType: 'municipal_ward_officer',
  title: 'Ward 14 November Briefing',
  executiveSummary: 'Elevated PM2.5 observed along Ward 14 main corridor.',
  status: 'verified',
  aiMetadata: {
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    verificationPassed: true,
    mismatchesFound: [],
    generatedAt: '2026-11-10T00:00:00Z',
  },
  createdAt: '2026-11-10T00:00:00Z',
};

const sampleFullBriefing: FullBriefingRecord = {
  ...sampleBriefingSummary,
  datasetTitle: 'Ward 14 November Export',
  statisticalRunId: 3,
  structuredFindings: [
    {
      id: 'f1',
      category: 'verified_observation',
      title: 'Station Alpha Elevated Mean',
      narrative: 'Observed PM2.5 mean of 112 µg/m³.',
      confidence: 'high',
      evidenceRefs: [{ datasetId: 4, locationName: 'Station Alpha', observedValue: 112, unit: 'µg/m³' }],
    },
  ],
  dataQualityNotes: ['98% completeness across valid records.'],
  risksAndUncertainties: ['Wind dispersion data unavailable.'],
  recommendations: [
    {
      id: 101,
      briefingId: 11,
      stakeholderType: 'municipal_ward_officer',
      title: 'Deploy wet road sweeping on Main Corridor',
      rationale: 'PM10 peaks coincide with morning traffic.',
      evidenceRefs: [{ datasetId: 4, locationName: 'Station Alpha' }],
      impactScore: 5,
      urgency: 'immediate',
      feasibility: 'high',
      responsibleUnit: 'Ward Sanitation Unit',
      suggestedTimeline: '48 hours',
      status: 'proposed',
    },
  ],
  advisories: [],
};

async function assertNoSeriousAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      region: { enabled: false },
    },
  });
  const severe = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
}

describe('Accessibility (WCAG 2.2 AA) & Component Behavior', () => {
  it('renders LayoutShell with skip link, aria-current, and zero critical/serious axe violations', async () => {
    const { container } = render(
      <LayoutShell
        user={baseUser}
        activeMembership={baseMembership}
        activeSection="dashboard"
        onSelectSection={vi.fn()}
        onSwitchOrg={vi.fn()}
        onLogout={vi.fn()}
      >
        <DashboardView
          activeMembership={baseMembership}
          datasets={[]}
          activeDataset={null}
          datasetStats={null}
          hotspots={[]}
          onNavigate={vi.fn()}
        />
      </LayoutShell>,
    );

    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await assertNoSeriousAxeViolations(container);
  });

  it('enforces read-only controls for viewer role in Upload, Recommendations, and Advisories', async () => {
    const { container } = render(
      <div>
        <UploadAndMappingView
          mode="upload"
          userRole="viewer"
          datasets={[]}
          activeDatasetId={null}
          onSelectDataset={vi.fn()}
          onDatasetUploaded={vi.fn()}
          onMappingConfirmed={vi.fn()}
          onSwitchToPreview={vi.fn()}
        />
        <RecommendationsAndBriefingsView
          mode="recommendations"
          userRole="viewer"
          datasets={[
            {
              id: 4,
              organizationId: 1,
              title: 'Ward 14 November Export',
              sourceType: 'csv',
              originalFilename: 'ward14.csv',
              rowCount: 40,
              status: 'ready',
              timeRangeStart: null,
              timeRangeEnd: null,
              createdAt: '2026-11-10T00:00:00Z',
            },
          ]}
          activeDatasetId={4}
          briefings={[sampleBriefingSummary]}
          activeBriefing={sampleFullBriefing}
          onSelectBriefing={vi.fn()}
          onGenerateBriefing={vi.fn()}
          onRefreshBriefing={vi.fn()}
          generating={false}
          aiError={null}
        />
      </div>,
    );

    expect(screen.getByRole('button', { name: /generate stakeholder actions/i })).toBeDisabled();
    expect(
      screen.getByLabelText(/status for deploy wet road sweeping/i),
    ).toBeDisabled();
    await assertNoSeriousAxeViolations(container);
  });

  it('syncs historical comparison selectors when briefings arrive after initial mount', async () => {
    const { rerender, container } = render(
      <AdvisoryAndComparisonView
        mode="comparisons"
        userRole="org_admin"
        briefings={[]}
        activeBriefing={null}
        onRefreshBriefing={vi.fn()}
      />,
    );

    const secondBriefing: BriefingSummaryItem = {
      ...sampleBriefingSummary,
      id: 9,
      title: 'Ward 14 October Baseline',
    };

    rerender(
      <AdvisoryAndComparisonView
        mode="comparisons"
        userRole="org_admin"
        briefings={[sampleBriefingSummary, secondBriefing]}
        activeBriefing={sampleFullBriefing}
        onRefreshBriefing={vi.fn()}
      />,
    );

    const currentSelect = screen.getByLabelText('Current Briefing') as HTMLSelectElement;
    const prevSelect = screen.getByLabelText('Previous Baseline Briefing') as HTMLSelectElement;
    expect(currentSelect.value).toBe('11');
    expect(prevSelect.value).toBe('9');
    await assertNoSeriousAxeViolations(container);
  });

  it('passes axe-core checks on OrgSettingsView with associated form labels', async () => {
    const viewerMembership: OrganizationMembershipSummary = {
      ...baseMembership,
      role: 'analyst',
    };
    const { container } = render(
      <OrgSettingsView activeMembership={viewerMembership} onRefreshProfile={vi.fn()} />,
    );
    expect(screen.getByLabelText('Organization Name', { selector: '#settings-org-name' })).toBeDisabled();
    await assertNoSeriousAxeViolations(container);
  });
});

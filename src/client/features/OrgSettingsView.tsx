import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Shield, UserPlus } from 'lucide-react';
import {
  AQI_STANDARDS,
  AqiStandard,
  ORG_TYPES,
  OrgType,
  OrganizationMembershipSummary,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  USER_ROLES,
  UserRole,
} from '../../shared/types.ts';
import { AlertBanner } from '../components/AlertBanner.tsx';
import { ApiClientError, apiRequest } from '../lib/api.ts';

interface OrgMemberRow {
  membershipId: number;
  userId: number;
  email: string;
  fullName: string;
  role: UserRole;
  assignedLocations: string[];
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
  actorEmail: string | null;
  actorName: string | null;
}

interface OrgSettingsViewProps {
  activeMembership: OrganizationMembershipSummary;
  onRefreshProfile: () => Promise<void>;
}

export const OrgSettingsView: React.FC<OrgSettingsViewProps> = ({
  activeMembership,
  onRefreshProfile,
}) => {
  const isAdmin = activeMembership.role === 'org_admin';

  // Settings form
  const [orgName, setOrgName] = useState(activeMembership.organizationName);
  const [aqiStandard, setAqiStandard] = useState<AqiStandard>(activeMembership.defaultAqiStandard);
  const [language, setLanguage] = useState<SupportedLanguage>(
    (activeMembership.defaultLanguage as SupportedLanguage) || 'en',
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Members & Invite
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('ward_officer');
  const [inviteLocations, setInviteLocations] = useState('');
  const [inviting, setInviting] = useState(false);

  // New org form
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<OrgType>('municipality');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadAdminData = useCallback(async () => {
    try {
      const [mRes, aRes] = await Promise.all([
        apiRequest<{ members: OrgMemberRow[] }>(
          `/api/orgs/${activeMembership.organizationId}/members`,
        ),
        apiRequest<{ logs: AuditLogRow[] }>(
          `/api/orgs/${activeMembership.organizationId}/audit-logs`,
        ),
      ]);
      setMembers(mRes.members);
      setAuditLogs(aRes.logs);
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof ApiClientError
            ? err.message
            : 'Unable to load organization members and audit logs.',
      });
    }
  }, [activeMembership.organizationId]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    Promise.all([
      apiRequest<{ members: OrgMemberRow[] }>(
        `/api/orgs/${activeMembership.organizationId}/members`,
      ),
      apiRequest<{ logs: AuditLogRow[] }>(
        `/api/orgs/${activeMembership.organizationId}/audit-logs`,
      ),
    ])
      .then(([mRes, aRes]) => {
        if (cancelled) return;
        setMembers(mRes.members);
        setAuditLogs(aRes.logs);
      })
      .catch((err) => {
        if (cancelled) return;
        setFeedback({
          type: 'err',
          text:
            err instanceof ApiClientError
              ? err.message
              : 'Unable to load organization members and audit logs.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeMembership.organizationId, isAdmin]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setSavingSettings(true);
    try {
      await apiRequest(`/api/orgs/${activeMembership.organizationId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: orgName,
          defaultAqiStandard: aqiStandard,
          defaultLanguage: language,
        }),
      });
      await onRefreshProfile();
      if (isAdmin) await loadAdminData();
      setFeedback({ type: 'ok', text: 'Organization standards and settings saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.message : 'Unable to save settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setInviting(true);
    try {
      const locations = inviteLocations
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiRequest(`/api/orgs/${activeMembership.organizationId}/members`, {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail,
          fullName: inviteName || undefined,
          role: inviteRole,
          assignedLocations: locations,
        }),
      });
      setInviteEmail('');
      setInviteName('');
      setInviteLocations('');
      await loadAdminData();
      setFeedback({ type: 'ok', text: 'Member role updated for organization.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.message : 'Unable to assign member role.',
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setCreatingOrg(true);
    try {
      await apiRequest('/api/orgs', {
        method: 'POST',
        body: JSON.stringify({
          name: newOrgName,
          orgType: newOrgType,
          defaultAqiStandard: 'CPCB_NAQI',
          defaultLanguage: 'en',
        }),
      });
      setNewOrgName('');
      await onRefreshProfile();
      setFeedback({ type: 'ok', text: 'New civic organization created.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.message : 'Unable to create organization.',
      });
    } finally {
      setCreatingOrg(false);
    }
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <AlertBanner
          variant={feedback.type === 'ok' ? 'success' : 'error'}
          message={feedback.text}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Organization Standards */}
        <form
          onSubmit={handleSaveSettings}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">
              Organization Standards &amp; Configuration
            </h2>
          </div>

          <div>
            <label htmlFor="settings-org-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Organization Name
            </label>
            <input
              id="settings-org-name"
              type="text"
              disabled={!isAdmin}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="settings-aqi-standard" className="block text-xs font-medium text-slate-700 mb-1.5">
                Air Quality Threshold Standard
              </label>
              <select
                id="settings-aqi-standard"
                disabled={!isAdmin}
                value={aqiStandard}
                onChange={(e) => setAqiStandard(e.target.value as AqiStandard)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              >
                {AQI_STANDARDS.map((std) => (
                  <option key={std} value={std}>
                    {std}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="settings-default-language" className="block text-xs font-medium text-slate-700 mb-1.5">
                Default Advisory Language
              </label>
              <select
                id="settings-default-language"
                disabled={!isAdmin}
                value={language}
                onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang === 'en' ? 'English' : 'Hindi'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isAdmin ? (
            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          ) : (
            <p className="text-xs text-slate-600">
              Only organization administrators can modify threshold standards.
            </p>
          )}
        </form>

        {/* Create Additional Organization */}
        <form
          onSubmit={handleCreateOrg}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Create Additional Workspace</h2>
          </div>
          <div>
            <label htmlFor="new-org-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Organization Name
            </label>
            <input
              id="new-org-name"
              type="text"
              required
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="e.g., Green Valley Housing Society"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="new-org-type" className="block text-xs font-medium text-slate-700 mb-1.5">
              Organization Type
            </label>
            <select
              id="new-org-type"
              value={newOrgType}
              onChange={(e) => setNewOrgType(e.target.value as OrgType)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={creatingOrg}
            className="px-4 py-2 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
          >
            {creatingOrg ? 'Creating...' : 'Create Organization'}
          </button>
        </form>
      </div>

      {/* Member Management & Audit Logs */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Organization Members &amp; Role-Based Access
            </h3>

            <form
              onSubmit={handleInviteMember}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4 border-b border-slate-100"
            >
              <div>
                <label htmlFor="invite-member-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Member Email
                </label>
                <input
                  id="invite-member-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@organization.org"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="invite-member-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name (if new user)
                </label>
                <input
                  id="invite-member-name"
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Optional display name"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="invite-member-role" className="block text-xs font-medium text-slate-700 mb-1">
                  Assigned Role
                </label>
                <select
                  id="invite-member-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="invite-member-locations" className="block text-xs font-medium text-slate-700 mb-1">
                  Assigned Wards / Sites (optional)
                </label>
                <input
                  id="invite-member-locations"
                  type="text"
                  value={inviteLocations}
                  onChange={(e) => setInviteLocations(e.target.value)}
                  placeholder="Comma-separated site names"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                {inviting ? 'Assigning...' : 'Add or Update Member'}
              </button>
            </form>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Name
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Email
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Role
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Locations
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr key={m.membershipId}>
                      <td className="py-2.5 pr-3 font-medium text-slate-900">{m.fullName}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{m.email}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-800">{m.role}</td>
                      <td className="py-2.5 text-slate-600">
                        {m.assignedLocations.length > 0 ? m.assignedLocations.join(', ') : 'All'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Security Audit Trail</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {auditLogs.length === 0 ? (
                <p className="text-xs text-slate-600">No audit entries recorded yet.</p>
              ) : (
                auditLogs.map((log) => (
                  <div key={log.id} className="pb-2.5 border-b border-slate-100 last:border-0 text-xs">
                    <div className="font-mono font-medium text-slate-900">{log.action}</div>
                    <div className="mt-0.5 text-slate-600">
                      {log.actorEmail || 'System'} · {log.resourceType} #{log.resourceId} ·{' '}
                      <span className="font-mono tabular-nums">{log.createdAt}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

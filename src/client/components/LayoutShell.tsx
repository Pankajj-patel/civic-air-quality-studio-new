import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Building2,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  GitCompare,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  Megaphone,
  Menu,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import { AuthUserSummary, OrganizationMembershipSummary } from '../../shared/types.ts';
import { canWriteRole } from '../lib/constants.ts';

export type WorkspaceSection =
  | 'dashboard'
  | 'upload'
  | 'preview'
  | 'analysis'
  | 'hotspots'
  | 'recommendations'
  | 'briefings'
  | 'advisories'
  | 'comparisons'
  | 'settings';

interface NavItem {
  id: WorkspaceSection;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload Data', icon: Upload },
  { id: 'preview', label: 'Data Preview', icon: FileSpreadsheet },
  { id: 'analysis', label: 'AI Analysis', icon: Activity },
  { id: 'hotspots', label: 'Pollution Hotspots', icon: MapPin },
  { id: 'recommendations', label: 'Action Plans', icon: ListChecks },
  { id: 'briefings', label: 'Briefings & PDF', icon: FileText },
  { id: 'advisories', label: 'Citizen Advisory', icon: Megaphone },
  { id: 'comparisons', label: 'Historical Diff', icon: GitCompare },
  { id: 'settings', label: 'Org & Settings', icon: Settings },
];

interface LayoutShellProps {
  user: AuthUserSummary;
  activeMembership: OrganizationMembershipSummary;
  activeSection: WorkspaceSection;
  onSelectSection: (section: WorkspaceSection) => void;
  onSwitchOrg: (orgId: number) => void;
  onLogout: () => void;
  liveStatusMessage?: string | null;
  children: React.ReactNode;
}

export const LayoutShell: React.FC<LayoutShellProps> = ({
  user,
  activeMembership,
  activeSection,
  onSelectSection,
  onSwitchOrg,
  onLogout,
  liveStatusMessage,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const currentNav = NAV_ITEMS.find((item) => item.id === activeSection) ?? NAV_ITEMS[0];
  const canWrite = canWriteRole(activeMembership.role);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    drawerCloseRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  function closeMobileDrawer() {
    setMobileMenuOpen(false);
    requestAnimationFrame(() => {
      menuTriggerRef.current?.focus();
    });
  }

  const renderNavList = () => (
    <nav aria-label="Workspace Navigation" className="px-3 py-4 space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeSection;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              onSelectSection(item.id);
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              active
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden={true} />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:bg-slate-900 focus:text-white focus:rounded-lg focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside
        aria-label="Workspace sidebar"
        className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200"
      >
        <div className="h-16 px-5 border-b border-slate-200 flex items-center">
          <span className="text-base font-semibold tracking-tight text-slate-900 whitespace-nowrap truncate">
            Civic Air Quality Studio
          </span>
        </div>

        <div className="px-4 py-3 border-b border-slate-200">
          <label
            htmlFor="org-switcher"
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            Active Organization
          </label>
          <div className="relative">
            <select
              id="org-switcher"
              value={activeMembership.organizationId}
              onChange={(e) => onSwitchOrg(Number(e.target.value))}
              className="w-full appearance-none bg-slate-50 border border-slate-300 rounded-lg pl-3 pr-8 py-1.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {user.memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationName}
                </option>
              ))}
            </select>
            <ChevronDown
              className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{activeMembership.role.replace(/_/g, ' ')}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{activeMembership.defaultAqiStandard}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">{renderNavList()}</div>

        <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-900 truncate">{user.fullName}</div>
            <div className="text-xs text-slate-600 truncate">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign Out"
            aria-label="Sign Out"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Workspace navigation menu"
          className="fixed inset-0 z-50 lg:hidden flex"
        >
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-slate-900/40"
            onClick={closeMobileDrawer}
          />
          <div className="relative w-72 max-w-full bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-base font-semibold text-slate-900">
                Civic Air Quality Studio
              </span>
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={closeMobileDrawer}
                aria-label="Close navigation menu"
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderNavList()}</div>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-600 truncate hidden sm:inline">
                {activeMembership.organizationName}
              </span>
              <span className="text-slate-500 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 whitespace-nowrap truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={!canWrite}
              title={
                canWrite
                  ? 'Upload or paste a dataset'
                  : 'Read-only viewer role cannot upload datasets'
              }
              onClick={() => onSelectSection('upload')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Upload Dataset
            </button>
          </div>
        </header>

        <div aria-live="polite" className="sr-only">
          {liveStatusMessage || ''}
        </div>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-6 lg:px-8 py-8 max-w-[1360px] w-full mx-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
};

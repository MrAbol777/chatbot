import { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import Icon from './components/Icon';
import { fetchAdminIdentity } from './noa/noa.service';
import type { AdminIdentity, AdminRole, AdminTab } from './admin/admin.types';
import {
  ROLE_ALLOWED_TABS,
  TAB_DESCRIPTIONS,
  TAB_GROUPS,
  TAB_ICONS,
  TAB_LABELS
} from './admin/admin.types';

// Sub-components
import DashboardTab from './admin/dashboard/DashboardTab';
import UsersTab from './admin/users/UsersTab';
import BroadcastMessagesTab from './admin/broadcast-messages/BroadcastMessagesTab';
import ModerationTab from './admin/moderation/ModerationTab';
import ImageGenerationsTab from './admin/images/ImageGenerationsTab';
import VideoGenerationsAdmin from './admin/video-generations/VideoGenerationsAdmin';
import NoaFinanceAdmin from './admin/noa/NoaFinanceAdmin';
import AiProviderManagement from './admin/ai-routing/AiProviderManagement';
import VideoPromptProfilesAdmin from './admin/video-prompt-profiles/VideoPromptProfilesAdmin';
import ErrorsTab from './admin/errors/ErrorsTab';
import SiteSettingsTab from './admin/settings/SiteSettingsTab';
import SupervisedOtpTab from './admin/supervised-otp/SupervisedOtpTab';
import ConfigTab from './admin/config/ConfigTab';
import AuditTab from './admin/audit/AuditTab';
import './admin/AdminPanel.css';

const ROLE_DISPLAY_NAMES: Record<AdminRole, string> = {
  superadmin: 'مدیر ارشد سامانه (Superadmin)',
  admin: 'مدیر کل (Admin)',
  finance: 'مدیر مالی (Finance)',
  moderator: 'ناظر ایمنی و محتوا (Moderator)',
  developer: 'توسعه‌دهنده هوش مصنوعی (DevOps)',
  support: 'پشتیبان سیستم (Support)'
};

export default function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>('dashboard');
  const [adminIdentity, setAdminIdentity] = useState<AdminIdentity | null>(null);
  const [selectedReportUserIds, setSelectedReportUserIds] = useState<string[]>([]);
  const sectionHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchAdminIdentity()
      .then((identity) => {
        if (mounted) {
          setAdminIdentity(identity);
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      mounted = false;
    };
  }, []);

  const role = (adminIdentity?.role?.toLowerCase() || 'admin') as AdminRole;
  const allowedTabs = useMemo(() => {
    return ROLE_ALLOWED_TABS[role] || ROLE_ALLOWED_TABS.admin;
  }, [role]);

  const visibleTabGroups = useMemo(() => {
    return TAB_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) => allowedTabs.includes(item))
    })).filter((group) => group.items.length > 0);
  }, [allowedTabs]);

  useEffect(() => {
    if (!allowedTabs.includes(tab)) {
      setTab(allowedTabs[0] || 'dashboard');
    }
  }, [allowedTabs, tab]);

  const changeTab = (nextTab: AdminTab) => {
    setTab(nextTab);
    setTimeout(() => {
      sectionHeadingRef.current?.focus();
    }, 0);
  };

  return (
    <div className="admin-panel" dir="rtl">
      <a className="admin-skip-link" href="#admin-main-content">
        پرش به محتوای اصلی
      </a>
      <div className="admin-shell">
        <aside className="admin-sidebar" aria-label="ناوبری پنل مدیریت">
          <div className="admin-sidebar__brand">
            <span className="admin-sidebar__mark" aria-hidden="true">
              <Icon name="shield" size={22} />
            </span>
            <span>
              <strong>دانوآ</strong>
              <small>مرکز مدیریت و کنترل هوش مصنوعی</small>
            </span>
          </div>

          {adminIdentity ? (
            <div style={{ margin: '8px 12px 16px 12px', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>{adminIdentity.username}</div>
              <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '2px' }}>
                {ROLE_DISPLAY_NAMES[role] || role}
              </div>
            </div>
          ) : null}

          <nav className="admin-sidebar__nav" aria-label="بخش‌های مدیریتی">
            {visibleTabGroups.map((group) => (
              <div className="admin-nav-group" key={group.label}>
                <span className="admin-nav-group__label">{group.label}</span>
                <div className="admin-nav-group__items">
                  {group.items.map((item) => {
                    const isActive = tab === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        className={`admin-nav-button ${isActive ? 'is-active' : ''}`}
                        aria-label={TAB_LABELS[item]}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => changeTab(item)}
                      >
                        <span className="admin-nav-button__icon" aria-hidden="true">
                          <Icon name={TAB_ICONS[item]} size={19} />
                        </span>
                        <span className="admin-nav-button__copy">
                          <strong>{TAB_LABELS[item]}</strong>
                          <small>{TAB_DESCRIPTIONS[item]}</small>
                        </span>
                        <Icon className="admin-nav-button__chevron" name="chevron-left" size={16} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="admin-sidebar__footer">
            <Icon name="shield" size={17} aria-hidden="true" />
            <span>کنترل دسترسی هوشمند (RBAC)</span>
          </div>
        </aside>

        <main className="admin-main" id="admin-main-content">
          <header className="admin-panel__header">
            <div className="admin-panel__identity">
              <span className="admin-panel__eyebrow">مدیریت محصول و پلتفرم</span>
              <h1>پنل یکپارچه دانوآ</h1>
              <p>کنترل عملیات، امنیت کاربران و پایپ‌لاین هوش مصنوعی</p>
            </div>
            <div className="admin-panel__current">
              <span className="admin-panel__current-icon" aria-hidden="true">
                <Icon name={TAB_ICONS[tab]} size={21} />
              </span>
              <div>
                <small>بخش فعال</small>
                <h2 id="admin-current-section" ref={sectionHeadingRef} tabIndex={-1}>
                  {TAB_LABELS[tab]}
                </h2>
                <p>{TAB_DESCRIPTIONS[tab]}</p>
              </div>
            </div>
          </header>

          <section className="admin-content" aria-labelledby="admin-current-section">
            {tab === 'dashboard' ? <DashboardTab onNavigate={changeTab} /> : null}

            {tab === 'users' ? (
              <UsersTab
                adminIdentity={adminIdentity}
                selectedReportUserIds={selectedReportUserIds}
                onSelectedReportUserIdsChange={setSelectedReportUserIds}
              />
            ) : null}

            {tab === 'broadcastMessages' ? <BroadcastMessagesTab /> : null}

            {tab === 'moderation' ? (
              <ModerationTab adminIdentity={adminIdentity} />
            ) : null}

            {tab === 'imageGenerations' ? <ImageGenerationsTab /> : null}

            {tab === 'videoGenerations' ? <VideoGenerationsAdmin /> : null}

            {tab === 'noaFinance' ? <NoaFinanceAdmin /> : null}

            {tab === 'aiRouting' ? <AiProviderManagement /> : null}

            {tab === 'videoPromptProfiles' ? <VideoPromptProfilesAdmin /> : null}

            {tab === 'errors' ? <ErrorsTab /> : null}

            {tab === 'siteSettings' ? <SiteSettingsTab adminIdentity={adminIdentity} /> : null}

            {tab === 'supervisedOtp' ? <SupervisedOtpTab adminIdentity={adminIdentity} /> : null}

            {tab === 'config' ? <ConfigTab adminIdentity={adminIdentity} /> : null}

            {tab === 'audit' ? (
              <AuditTab
                selectedReportUserIds={selectedReportUserIds}
                onClearSelectedReportUsers={() => setSelectedReportUserIds([])}
              />
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}

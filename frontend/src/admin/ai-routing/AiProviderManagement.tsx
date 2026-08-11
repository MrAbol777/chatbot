import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, InlineMessage, useNotification } from '../../design-system/components';
import './AiProviderManagement.css';

type Provider = { providerKey: string; displayName: string; enabled: boolean; keyConfigured: boolean; maxConcurrency: number | null; dailyCostLimit: number | null; readiness: string; version: number };
type Model = { internalKey: string; providerKey: string; providerModelId: string; displayNameFa: string; active: boolean; public: boolean; capabilities: { textToVideo: boolean; imageToVideo: boolean; negativePrompt: boolean; audio: boolean }; version: number };
type Destination = { providerKey: string; modelKey: string } | null;
type Route = { routeId: string; capability: string; primary: Destination; fallback: Destination; policy: 'PRIMARY_ONLY' | 'AUTO_FALLBACK' | 'FALLBACK_ONLY'; enabled: boolean; maxConcurrency: number | null; dailyCostLimit: number | null; version: number };
type Health = { providerKey: string; capability: string; circuitState: string; consecutiveFailures: number; retryAfter: string | null; averageLatencyMs: number | null; successCount: number; failureCount: number; version: number };
type Attempt = { attemptId: string; jobId: string; capability: string; providerKey: string; modelKey: string; attemptNumber: number; state: string; providerTaskIdMasked: string | null; jobStatus: string; safeErrorSummary: string | null; version: number; createdAt: string };
type Metric = { providerKey: string; capability: string; attempts: number; successes: number; failures: number; averageLatencyMs: number | null; actualCost: number | null; costCurrency: string | null };
type Audit = { id: number; capability: string; changedBy: string; reason: string; createdAt: string };
type InternalTab = 'routes' | 'providers' | 'models' | 'health' | 'cost' | 'audit';

const TABS: Array<{ key: InternalTab; label: string }> = [
  { key: 'routes', label: 'مسیرها' }, { key: 'providers', label: 'ارائه‌دهندگان' }, { key: 'models', label: 'مدل‌ها' },
  { key: 'health', label: 'سلامت' }, { key: 'cost', label: 'هزینه و مصرف' }, { key: 'audit', label: 'ممیزی' }
];
const POLICY_LABELS = { PRIMARY_ONLY: 'فقط مسیر اصلی', AUTO_FALLBACK: 'جایگزینی خودکار', FALLBACK_ONLY: 'فقط مسیر جایگزین' } as const;
const capabilityLabel = (value: string) => value === 'video.text_to_video' ? 'متن به ویدیو' : value === 'video.image_to_video' ? 'تصویر به ویدیو' : value;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/ai-routing${path}`, { credentials: 'include', cache: 'no-store', ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || body?.error || 'عملیات ناموفق بود.');
  return body as T;
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="ai-routing-reason"><span>دلیل تغییر</span><input value={value} onChange={(event) => onChange(event.target.value)} minLength={5} maxLength={500} placeholder="دلیل قابل پیگیری را وارد کنید" /></label>;
}

export default function AiProviderManagement() {
  const { confirm, prompt } = useNotification();
  const [tab, setTab] = useState<InternalTab>('routes');
  const [providers, setProviders] = useState<Provider[]>([]); const [models, setModels] = useState<Model[]>([]); const [routes, setRoutes] = useState<Route[]>([]);
  const [health, setHealth] = useState<Health[]>([]); const [attempts, setAttempts] = useState<Attempt[]>([]); const [metrics, setMetrics] = useState<Metric[]>([]); const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [reasons, setReasons] = useState<Record<string, string>>({});
  const setReason = (key: string, value: string) => setReasons((current) => ({ ...current, [key]: value }));
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [providerData, modelData, routeData, healthData, attemptData, metricData, auditData] = await Promise.all([
        api<{ items: Provider[] }>('/providers'), api<{ items: Model[] }>('/models'), api<{ items: Route[] }>('/routes'),
        api<{ items: Health[] }>('/health'), api<{ items: Attempt[] }>('/attempts?state=ambiguous'), api<{ items: Metric[] }>('/metrics'), api<{ items: Audit[] }>('/audit')
      ]);
      setProviders(providerData.items); setModels(modelData.items); setRoutes(routeData.items); setHealth(healthData.items); setAttempts(attemptData.items); setMetrics(metricData.items); setAudits(auditData.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'دریافت تنظیمات ناموفق بود.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const modelsByProvider = useMemo(() => new Map(providers.map((provider) => [provider.providerKey, models.filter((model) => model.providerKey === provider.providerKey)])), [models, providers]);
  const success = (text: string) => { setMessage(text); setError(''); void load(); };
  const mutate = async (path: string, method: 'PATCH' | 'POST', body: object, confirmation?: string) => {
    if (confirmation && !(await confirm({ message: confirmation, confirmText: 'ثبت', cancelText: 'انصراف' }))) return;
    setMessage(''); setError('');
    try { await api(path, { method, body: JSON.stringify(body) }); success('تغییر با موفقیت ثبت و ممیزی شد.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ثبت تغییر ناموفق بود.'); }
  };
  const recoverAttempt = async (attempt: Attempt) => {
    const reason = reasons[attempt.attemptId] || '';
    if (reason.trim().length < 5) return;
    const taskId = (await prompt({ message: 'Task ID بازیابی‌شده را وارد کنید', confirmText: 'اتصال', cancelText: 'انصراف' })) ?? '';
    if (!taskId) return;
    void mutate(`/attempts/${attempt.attemptId}/recovery`, 'POST', { expectedVersion: attempt.version, reason, action: 'ATTACH_TASK_ID', providerTaskId: taskId }, 'Task ID بدون فراخوانی Provider متصل شود؟');
  };

  return <section className="ai-routing-admin" dir="rtl" aria-labelledby="ai-routing-title">
    <header className="ai-routing-admin__header"><div><p>AI ROUTING</p><h2 id="ai-routing-title">مدیریت ارائه‌دهندگان هوش مصنوعی</h2><span>مسیرهای ویدیو، سلامت، هزینه و Recovery کنترل‌شده</span></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>به‌روزرسانی</Button></header>
    <nav className="ai-routing-tabs" role="tablist" aria-label="بخش‌های مدیریت ارائه‌دهندگان">{TABS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav>
    {message ? <InlineMessage variant="success" text={message} /> : null}{error ? <InlineMessage variant="error" text={error} /> : null}{loading ? <p role="status" className="ai-routing-loading">در حال دریافت اطلاعات…</p> : null}

    {!loading && tab === 'routes' ? <div className="ai-routing-grid">{routes.map((route) => {
      const primaryModels = modelsByProvider.get(route.primary?.providerKey || '') || []; const fallbackModels = modelsByProvider.get(route.fallback?.providerKey || '') || [];
      return <article className="ai-routing-card" key={route.routeId}><div className="ai-routing-card__title"><div><h3>{capabilityLabel(route.capability)}</h3><code>v{route.version}</code></div><label className="ai-routing-switch"><input type="checkbox" checked={route.enabled} onChange={(event) => setRoutes((items) => items.map((item) => item.routeId === route.routeId ? { ...item, enabled: event.target.checked } : item))} /><span>فعال</span></label></div>
        <div className="ai-routing-fields"><label><span>Policy</span><select value={route.policy} onChange={(event) => setRoutes((items) => items.map((item) => item.routeId === route.routeId ? { ...item, policy: event.target.value as Route['policy'] } : item))}>{Object.entries(POLICY_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label><span>Provider اصلی</span><select value={route.primary?.providerKey || ''} onChange={(event) => setRoutes((items) => items.map((item) => item.routeId === route.routeId ? { ...item, primary: event.target.value ? { providerKey: event.target.value, modelKey: '' } : null } : item))}><option value="">بدون مقصد</option>{providers.map((provider) => <option key={provider.providerKey} value={provider.providerKey}>{provider.displayName}</option>)}</select></label>
          <label><span>مدل اصلی</span><select value={route.primary?.modelKey || ''} disabled={!route.primary} onChange={(event) => setRoutes((items) => items.map((item) => item.routeId === route.routeId && item.primary ? { ...item, primary: { ...item.primary, modelKey: event.target.value } } : item))}><option value="">انتخاب مدل</option>{primaryModels.map((model) => <option key={model.internalKey} value={model.internalKey}>{model.displayNameFa}</option>)}</select></label>
          <label><span>Provider جایگزین</span><select value={route.fallback?.providerKey || ''} onChange={(event) => setRoutes((items) => items.map((item) => item.routeId === route.routeId ? { ...item, fallback: event.target.value ? { providerKey: event.target.value, modelKey: '' } : null } : item))}><option value="">بدون مقصد</option>{providers.map((provider) => <option key={provider.providerKey} value={provider.providerKey}>{provider.displayName}</option>)}</select></label>
          <label><span>مدل جایگزین</span><select value={route.fallback?.modelKey || ''} disabled={!route.fallback} onChange={(event) => setRoutes((items) => items.map((item) => item.routeId === route.routeId && item.fallback ? { ...item, fallback: { ...item.fallback, modelKey: event.target.value } } : item))}><option value="">انتخاب مدل</option>{fallbackModels.map((model) => <option key={model.internalKey} value={model.internalKey}>{model.displayNameFa}</option>)}</select></label></div>
        {route.policy === 'AUTO_FALLBACK' ? <p className="ai-routing-warning">Fallback فقط پیش از Submit یا پس از رد قطعی بدون Task ID مجاز است؛ Timeout و پاسخ مبهم هرگز Fallback نمی‌شوند.</p> : null}
        <ReasonField value={reasons[route.routeId] || ''} onChange={(value) => setReason(route.routeId, value)} /><Button disabled={(reasons[route.routeId] || '').trim().length < 5} onClick={() => void mutate(`/routes/${encodeURIComponent(route.capability)}`, 'PATCH', { expectedVersion: route.version, reason: reasons[route.routeId], enabled: route.enabled, policy: route.policy, primaryProviderKey: route.primary?.providerKey || null, primaryModelKey: route.primary?.modelKey || null, fallbackProviderKey: route.fallback?.providerKey || null, fallbackModelKey: route.fallback?.modelKey || null }, 'تغییر Route روی Jobهای جدید اثر می‌گذارد. ادامه می‌دهید؟')}>ثبت Route</Button>
      </article>;
    })}</div> : null}

    {!loading && tab === 'providers' ? <div className="ai-routing-grid">{providers.map((provider) => <article className="ai-routing-card" key={provider.providerKey}><div className="ai-routing-card__title"><div><h3>{provider.displayName}</h3><code>{provider.providerKey}</code></div><span className={`ai-routing-badge ${provider.keyConfigured ? 'is-ok' : 'is-blocked'}`}>{provider.keyConfigured ? 'کلید تنظیم شده' : 'کلید تنظیم نشده'}</span></div><p>Readiness: {provider.readiness}</p><label className="ai-routing-switch"><input type="checkbox" checked={provider.enabled} onChange={(event) => setProviders((items) => items.map((item) => item.providerKey === provider.providerKey ? { ...item, enabled: event.target.checked } : item))} /><span>Provider فعال باشد</span></label><ReasonField value={reasons[provider.providerKey] || ''} onChange={(value) => setReason(provider.providerKey, value)} /><Button disabled={(reasons[provider.providerKey] || '').trim().length < 5} onClick={() => void mutate(`/providers/${provider.providerKey}`, 'PATCH', { expectedVersion: provider.version, reason: reasons[provider.providerKey], enabled: provider.enabled })}>ثبت وضعیت</Button></article>)}</div> : null}

    {!loading && tab === 'models' ? <div className="ai-routing-table-wrap"><table><thead><tr><th>مدل</th><th>Provider</th><th>قابلیت‌ها</th><th>فعال / عمومی</th><th>دلیل و اقدام</th></tr></thead><tbody>{models.map((model) => <tr key={model.internalKey}><td><strong>{model.displayNameFa}</strong><code>{model.providerModelId}</code></td><td>{model.providerKey}</td><td>{[model.capabilities.textToVideo&&'T2V',model.capabilities.imageToVideo&&'I2V',model.capabilities.audio&&'Audio'].filter(Boolean).join(' · ')}</td><td><label><input type="checkbox" checked={model.active} onChange={(event) => setModels((items) => items.map((item) => item.internalKey===model.internalKey?{...item,active:event.target.checked}:item))} /> فعال</label><label><input type="checkbox" checked={model.public} onChange={(event) => setModels((items) => items.map((item) => item.internalKey===model.internalKey?{...item,public:event.target.checked}:item))} /> عمومی</label></td><td><ReasonField value={reasons[model.internalKey] || ''} onChange={(value) => setReason(model.internalKey,value)} /><Button disabled={(reasons[model.internalKey]||'').trim().length<5} onClick={() => void mutate(`/models/${model.internalKey}`,'PATCH',{expectedVersion:model.version,reason:reasons[model.internalKey],active:model.active,public:model.public})}>ثبت</Button></td></tr>)}</tbody></table></div> : null}

      {!loading && tab === 'health' ? <div className="ai-routing-stack"><div className="ai-routing-table-wrap"><table><thead><tr><th>Provider</th><th>قابلیت</th><th>Circuit</th><th>موفق / خطا</th><th>Latency</th><th>Reset</th></tr></thead><tbody>{health.map((item) => <tr key={`${item.providerKey}-${item.capability}`}><td>{item.providerKey}</td><td>{capabilityLabel(item.capability)}</td><td><span className={`ai-routing-badge ${item.circuitState==='CLOSED'?'is-ok':'is-blocked'}`}>{item.circuitState}</span></td><td>{item.successCount} / {item.failureCount}</td><td>{item.averageLatencyMs == null?'—':`${Math.round(item.averageLatencyMs)} ms`}</td><td><ReasonField value={reasons[`health-${item.providerKey}-${item.capability}`]||''} onChange={(value)=>setReason(`health-${item.providerKey}-${item.capability}`,value)} /><Button variant="secondary" disabled={(reasons[`health-${item.providerKey}-${item.capability}`]||'').trim().length<5} onClick={()=>void mutate(`/health/${item.providerKey}/${encodeURIComponent(item.capability)}/reset`,'POST',{expectedVersion:item.version,reason:reasons[`health-${item.providerKey}-${item.capability}`]})}>Reset</Button></td></tr>)}</tbody></table></div><section><h3>Jobهای با وضعیت نامعلوم</h3>{attempts.length ? <div className="ai-routing-grid">{attempts.map((attempt)=><article className="ai-routing-card" key={attempt.attemptId}><strong>{attempt.providerKey} · تلاش {attempt.attemptNumber}</strong><p>{attempt.safeErrorSummary || 'نیازمند بررسی مستند مدیر'}</p><small>Task: {attempt.providerTaskIdMasked || 'ثبت نشده'}</small><ReasonField value={reasons[attempt.attemptId]||''} onChange={(value)=>setReason(attempt.attemptId,value)} /><div className="ai-routing-actions"><Button disabled={(reasons[attempt.attemptId]||'').trim().length<5} onClick={() => void recoverAttempt(attempt)}>اتصال Task ID</Button><Button variant="secondary" disabled={(reasons[attempt.attemptId]||'').trim().length<5} onClick={()=>void mutate(`/attempts/${attempt.attemptId}/recovery`,'POST',{expectedVersion:attempt.version,reason:reasons[attempt.attemptId],action:'CONFIRM_NOT_ACCEPTED'},'فقط با مدرک عدم پذیرش ادامه دهید. Fallback فعال شود؟')}>تأیید عدم پذیرش</Button><Button variant="danger" disabled={(reasons[attempt.attemptId]||'').trim().length<5} onClick={()=>void mutate(`/attempts/${attempt.attemptId}/recovery`,'POST',{expectedVersion:attempt.version,reason:reasons[attempt.attemptId],action:'FAIL_RELEASE'},'Job شکست بخورد و رزرو نوآ آزاد شود؟')}>Fail و Release</Button></div></article>)}</div>:<p>مورد نامعلومی وجود ندارد.</p>}</section></div> : null}

    {!loading && tab === 'cost' ? <div className="ai-routing-table-wrap"><table><thead><tr><th>Provider</th><th>قابلیت</th><th>Attempt</th><th>موفق</th><th>خطا/مبهم</th><th>میانگین Latency</th><th>هزینه واقعی</th></tr></thead><tbody>{metrics.map((item)=><tr key={`${item.providerKey}-${item.capability}-${item.costCurrency}`}><td>{item.providerKey}</td><td>{capabilityLabel(item.capability)}</td><td>{item.attempts}</td><td>{item.successes}</td><td>{item.failures}</td><td>{item.averageLatencyMs==null?'—':`${Math.round(item.averageLatencyMs)} ms`}</td><td>{item.actualCost==null?'نامشخص':`${item.actualCost} ${item.costCurrency||''}`}</td></tr>)}</tbody></table></div> : null}
    {!loading && tab === 'audit' ? <div className="ai-routing-table-wrap"><table><thead><tr><th>زمان</th><th>قابلیت</th><th>مدیر</th><th>دلیل</th></tr></thead><tbody>{audits.map((item)=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('fa-IR')}</td><td>{capabilityLabel(item.capability)}</td><td>{item.changedBy}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : null}
  </section>;
}

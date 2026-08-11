import Icon from '../components/Icon';
import type { VideoPromptProfile } from './video-generation.types';

type Props = { profiles: VideoPromptProfile[]; selectedKey: string; onSelect: (key: string) => void; onContinue: () => void };

export default function VideoStyleSelection({ profiles, selectedKey, onSelect, onContinue }: Props) {
  return <section className="video-style-step" aria-labelledby="video-style-heading">
    <div className="video-style-step__heading"><span>مرحله ۱ از ۳</span><h2 id="video-style-heading">سبک ویدیوت را انتخاب کن</h2><p>سبک، قواعد حفظ هویت و نوع حرکت را تعیین می‌کند؛ تصویر اصلی دوباره طراحی نمی‌شود.</p></div>
    <div className="video-style-grid" role="radiogroup" aria-label="سبک ساخت ویدیو">{profiles.map((profile) => {
      const selected = selectedKey === profile.profileKey;
      return <button key={profile.profileKey} type="button" role="radio" aria-checked={selected} aria-label={`انتخاب سبک ${profile.displayName}`} className={`video-style-card ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(profile.profileKey)}>
        <span className={`video-style-card__visual video-style-card__visual--${profile.profileKey}`} aria-hidden="true"><Icon name="sparkle" size="1.4em" /></span>
        <span className="video-style-card__copy"><strong>{profile.displayName}</strong><small>{profile.publicDescription}</small></span>
        <span className="video-style-card__check" aria-hidden="true">{selected ? <Icon name="check" size="1em" /> : null}</span>
      </button>;
    })}</div>
    <div className="video-style-step__action"><button type="button" disabled={!selectedKey} onClick={onContinue}>ادامه با این سبک</button></div>
  </section>;
}

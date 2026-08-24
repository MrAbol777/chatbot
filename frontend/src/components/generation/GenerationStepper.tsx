import type { CSSProperties } from 'react';
import './GenerationStepper.css';

export type GenerationStepperState = 'active' | 'success' | 'error' | 'warning';

export type GenerationStep = {
  id: string;
  label: string;
};

type Props = {
  steps: readonly GenerationStep[];
  currentStep: number;
  state?: GenerationStepperState;
  ariaLabel?: string;
  compact?: boolean;
  className?: string;
};

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
}

function ErrorIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 7v6m0 4h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3l-7.5-13.2a2 2 0 0 0-3.4 0Z" /></svg>;
}

export default function GenerationStepper({ steps, currentStep, state = 'active', ariaLabel = 'وضعیت ساخت', compact = false, className = '' }: Props) {
  const safeCurrentStep = Math.min(Math.max(currentStep, 0), Math.max(steps.length - 1, 0));
  const classes = ['generation-stepper', compact ? 'generation-stepper--compact' : '', className].filter(Boolean).join(' ');

  return <ol
    className={classes}
    aria-label={ariaLabel}
    style={{ '--generation-step-count': steps.length } as CSSProperties}
  >
    {steps.map((step, index) => {
      const isCurrent = index === safeCurrentStep;
      const isComplete = state === 'success' ? index <= safeCurrentStep : index < safeCurrentStep;
      const isError = isCurrent && state === 'error';
      const indicator = isError ? <ErrorIcon /> : isComplete ? <CheckIcon /> : <span aria-hidden="true">{index + 1}</span>;
      return <li
        key={step.id}
        className={`generation-step generation-step--${isError ? 'error' : isComplete ? 'complete' : isCurrent ? state : 'upcoming'}`}
        aria-current={isCurrent ? 'step' : undefined}
      >
        <span className="generation-step__indicator">{indicator}</span>
        <span className="generation-step__label">{step.label}</span>
        {index < steps.length - 1 ? <span className={`generation-step__connector${index < safeCurrentStep ? ' is-complete' : ''}`} aria-hidden="true" /> : null}
      </li>;
    })}
  </ol>;
}

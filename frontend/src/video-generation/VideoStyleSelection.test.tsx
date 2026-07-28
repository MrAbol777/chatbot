import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { videoOptions } from '../test/fixtures/video-generation';
import VideoStyleSelection from './VideoStyleSelection';

describe('VideoStyleSelection',()=>{
  it('renders exactly the two public style cards without provider or model names',()=>{render(<VideoStyleSelection profiles={videoOptions.promptProfiles} selectedKey="" onSelect={vi.fn()} onContinue={vi.fn()}/>);expect(screen.getAllByRole('radio')).toHaveLength(2);expect(screen.getByRole('radio',{name:/واقعی و سینمایی/})).toBeInTheDocument();expect(screen.getByRole('radio',{name:/انیمیشنی/})).toBeInTheDocument();expect(screen.queryByText(/bananaai|metis|grok|model|مدل/i)).not.toBeInTheDocument();});
  it('supports keyboard selection and requires a selected style to continue',async()=>{const user=userEvent.setup();const onSelect=vi.fn();const onContinue=vi.fn();const {rerender}=render(<VideoStyleSelection profiles={videoOptions.promptProfiles} selectedKey="" onSelect={onSelect} onContinue={onContinue}/>);const card=screen.getByRole('radio',{name:/واقعی و سینمایی/});card.focus();await user.keyboard('{Enter}');expect(onSelect).toHaveBeenCalledWith('cinematic');expect(screen.getByRole('button',{name:'ادامه با این سبک'})).toBeDisabled();rerender(<VideoStyleSelection profiles={videoOptions.promptProfiles} selectedKey="cinematic" onSelect={onSelect} onContinue={onContinue}/>);expect(screen.getByRole('radio',{name:/واقعی و سینمایی/})).toHaveAttribute('aria-checked','true');await user.click(screen.getByRole('button',{name:'ادامه با این سبک'}));expect(onContinue).toHaveBeenCalledOnce();});
});


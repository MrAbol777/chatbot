import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPromptProfilesAdmin from './VideoPromptProfilesAdmin';
import { ToastProvider } from '../../design-system/components';

const profile={id:'profile-1',profileKey:'cinematic',displayName:'واقعی و سینمایی',publicDescription:'عمومی',visualKey:'cinematic-frame',active:true,public:true,displayOrder:10,currentVersionId:'version-1',currentVersion:1,checksum:'a'.repeat(64),version:1,baseSystemPrompt:'متن کامل مرجع',executionTemplate:'execution template',rulesManifest:{styleProfile:'style',nonNegotiableRules:['identity'],directingDecisions:['slow'],outputQuality:['stable']}};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

describe('VideoPromptProfilesAdmin',()=>{
  beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.endsWith('/audit'))return json({items:[]});if(url.endsWith('/versions'))return json({items:[{id:'version-1',version:1,checksum:'a'.repeat(64),createdByAdminId:null,changeReason:'seed',createdAt:'2026-07-23T00:00:00Z',jobCount:2}]});if(url.endsWith('/compile-preview'))return json({profileKey:'cinematic',profileVersion:1,compilerVersion:'1',userPrompt:'حرکت آرام',compiledPrompt:'[[NON-NEGOTIABLE RULES]]\nidentity',compiledPromptHash:'b'.repeat(64)});return json({items:[profile]});}));});
  it('shows full prompt only in the authorized Admin feature and lists immutable versions',async()=>{render(<ToastProvider><VideoPromptProfilesAdmin/></ToastProvider>);expect(await screen.findByDisplayValue('متن کامل مرجع')).toBeInTheDocument();expect(await screen.findByText('2')).toBeInTheDocument();expect(screen.getByText(/Version جدید/)).toBeInTheDocument();});
  it('previews compilation locally through the Admin endpoint',async()=>{const user=userEvent.setup();render(<ToastProvider><VideoPromptProfilesAdmin/></ToastProvider>);await screen.findByDisplayValue('متن کامل مرجع');await user.click(screen.getByRole('button',{name:'Compile بدون Provider'}));await waitFor(()=>expect(screen.getByText('[[NON-NEGOTIABLE RULES]] identity')).toBeInTheDocument());const serialized=document.body.textContent||'';expect(serialized).not.toMatch(/api key|bearer|provider task/i);});
});


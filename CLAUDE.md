# Boost My Businesses AI — Project Context

## Project Overview
Premium AI workspace SaaS to automate business growth, content creation, and lead management using multi-agent systems.

## Stack
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS — deployed on Vercel
- **Backend:** n8n (automation & orchestration) — hosted on VPS via Coolify
- **Database:** Supabase (storage, logs, memory)
- **Architecture:** User → Frontend → API → n8n → AI Agents → Supabase → Response

## Core Products
1. **UGC Ads Engine** (`/app/agent/ugc-ads-engine`) — Generate marketing content & videos from prompts with approval workflows
2. **WhatsApp Lead System** (`/app/agent/whatsapp-lead-system`) — Automate lead qualification, responses, and routing
3. **Personal AI Swarm** — Multi-agent system orchestrating specialized AI agents

## Current Priorities (Next Steps)
- [ ] Add authentication (Supabase Auth)
- [ ] Improve UX
- [ ] Implement monitoring
- [ ] Enhance security

## Code Conventions
- TypeScript strict mode
- Tailwind for all styling
- App Router file structure (`app/agent/[module]/page.tsx`)
- Components in `/components`

## Business Model
- UGC Ads for content creators
- WhatsApp AI for businesses
- Custom AI automation for clients

## AI Agent Prompt Structure (Mandatory)
All AI agents must follow this structure:

ROLE: Define expert identity
TASK: Clear, single, unambiguous instruction  
CONTEXT: Only necessary information
RULES:
- Be concise
- Follow instructions strictly
- No hallucination
- Respect constraints (tone, length, format)
FEW-SHOT (MANDATORY - min 2 examples):
  Example 1: Input: ... / Output: ...
  Example 2: Input: ... / Output: ...
OUTPUT: Define exact format (JSON, bullets, plain text...)

### Key Principles
- Clarity beats complexity
- Show examples instead of describing expectations
- 1-2 strong examples > many weak ones
- Aim for correct output in one shot
- Always control the output format
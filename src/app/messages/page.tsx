'use client';
import type { ReactElement } from 'react';
import { AppShell } from '@/components/app/AppShell';
import { MessageWorkspace } from '@/components/courses/MessageWorkspace';
export default function MessagesPage(): ReactElement { return <AppShell title="消息"><MessageWorkspace /></AppShell>; }

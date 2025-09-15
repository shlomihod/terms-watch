'use client';

import { ReactNode } from 'react';
import { ScrollProvider } from '@/app/contexts/scroll-context';
import { SmartFooter } from '@/app/components/smart-footer';

export function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <ScrollProvider>
      {children}
      <SmartFooter />
    </ScrollProvider>
  );
}
'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface ScrollContextType {
  hasPassedFirstLoad: boolean;
  setHasPassedFirstLoad: (value: boolean) => void;
}

const ScrollContext = createContext<ScrollContextType | undefined>(undefined);

export function ScrollProvider({ children }: { children: ReactNode }) {
  const [hasPassedFirstLoad, setHasPassedFirstLoad] = useState(false);

  return (
    <ScrollContext.Provider value={{ hasPassedFirstLoad, setHasPassedFirstLoad }}>
      {children}
    </ScrollContext.Provider>
  );
}

export function useScrollContext() {
  const context = useContext(ScrollContext);
  if (!context) {
    throw new Error('useScrollContext must be used within ScrollProvider');
  }
  return context;
}
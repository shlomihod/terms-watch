'use client';

import { useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { useScrollContext } from '@/app/contexts/scroll-context';

export function SmartFooter() {
  const [isVisible, setIsVisible] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [hasShownOnce, setHasShownOnce] = useState(false);
  const { hasPassedFirstLoad } = useScrollContext();

  useEffect(() => {
    const handleScroll = () => {
      // Don't show footer until first load point is passed
      if (!hasPassedFirstLoad) {
        setIsVisible(false);
        return;
      }

      const currentScrollY = window.scrollY;

      // Scrolling direction
      const scrollingDown = currentScrollY > lastScrollY;
      const scrollingUp = currentScrollY < lastScrollY;

      // If footer has been shown once, show on any scroll down, hide on scroll up
      if (hasShownOnce) {
        if (scrollingDown) {
          setIsVisible(true);
        } else if (scrollingUp) {
          setIsVisible(false);
        }
      } else {
        // First time: only show when near bottom
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const nearBottom = currentScrollY + windowHeight >= documentHeight - 200;

        if (nearBottom) {
          setIsVisible(true);
          setHasShownOnce(true);
        }
      }

      setLastScrollY(currentScrollY);
    };

    // Check on mount and when hasPassedFirstLoad changes
    handleScroll();

    // Add scroll listener
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Cleanup
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY, hasPassedFirstLoad, hasShownOnce]);

  return (
    <footer
      className={`fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white z-50 transition-transform duration-300 ease-in-out ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between text-sm text-gray-500">
          <p>
            Made by{' '}
            <a
              href="https://shlomi.hod.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-700"
            >
              Shlomi Hod
            </a>
          </p>
          <a
            href="https://github.com/shlomihod/terms-watch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
            aria-label="View on GitHub"
          >
            <Github size={16} />
            <span>Open Source on GitHub</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
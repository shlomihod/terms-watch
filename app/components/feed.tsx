'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChangeCard } from './change-card';
import { Filters } from './filters';
import { useScrollContext } from '@/app/contexts/scroll-context';
import { PAGE_SIZE } from '@/lib/constants';

interface Change {
  id: string;
  service: string;
  category: 'social' | 'ai';
  documentType: string;
  commitDate: string;
  commitUrl: string;
  diffContent: string;
  diffSummary: string | null;
  isMinorChange?: boolean;
}

interface FeedProps {
  initialChanges: Change[];
  availableServices: string[];
  availableDocumentTypes: string[];
  scrollToCommitId?: string;
}

export function Feed({ initialChanges, availableServices, availableDocumentTypes, scrollToCommitId }: FeedProps) {
  const [changes, setChanges] = useState(initialChanges);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(initialChanges.length);
  const [filters, setFilters] = useState({
    category: 'all' as 'all' | 'social' | 'ai',
    service: '',
    documentType: '',
    includeFormattingOnly: false,
  });
  const [services, setServices] = useState(availableServices);
  const [documentTypes, setDocumentTypes] = useState(availableDocumentTypes);
  const { setHasPassedFirstLoad } = useScrollContext();

  // Ref for the sentinel element
  const observerTarget = useRef<HTMLDivElement>(null);

  // Fetch more changes with current filters
  const fetchMoreChanges = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    
    try {
      const params = new URLSearchParams();
      if (filters.category !== 'all') params.append('category', filters.category);
      if (filters.service) params.append('service', filters.service);
      if (filters.documentType) params.append('documentType', filters.documentType);
      params.append('includeFormattingOnly', filters.includeFormattingOnly.toString());
      params.append('limit', PAGE_SIZE.toString());
      params.append('offset', offset.toString());
      
      const response = await fetch(`/api/changes?${params}`);
      const data = await response.json();
      
      if (data.changes && data.changes.length > 0) {
        setChanges(prev => [...prev, ...data.changes]);
        setOffset(prev => prev + data.changes.length);
        
        // Check if we've loaded all available changes
        if (offset + data.changes.length >= data.total) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (error) {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [offset, filters, loadingMore, hasMore]);

  // Handle filter changes
  const handleFilterChange = async (newFilters: {
    category: 'all' | 'social' | 'ai';
    service: string;
    documentType: string;
    includeFormattingOnly: boolean;
  }) => {
    setLoading(true);

    // Determine what changed and reset dependent filters
    let adjustedFilters = { ...newFilters };

    if (newFilters.category !== filters.category) {
      // Category changed → reset service and documentType
      adjustedFilters = { ...newFilters, service: '', documentType: '' };
    } else if (newFilters.documentType !== filters.documentType) {
      // DocumentType changed → reset service and documentType
      adjustedFilters = { ...newFilters, service: '', documentType: '' };
    } else if (newFilters.service !== filters.service) {
      // Service changed → reset documentType only
      adjustedFilters = { ...newFilters, documentType: '' };
    }

    setFilters(adjustedFilters);
    setOffset(0);
    setHasMore(true);

    try {
      // Fetch new filter options based on the adjusted filters
      const optionsParams = new URLSearchParams();
      if (adjustedFilters.category !== 'all') {
        optionsParams.append('category', adjustedFilters.category);
      }
      if (adjustedFilters.service) {
        optionsParams.append('service', adjustedFilters.service);
      }
      if (adjustedFilters.documentType) {
        optionsParams.append('documentType', adjustedFilters.documentType);
      }

      const optionsResponse = await fetch(`/api/filter-options?${optionsParams}`);
      const optionsData = await optionsResponse.json();
      setServices(optionsData.services || []);
      setDocumentTypes(optionsData.documentTypes || []);

      // Fetch changes with the adjusted filters
      const params = new URLSearchParams();
      if (adjustedFilters.category !== 'all') params.append('category', adjustedFilters.category);
      if (adjustedFilters.service) params.append('service', adjustedFilters.service);
      if (adjustedFilters.documentType) params.append('documentType', adjustedFilters.documentType);
      params.append('includeFormattingOnly', adjustedFilters.includeFormattingOnly.toString());
      params.append('limit', PAGE_SIZE.toString());
      params.append('offset', '0');

      const response = await fetch(`/api/changes?${params}`);
      const data = await response.json();

      setChanges(data.changes || []);
      setOffset(data.changes?.length || 0);

      // Check if we have more data to load
      if ((data.changes?.length || 0) >= data.total) {
        setHasMore(false);
      }
    } catch (error) {
      setChanges([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  // Set up Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          // Mark that we've passed the first load point
          setHasPassedFirstLoad(true);
          fetchMoreChanges();
        }
      },
      { threshold: 0.1 } // Trigger when 10% visible
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [fetchMoreChanges, hasMore, loadingMore, setHasPassedFirstLoad]);

  // Check initial data to see if we need to load more
  useEffect(() => {
    // If initial load didn't fill the viewport and we might have more data
    const checkInitialLoad = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      
      // If content doesn't fill viewport and we haven't checked for more yet
      if (scrollHeight <= clientHeight + 100 && hasMore && offset === initialChanges.length) {
        fetchMoreChanges();
      }
    };
    
    // Small delay to ensure DOM is ready
    setTimeout(checkInitialLoad, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether we've already scrolled to the target commit
  const scrolledToCommit = useRef<string | null>(null);

  // Handle scrollToCommitId prop for direct links
  useEffect(() => {
    const scrollToTarget = async () => {
      if (!scrollToCommitId || scrolledToCommit.current === scrollToCommitId) return;

      // Try to find the element
      let element = document.getElementById(scrollToCommitId);
      let attempts = 0;
      const maxAttempts = 20;

      // Keep loading more content until we find the element
      while (!element && hasMore && attempts < maxAttempts) {
        await fetchMoreChanges();
        await new Promise(resolve => requestAnimationFrame(resolve));
        element = document.getElementById(scrollToCommitId);
        attempts++;
      }

      if (element) {
        scrolledToCommit.current = scrollToCommitId;
        requestAnimationFrame(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    };

    scrollToTarget();
  }, [scrollToCommitId, changes.length, fetchMoreChanges, hasMore]);

  return (
    <>
      <Filters
        services={services}
        documentTypes={documentTypes}
        onFilterChange={handleFilterChange}
        currentCategory={filters.category}
        currentService={filters.service}
        currentDocumentType={filters.documentType}
        currentIncludeFormattingOnly={filters.includeFormattingOnly}
      />
      
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="text-gray-500">Loading changes...</div>
        </div>
      ) : changes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No changes found matching your filters.
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {changes.map((change) => (
              <ChangeCard key={change.id} change={change} />
            ))}
          </div>
          
          {/* Sentinel element for intersection observer */}
          <div ref={observerTarget} className="h-4" />
          
          {loadingMore && (
            <div className="flex justify-center py-8">
              <div className="text-gray-500">Loading more changes...</div>
            </div>
          )}
          
          {!hasMore && changes.length > 0 && (
            <div className="text-center py-8 text-gray-500">
              No more changes to load.
            </div>
          )}
        </>
      )}
    </>
  );
}
'use client';

interface FiltersProps {
  onFilterChange: (filters: {
    category: 'all' | 'social' | 'ai';
    service: string;
    documentType: string;
    includeFormattingOnly: boolean;
  }) => void;
  services: string[];
  documentTypes: string[];
  currentCategory: 'all' | 'social' | 'ai';
  currentService: string;
  currentDocumentType: string;
  currentIncludeFormattingOnly: boolean;
}

export function Filters({
  onFilterChange,
  services,
  documentTypes,
  currentCategory,
  currentService,
  currentDocumentType,
  currentIncludeFormattingOnly
}: FiltersProps) {
  const handleFilterChange = (newFilters: Partial<{
    category: 'all' | 'social' | 'ai';
    service: string;
    documentType: string;
    includeFormattingOnly: boolean;
  }>) => {
    const updated = {
      category: newFilters.category ?? currentCategory,
      service: newFilters.service ?? currentService,
      documentType: newFilters.documentType ?? currentDocumentType,
      includeFormattingOnly: newFilters.includeFormattingOnly ?? currentIncludeFormattingOnly,
    };

    onFilterChange(updated);
  };

  const handleReset = () => {
    onFilterChange({
      category: 'all',
      service: '',
      documentType: '',
      includeFormattingOnly: false
    });
  };

  const hasActiveFilters = currentCategory !== 'all' || currentService !== '' || currentDocumentType !== '' || currentIncludeFormattingOnly;

  return (
    <div className="flex flex-wrap gap-4 mb-8 p-4 bg-gray-50 rounded-lg">
      <div className="flex gap-2">
        <button
          onClick={() => handleFilterChange({ category: 'all' })}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            currentCategory === 'all'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
          }`}
        >
          All
        </button>
        <button
          onClick={() => handleFilterChange({ category: 'social' })}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            currentCategory === 'social'
              ? 'bg-gray-800 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
          }`}
        >
          Social Media
        </button>
        <button
          onClick={() => handleFilterChange({ category: 'ai' })}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            currentCategory === 'ai'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
          }`}
        >
          Generative AI
        </button>
      </div>

      <select
        value={currentService}
        onChange={(e) => handleFilterChange({ service: e.target.value })}
        className="px-4 py-2 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        <option value="">All Services</option>
        {services.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={currentDocumentType}
        onChange={(e) => handleFilterChange({ documentType: e.target.value })}
        className="px-4 py-2 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        <option value="">All Document Types</option>
        {documentTypes.map((dt) => (
          <option key={dt} value={dt}>
            {dt}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors">
        <input
          type="checkbox"
          checked={currentIncludeFormattingOnly}
          onChange={(e) => handleFilterChange({ includeFormattingOnly: e.target.checked })}
          className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-900"
        />
        <span className="text-sm text-gray-700">Include minor changes</span>
      </label>

      {hasActiveFilters && (
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-100 transition-colors"
        >
          Reset Filters
        </button>
      )}
    </div>
  );
}
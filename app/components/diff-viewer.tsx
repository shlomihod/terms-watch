'use client';

interface DiffViewerProps {
  diff: string;
}

export function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff) {
    return (
      <div className="text-gray-500 text-sm p-4 bg-gray-50 rounded font-mono">
        No diff available for this change.
      </div>
    );
  }

  const lines = diff.split('\n').filter(line => 
    // Remove git artifacts
    !line.startsWith('\\ No newline at end of file')
  );
  
  return (
    <div className="bg-gray-50 rounded-lg p-4 overflow-x-auto">
      <div className="space-y-1 text-sm font-mono">
        {lines.map((line, index) => {
          // Skip technical diff headers and git artifacts
          if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
            // Add a subtle separator for sections
            if (line.startsWith('@@')) {
              return (
                <div key={index} className="my-3 border-t border-gray-200 pt-3">
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Section Change</span>
                </div>
              );
            }
            return null; // Skip --- and +++ lines
          }
          
          // Skip empty lines that aren't meaningful
          if (!line.trim() && !line.startsWith(' ')) {
            return null;
          }
          
          // Style additions and deletions
          let className = 'text-gray-700 leading-relaxed';
          let prefix = '';
          
          if (line.startsWith('+')) {
            className = 'text-green-700 bg-green-50 px-2 py-0.5 rounded';
            prefix = '+ ';
          } else if (line.startsWith('-')) {
            className = 'text-red-700 bg-red-50 px-2 py-0.5 rounded';
            prefix = '− ';
          } else if (line.trim()) {
            className = 'text-gray-600 px-2';
          }
          
          // Remove the leading + or - from the display
          const displayLine = line.startsWith('+') || line.startsWith('-') 
            ? line.substring(1).trim() 
            : line.trim();
          
          if (!displayLine) return null;
          
          return (
            <div key={index} className={className}>
              {prefix && <span className="font-semibold">{prefix}</span>}
              {displayLine}
            </div>
          );
        }).filter(Boolean)}
      </div>
    </div>
  );
}
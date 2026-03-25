import { useFilters } from '@/hooks/use-filters';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Menu } from 'lucide-react';
import { DatePickerWithRange } from '@/components/ui/date-picker-with-range';

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const { preset, setPreset, dateRange, setDateRange } = useFilters();
  const { theme, toggle } = useTheme();

  const handleCustomDate = (range: { from: Date; to: Date }) => {
    setDateRange(range);
    setPreset('custom');
  };

  const presets = [
    { label: 'Today', value: '1d' },
    { label: '7d', value: '7d' },
    { label: '30d', value: '30d' },
  ] as const;

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-border/40 bg-background/80 backdrop-blur-xl px-4 lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={onMenuToggle}>
        <Menu className="h-5 w-5" />
      </Button>

      {/* Controls Container */}
      <div className="hidden sm:flex items-center gap-3 ml-auto">
        
        {/* Date range display */}
        <div className="flex items-center text-xs text-muted-foreground">
          <DatePickerWithRange date={dateRange} setDate={handleCustomDate} />
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-0.5 rounded-full bg-muted/50 p-0.5">
        {presets.map(p => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              preset === p.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
        </div>
      </div>

      {/* Theme toggle */}
      <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 shrink-0 sm:ml-2 ml-auto">
        {theme === 'dark' ? <Sun className="h-4 w-4 transition-transform duration-300 rotate-0 hover:rotate-45" /> : <Moon className="h-4 w-4 transition-transform duration-300 rotate-0 hover:-rotate-12" />}
      </Button>
    </header>
  );
}
